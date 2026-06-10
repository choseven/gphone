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
  let phaseTotalSecs = 60;

  // ── ENTRY POINTS ──────────────────────────────────────────

  async function enter(r, m) {
    room = r; me = m;

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

    // Clear previous game data
    await db().from('chain_entries').delete().eq('room_id', room.id);
    await db().from('drawings').delete().eq('room_id', room.id);
    await db().from('chains').delete().eq('room_id', room.id);
    await db().from('votes').delete().eq('room_id', room.id);

    const order = players.map(p => p.id);
    const chainIds = [];
    for (let i = 0; i < order.length; i++) {
      const { data: c } = await db()
        .from('chains')
        .insert({ room_id: room.id, owner_player_id: order[i], position: i })
        .select()
        .single();
      chainIds.push(c.id);
    }

    const total = (settings.rounds && settings.rounds > 0)
      ? Math.min(settings.rounds, order.length)
      : order.length;

    const payload = { round: 0, totalRounds: total, order, chains: chainIds };
    const secs = settings.prompt_timer || 60;
    await setPhase('PROMPT', 0, payload, secs);
    await db().from('rooms').update({ state: 'PROMPT', total_rounds: total, current_round: 0 }).eq('id', room.id);
  }

  // ── STATE MACHINE ─────────────────────────────────────────

  function onState(newGs) {
    const changed = !gs || gs.round !== newGs.round || gs.phase !== newGs.phase;
    gs = newGs;
    if (gs.phase === 'FINISHED' || gs.phase === 'REVEAL') { goReveal(); return; }
    if (changed) setupRound();
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

    // Spectators or players not in the round just see waiting
    if (myIdx === -1) {
      App.showScreen('waiting');
      $('#waiting-big-text').textContent = 'Spectating…';
      return;
    }

    const chainPos = ((myIdx - r) % n + n * 50) % n;
    assignedChainId = chains[chainPos];

    prevEntry = null;
    if (r > 0) {
      const { data } = await db()
        .from('chain_entries')
        .select('*')
        .eq('chain_id', assignedChainId)
        .eq('step', r - 1)
        .maybeSingle();
      prevEntry = data;
    }

    const phase = phaseForRound(r);

    if (phase === 'PROMPT') setupPrompt(payload);
    else if (phase === 'DRAWING') setupDrawing();
    else setupDescription();
  }

  // ── PROMPT PHASE ──────────────────────────────────────────

  function setupPrompt(payload) {
    App.showScreen('prompt');
    hideWaiting('prompt');

    const ta = $('#prompt-textarea');
    const counter = $('#prompt-char-count');
    ta.value = '';
    if (counter) counter.textContent = '0';
    ta.oninput = () => { if (counter) counter.textContent = ta.value.length; };
    ta.focus();

    $('#btn-submit-prompt').onclick = () => submitText(ta.value, 'prompt');
    $('#btn-submit-prompt').disabled = false;

    phaseTotalSecs = settings.prompt_timer || 60;
  }

  // ── DRAWING PHASE ─────────────────────────────────────────

  function setupDrawing() {
    App.showScreen('drawing');
    hideWaiting('draw');

    const promptText = prevEntry?.content || 'Draw anything!';
    $('#draw-prompt-display').textContent = promptText;

    Drawing.mount(null, { settings });

    $('#btn-submit-drawing').onclick = submitDrawing;
    $('#btn-submit-drawing').disabled = false;

    phaseTotalSecs = settings.drawing_timer || 90;
  }

  // ── DESCRIPTION PHASE ─────────────────────────────────────

  async function setupDescription() {
    App.showScreen('description');
    hideWaiting('desc');

    const img = $('#desc-image');
    img.src = '';

    if (prevEntry && prevEntry.drawing_id) {
      const { data: d } = await db()
        .from('drawings')
        .select('data')
        .eq('id', prevEntry.drawing_id)
        .single();
      if (d?.data) {
        img.src = drawingToDataURL(d.data);
      }
    }

    const ta = $('#desc-textarea');
    const counter = $('#desc-char-count');
    ta.value = '';
    if (counter) counter.textContent = '0';
    ta.oninput = () => { if (counter) counter.textContent = ta.value.length; };
    ta.focus();

    $('#btn-submit-desc').onclick = () => submitText(ta.value, 'description');
    $('#btn-submit-desc').disabled = false;

    phaseTotalSecs = settings.description_timer || 60;
  }

  // ── SUBMISSION ────────────────────────────────────────────

  async function submitText(text, type) {
    if (submittedThisRound) return;
    let content = text.trim();
    if (!content) content = type === 'prompt' ? randomPrompt() : '(no idea)';
    content = cleanText(content, settings.profanity_filter);
    submittedThisRound = true;

    // Disable button immediately
    const btnId = type === 'prompt' ? 'btn-submit-prompt' : 'btn-submit-desc';
    const btn = $('#' + btnId);
    if (btn) btn.disabled = true;

    try {
      await db().from('chain_entries').insert({
        chain_id: assignedChainId,
        room_id: room.id,
        author_player_id: me.id,
        step: gs.round,
        type,
        content
      });
    } catch (_) {
      submittedThisRound = false;
      if (btn) btn.disabled = false;
      return;
    }

    showWaiting(type === 'prompt' ? 'prompt' : 'desc');
    if (me.is_host) maybeAdvance();
  }

  async function submitDrawing() {
    if (submittedThisRound) return;
    submittedThisRound = true;

    const btn = $('#btn-submit-drawing');
    if (btn) btn.disabled = true;

    try {
      const data = Drawing.getData();
      const { data: d } = await db()
        .from('drawings')
        .insert({ room_id: room.id, chain_id: assignedChainId, author_player_id: me.id, data })
        .select()
        .single();

      await db().from('chain_entries').insert({
        chain_id: assignedChainId,
        room_id: room.id,
        author_player_id: me.id,
        step: gs.round,
        type: 'drawing',
        drawing_id: d.id
      });
    } catch (_) {
      submittedThisRound = false;
      if (btn) btn.disabled = false;
      return;
    }

    showWaiting('draw');
    if (me.is_host) maybeAdvance();
  }

  // Show waiting panel within the current phase screen
  function showWaiting(phase) {
    const panelId = 'waiting-panel-' + phase;
    const panel = $('#' + panelId);
    if (panel) panel.classList.remove('hidden');
    renderWaitingAvatars(phase);
  }

  function hideWaiting(phase) {
    const panel = $('#waiting-panel-' + phase);
    if (panel) panel.classList.add('hidden');
  }

  async function renderWaitingAvatars(phase) {
    const { data: entries } = await db()
      .from('chain_entries')
      .select('author_player_id')
      .eq('room_id', room.id)
      .eq('step', gs.round);

    const done = new Set((entries || []).map(e => e.author_player_id));
    const order = (gs.payload && gs.payload.order) || [];
    const allPlayers = Lobby.getPlayers ? Lobby.getPlayers() : [];
    const pmap = {};
    allPlayers.forEach(p => pmap[p.id] = p);

    const containerId = 'waiting-avatars-' + phase;
    const container = $('#' + containerId);
    if (!container) return;

    container.innerHTML = '';
    order.forEach((pid, i) => {
      const p = pmap[pid];
      const av = document.createElement('div');
      av.className = 'waiting-avatar av-' + (i % 10) + (done.has(pid) ? ' done' : '');
      av.title = p ? p.username : 'Player';
      av.textContent = p ? avatarFor(p.avatar) : '?';
      container.appendChild(av);
    });
  }

  // ── HOST ADVANCE LOGIC ────────────────────────────────────

  let advancing = false;

  async function maybeAdvance() {
    if (!me.is_host || advancing) return;
    const order = (gs.payload && gs.payload.order) || [];
    const { data: pRows } = await db().from('players').select('id').eq('room_id', room.id).eq('is_connected', true);
    const activeIds = new Set((pRows || []).map(p => p.id));
    const expected = order.filter(id => activeIds.has(id));

    const { data: entries } = await db()
      .from('chain_entries')
      .select('author_player_id')
      .eq('room_id', room.id)
      .eq('step', gs.round);

    const have = new Set((entries || []).map(e => e.author_player_id));
    const allIn = expected.every(id => have.has(id));
    const expired = gs.phase_ends_at && new Date(gs.phase_ends_at).getTime() < Date.now();

    if (allIn || expired) {
      if (expired && !allIn) await fillMissing(order, have);
      await advance();
    }
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
        const { data: d } = await db()
          .from('drawings')
          .insert({ room_id: room.id, chain_id: cid, author_player_id: pid, data: { size: settings.canvas_size || 720, strokes: [] } })
          .select().single();
        await db().from('chain_entries').insert({
          chain_id: cid, room_id: room.id, author_player_id: pid,
          step: r, type: 'drawing', drawing_id: d.id
        }).catch(() => {});
      } else {
        await db().from('chain_entries').insert({
          chain_id: cid, room_id: room.id, author_player_id: pid,
          step: r, type: phase === 'PROMPT' ? 'prompt' : 'description',
          content: '(ran out of time)'
        }).catch(() => {});
      }
    }
  }

  async function advance() {
    advancing = true;
    try {
      const payload = gs.payload;
      const next = gs.round + 1;

      if (next >= payload.totalRounds) {
        await db().from('game_states')
          .update({ state: 'FINISHED', phase: 'FINISHED', updated_at: new Date().toISOString() })
          .eq('room_id', room.id);
        await db().from('rooms').update({ state: 'FINISHED' }).eq('id', room.id);
      } else {
        const phase = phaseForRound(next);
        const secs = phase === 'DRAWING'
          ? (settings.drawing_timer || 90)
          : phase === 'PROMPT'
          ? (settings.prompt_timer || 60)
          : (settings.description_timer || 60);
        await setPhase(phase, next, payload, secs);
      }
    } finally {
      advancing = false;
    }
  }

  async function setPhase(phase, round, payload, seconds) {
    const ends = new Date(Date.now() + seconds * 1000).toISOString();
    await db().from('game_states').update({
      state: phase, phase, round, payload,
      phase_ends_at: ends,
      updated_at: new Date().toISOString()
    }).eq('room_id', room.id);
    await db().from('rooms').update({ state: phase, current_round: round, phase_ends_at: ends }).eq('id', room.id);
  }

  function startHostPoll() {
    clearInterval(hostPoll);
    hostPoll = setInterval(() => {
      if (me.is_host && gs && gs.phase !== 'FINISHED' && gs.phase !== 'REVEAL') {
        maybeAdvance();
        // Also refresh waiting avatar dots
        const phase = phaseForRound(gs.round);
        const phaseName = phase === 'PROMPT' ? 'prompt' : phase === 'DRAWING' ? 'draw' : 'desc';
        if (submittedThisRound) renderWaitingAvatars(phaseName);
      }
    }, 3000);
  }

  // ── TIMER ─────────────────────────────────────────────────

  function syncTimer() {
    clearInterval(localTimer);
    if (!gs || !gs.phase_ends_at) return;

    const phase = gs.phase;
    let displayId, ringId;
    if (phase === 'PROMPT')      { displayId = 'timer-display-prompt'; ringId = 'timer-ring-prompt'; }
    else if (phase === 'DRAWING') { displayId = 'timer-display-draw';  ringId = 'timer-ring-draw';  }
    else if (phase === 'DESCRIPTION') { displayId = 'timer-display-desc'; ringId = 'timer-ring-desc'; }

    const endMs = new Date(gs.phase_ends_at).getTime();

    const tick = () => {
      const left = Math.max(0, (endMs - Date.now()) / 1000);
      const display = displayId ? document.getElementById(displayId) : null;
      if (display) display.textContent = Math.ceil(left);

      const ring = ringId ? document.getElementById(ringId) : null;
      if (ring) {
        const pct = phaseTotalSecs > 0 ? left / phaseTotalSecs : 0;
        const offset = 113 * (1 - pct);
        ring.style.strokeDashoffset = Math.max(0, Math.min(113, offset));
        ring.style.stroke = left <= 10 ? 'var(--danger)' : 'var(--accent3)';
      }

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
    else if (phase === 'PROMPT') submitText($('#prompt-textarea')?.value || '', 'prompt');
    else submitText($('#desc-textarea')?.value || '', 'description');
  }

  // ── GO TO REVEAL ──────────────────────────────────────────

  async function goReveal() {
    clearInterval(localTimer);
    clearInterval(hostPoll);
    App.showScreen('waiting');
    $('#waiting-big-text').textContent = 'Loading results…';
    await Reveal.load(room, settings);
  }

  return { enter, start };
})();
