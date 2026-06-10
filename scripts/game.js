const Game = (function () {
  let room = null;
  let me = null;
  let gs = null;
  let settings = {};
  let localTimer = null;
  let hostPoll = null;
  let submittedThisRound = false;
  let assignedChainId = null;
  let prevEntry = null;

  async function enter(r, m) {
    room = r; me = m;
    App.showScreen('game');
    const { data: set } = await db().from('settings').select('*').eq('room_id', room.id).single();
    settings = set || {};
    const { data: g } = await db().from('game_states').select('*').eq('room_id', room.id).single();
    gs = g;

    Realtime.on('game_state', p => { if (p.new) onState(p.new); });
    Realtime.on('chain_entry', () => { if (me.is_host) maybeAdvance(); });

    if (gs) onState(gs);
    if (me.is_host) startHostPoll();
  }

  async function start() {
    const players = Lobby.getPlayers().filter(p => p.is_connected && !p.is_spectator);
    if (players.length < 2) { showToast('Need at least 2 players', 'error'); return; }

    const { data: set } = await db().from('settings').select('*').eq('room_id', room.id).single();
    settings = set || {};

    await db().from('chain_entries').delete().eq('room_id', room.id);
    await db().from('drawings').delete().eq('room_id', room.id);
    await db().from('chains').delete().eq('room_id', room.id);
    await db().from('votes').delete().eq('room_id', room.id);

    const order = players.map(p => p.id);
    const chainIds = [];
    for (let i = 0; i < order.length; i++) {
      const { data: c } = await db().from('chains').insert({ room_id: room.id, owner_player_id: order[i], position: i }).select().single();
      chainIds.push(c.id);
    }
    await db().from('players').update({ is_ready: false }).eq('room_id', room.id).neq('is_host', true);

    const total = settings.rounds && settings.rounds > 0 ? Math.min(settings.rounds, order.length) : order.length;
    const payload = { round: 0, totalRounds: total, order, chains: chainIds };
    await setPhase('PROMPT', 0, payload, settings.prompt_timer);
    await db().from('rooms').update({ state: 'PROMPT', total_rounds: total, current_round: 0 }).eq('id', room.id);
  }

  async function setPhase(phase, round, payload, seconds) {
    const ends = new Date(Date.now() + seconds * 1000).toISOString();
    await db().from('game_states').update({
      state: phase, phase, round, payload, phase_ends_at: ends, updated_at: new Date().toISOString()
    }).eq('room_id', room.id);
    await db().from('rooms').update({ state: phase, current_round: round, phase_ends_at: ends }).eq('id', room.id);
  }

  function onState(newGs) {
    const changedRound = !gs || gs.round !== newGs.round || gs.phase !== newGs.phase;
    gs = newGs;
    if (gs.phase === 'FINISHED') { goReveal(); return; }
    if (gs.phase === 'REVEAL') { goReveal(); return; }
    if (changedRound) setupRound();
    syncTimer();
  }

  function phaseForRound(r) {
    if (r === 0) return 'PROMPT';
    return r % 2 === 1 ? 'DRAWING' : 'DESCRIPTION';
  }

  async function setupRound() {
    submittedThisRound = false;
    const payload = gs.payload || {};
    const order = payload.order || [];
    const chains = payload.chains || [];
    const n = order.length;
    const r = gs.round;
    const myIdx = order.indexOf(me.id);

    if (myIdx === -1) { showPhase('waiting'); renderWaiting(); return; }

    const chainPos = ((myIdx - r) % n + n * 50) % n;
    assignedChainId = chains[chainPos];

    const phase = phaseForRound(r);
    $('#phase-label').textContent = { PROMPT: 'Write a prompt', DRAWING: 'Draw this!', DESCRIPTION: 'Describe it' }[phase];
    $('#round-label').textContent = `Round ${r + 1} / ${payload.totalRounds}`;

    prevEntry = null;
    if (r > 0) {
      const { data } = await db().from('chain_entries').select('*').eq('chain_id', assignedChainId).eq('step', r - 1).maybeSingle();
      prevEntry = data;
    }

    if (phase === 'PROMPT') setupPrompt();
    else if (phase === 'DRAWING') setupDrawing();
    else setupDescription();
  }

  function setupPrompt() {
    showPhase('prompt');
    const inp = $('#prompt-input');
    inp.value = '';
    inp.focus();
    $('#prompt-submit').onclick = () => submitText(inp.value, 'prompt');
    $('#prompt-random').onclick = () => { inp.value = randomPrompt(); };
  }

  function setupDrawing() {
    showPhase('drawing');
    const src = $('#draw-source');
    src.textContent = prevEntry ? (prevEntry.content || '') : 'Draw anything!';
    Drawing.mount(null, { settings, stream: false });
    $('#drawing-submit').onclick = submitDrawing;
  }

  async function setupDescription() {
    showPhase('description');
    const holder = $('#desc-image');
    holder.innerHTML = '';
    let data = null;
    if (prevEntry && prevEntry.drawing_id) {
      const { data: d } = await db().from('drawings').select('data').eq('id', prevEntry.drawing_id).single();
      data = d?.data;
    }
    if (data) {
      const eng = createCanvasEngine(holder, { size: data.size || 720 });
      eng.loadData(data, false);
      eng.canvas.style.width = '100%';
    }
    const inp = $('#desc-input');
    inp.value = '';
    inp.focus();
    $('#desc-submit').onclick = () => submitText(inp.value, 'description');
  }

  async function submitText(text, type) {
    if (submittedThisRound) return;
    let content = text.trim();
    if (!content) content = type === 'prompt' ? randomPrompt() : '(no idea)';
    content = cleanText(content, settings.profanity_filter);
    submittedThisRound = true;
    await db().from('chain_entries').insert({
      chain_id: assignedChainId, room_id: room.id, author_player_id: me.id,
      step: gs.round, type, content
    }).then(() => {}).catch(() => { submittedThisRound = false; });
    afterSubmit();
  }

  async function submitDrawing() {
    if (submittedThisRound) return;
    submittedThisRound = true;
    const data = Drawing.getData();
    const { data: d } = await db().from('drawings').insert({
      room_id: room.id, chain_id: assignedChainId, author_player_id: me.id, data
    }).select().single();
    await db().from('chain_entries').insert({
      chain_id: assignedChainId, room_id: room.id, author_player_id: me.id,
      step: gs.round, type: 'drawing', drawing_id: d.id
    });
    afterSubmit();
  }

  function afterSubmit() {
    showPhase('waiting');
    renderWaiting();
    if (me.is_host) maybeAdvance();
  }

  async function renderWaiting() {
    const { data: entries } = await db().from('chain_entries').select('author_player_id').eq('room_id', room.id).eq('step', gs.round);
    const done = new Set((entries || []).map(e => e.author_player_id));
    const order = (gs.payload && gs.payload.order) || [];
    const players = Lobby.getPlayers ? Lobby.getPlayers() : [];
    const pmap = {};
    players.forEach(p => pmap[p.id] = p);
    const list = $('#waiting-list');
    list.innerHTML = '';
    order.forEach(pid => {
      const chip = document.createElement('div');
      chip.className = 'waiting-chip' + (done.has(pid) ? ' done' : '');
      const p = pmap[pid];
      chip.textContent = (p ? avatarFor(p.avatar) + ' ' + p.username : 'Player') + (done.has(pid) ? ' ✓' : '');
      list.appendChild(chip);
    });
  }

  let advancing = false;
  async function maybeAdvance() {
    if (!me.is_host || advancing) return;
    const order = (gs.payload && gs.payload.order) || [];
    const { data: players } = await db().from('players').select('id').eq('room_id', room.id).eq('is_connected', true);
    const activeIds = new Set((players || []).map(p => p.id));
    const expected = order.filter(id => activeIds.has(id));
    const { data: entries } = await db().from('chain_entries').select('author_player_id').eq('room_id', room.id).eq('step', gs.round);
    const have = new Set((entries || []).map(e => e.author_player_id));
    const allIn = expected.every(id => have.has(id));
    const expired = gs.phase_ends_at && new Date(gs.phase_ends_at).getTime() < Date.now();
    if (allIn || expired) {
      if (expired && !allIn) await fillMissing(order, have);
      await advance();
    }
    if (gs.phase === 'WAITING') renderWaiting();
  }

  async function fillMissing(order, have) {
    const r = gs.round;
    const phase = phaseForRound(r);
    const chains = gs.payload.chains;
    const n = order.length;
    for (let i = 0; i < order.length; i++) {
      const pid = order[i];
      if (have.has(pid)) continue;
      const chainPos = ((i - r) % n + n * 50) % n;
      const cid = chains[chainPos];
      if (phase === 'DRAWING') {
        const { data: d } = await db().from('drawings').insert({ room_id: room.id, chain_id: cid, author_player_id: pid, data: { size: settings.canvas_size || 720, strokes: [] } }).select().single();
        await db().from('chain_entries').insert({ chain_id: cid, room_id: room.id, author_player_id: pid, step: r, type: 'drawing', drawing_id: d.id }).catch(() => {});
      } else {
        await db().from('chain_entries').insert({ chain_id: cid, room_id: room.id, author_player_id: pid, step: r, type: phase === 'PROMPT' ? 'prompt' : 'description', content: '(ran out of time)' }).catch(() => {});
      }
    }
  }

  async function advance() {
    advancing = true;
    try {
      const payload = gs.payload;
      const next = gs.round + 1;
      if (next >= payload.totalRounds) {
        await db().from('game_states').update({ state: 'FINISHED', phase: 'FINISHED', updated_at: new Date().toISOString() }).eq('room_id', room.id);
        await db().from('rooms').update({ state: 'FINISHED' }).eq('id', room.id);
      } else {
        const phase = phaseForRound(next);
        const secs = phase === 'DRAWING' ? settings.drawing_timer : (phase === 'PROMPT' ? settings.prompt_timer : settings.description_timer);
        await setPhase(phase, next, payload, secs);
      }
    } finally {
      advancing = false;
    }
  }

  function startHostPoll() {
    clearInterval(hostPoll);
    hostPoll = setInterval(() => { if (me.is_host && gs && gs.phase !== 'FINISHED' && gs.phase !== 'REVEAL') maybeAdvance(); }, 2000);
  }

  function showPhase(name) {
    $$('.phase-view').forEach(v => v.classList.remove('active'));
    const el = $('#phase-' + name);
    if (el) el.classList.add('active');
  }

  function syncTimer() {
    clearInterval(localTimer);
    if (!gs.phase_ends_at) { $('#timer').textContent = '--'; return; }
    const tick = () => {
      const left = (new Date(gs.phase_ends_at).getTime() - Date.now()) / 1000;
      const t = $('#timer');
      t.textContent = fmtTime(left);
      t.classList.toggle('low', left <= 10);
      if (left <= 0) {
        clearInterval(localTimer);
        if (!submittedThisRound) autoSubmit();
      }
    };
    tick();
    localTimer = setInterval(tick, 250);
  }

  function autoSubmit() {
    if (submittedThisRound) return;
    const phase = phaseForRound(gs.round);
    if (phase === 'DRAWING') submitDrawing();
    else if (phase === 'PROMPT') submitText($('#prompt-input').value, 'prompt');
    else submitText($('#desc-input').value, 'description');
  }

  async function goReveal() {
    clearInterval(localTimer);
    clearInterval(hostPoll);
    App.showScreen('reveal');
    await Reveal.load(room, settings);
  }

  return { enter, start };
})();
