const Game = (function () {
  var room = null;
  var me = null;
  var gs = null;
  var settings = {};
  var localTimer = null;
  var hostPoll = null;
  var submittedThisRound = false;
  var assignedChainId = null;
  var prevEntry = null;
  var phaseTotalSecs = 60;
  var advancing = false;

  async function enter(r, m) {
    room = r; me = m;
    var setRes = await db().from('settings').select('*').eq('room_id', room.id).single();
    settings = setRes.data || {};
    var gsRes = await db().from('game_states').select('*').eq('room_id', room.id).single();
    gs = gsRes.data;
    Realtime.on('game_state', function(p) { if (p.new) onState(p.new); });
    Realtime.on('chain_entry', function() { if (me.is_host) maybeAdvance(); });
    if (gs) onState(gs);
    if (me.is_host) startHostPoll();
  }

  async function start() {
    var players = Lobby.getPlayers().filter(function(p) { return p.is_connected && !p.is_spectator; });
    if (players.length < 2) { showToast('Need at least 2 players', 'error'); return; }
    var setRes = await db().from('settings').select('*').eq('room_id', room.id).single();
    settings = setRes.data || {};
    await db().from('chain_entries').delete().eq('room_id', room.id);
    await db().from('drawings').delete().eq('room_id', room.id);
    await db().from('chains').delete().eq('room_id', room.id);
    var order = players.map(function(p) { return p.id; });
    var chainIds = [];
    for (var i = 0; i < order.length; i++) {
      var cr = await db().from('chains')
        .insert({ room_id: room.id, owner_player_id: order[i], position: i })
        .select().single();
      chainIds.push(cr.data.id);
    }
    var total = (settings.rounds && settings.rounds > 0) ? Math.min(settings.rounds, order.length) : order.length;
    var payload = { round: 0, totalRounds: total, order: order, chains: chainIds };
    var secs = settings.prompt_timer || 60;
    await setPhase('PROMPT', 0, payload, secs);
    await db().from('rooms').update({ state: 'PROMPT', total_rounds: total, current_round: 0 }).eq('id', room.id);
  }

  function onState(newGs) {
    var changed = !gs || gs.round !== newGs.round || gs.phase !== newGs.phase;
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
    var payload = gs.payload || {};
    var order = payload.order || [];
    var chains = payload.chains || [];
    var n = order.length;
    var r = gs.round;
    var myIdx = order.indexOf(me.id);
    if (myIdx === -1) {
      App.showScreen('waiting');
      var wb = document.getElementById('waiting-big-text');
      if (wb) wb.textContent = 'Spectating...';
      return;
    }
    var chainPos = ((myIdx - r) % n + n * 50) % n;
    assignedChainId = chains[chainPos];
    prevEntry = null;
    if (r > 0) {
      var peRes = await db().from('chain_entries').select('*')
        .eq('chain_id', assignedChainId).eq('step', r - 1).maybeSingle();
      prevEntry = peRes.data;
    }
    var phase = phaseForRound(r);
    if (phase === 'PROMPT') setupPrompt(payload);
    else if (phase === 'DRAWING') setupDrawing();
    else setupDescription();
  }

  function setupPrompt() {
    App.showScreen('prompt');
    hideWaiting('prompt');
    var ta = document.getElementById('prompt-textarea');
    var counter = document.getElementById('prompt-char-count');
    if (ta) {
      ta.value = '';
      ta.oninput = function() { if (counter) counter.textContent = ta.value.length; };
      ta.focus();
    }
    var btn = document.getElementById('btn-submit-prompt');
    if (btn) { btn.disabled = false; btn.onclick = function() { submitText(ta ? ta.value : '', 'prompt'); }; }
    phaseTotalSecs = settings.prompt_timer || 60;
    syncTimer();
  }

  function setupDrawing() {
    App.showScreen('drawing');
    hideWaiting('draw');
    var disp = document.getElementById('draw-prompt-display');
    if (disp) disp.textContent = (prevEntry && prevEntry.content) ? prevEntry.content : 'Draw anything!';
    Drawing.mount(null, { settings: settings });
    var btn = document.getElementById('btn-submit-drawing');
    if (btn) { btn.disabled = false; btn.onclick = submitDrawing; }
    phaseTotalSecs = settings.drawing_timer || 90;
    syncTimer();
  }

  async function setupDescription() {
    App.showScreen('description');
    hideWaiting('desc');
    var img = document.getElementById('desc-image');
    if (img) img.src = '';
    if (prevEntry && prevEntry.drawing_id) {
      var dRes = await db().from('drawings').select('data').eq('id', prevEntry.drawing_id).single();
      if (dRes.data && dRes.data.data && img) img.src = drawingToDataURL(dRes.data.data);
    }
    var ta = document.getElementById('desc-textarea');
    var counter = document.getElementById('desc-char-count');
    if (ta) {
      ta.value = '';
      ta.oninput = function() { if (counter) counter.textContent = ta.value.length; };
      ta.focus();
    }
    var btn = document.getElementById('btn-submit-desc');
    if (btn) { btn.disabled = false; btn.onclick = function() { submitText(ta ? ta.value : '', 'description'); }; }
    phaseTotalSecs = settings.description_timer || 60;
    syncTimer();
  }

  async function submitText(text, type) {
    if (submittedThisRound) return;
    var content = (text || '').trim();
    if (!content) content = type === 'prompt' ? randomPrompt() : '(no idea)';
    content = cleanText(content, settings.profanity_filter);
    submittedThisRound = true;
    var btnId = type === 'prompt' ? 'btn-submit-prompt' : 'btn-submit-desc';
    var btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;
    try {
      await db().from('chain_entries').insert({
        chain_id: assignedChainId, room_id: room.id,
        author_player_id: me.id, step: gs.round, type: type, content: content
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
    var btn = document.getElementById('btn-submit-drawing');
    if (btn) btn.disabled = true;
    try {
      var data = Drawing.getData();
      var dRes = await db().from('drawings')
        .insert({ room_id: room.id, chain_id: assignedChainId, author_player_id: me.id, data: data })
        .select().single();
      await db().from('chain_entries').insert({
        chain_id: assignedChainId, room_id: room.id,
        author_player_id: me.id, step: gs.round, type: 'drawing', drawing_id: dRes.data.id
      });
    } catch (_) {
      submittedThisRound = false;
      if (btn) btn.disabled = false;
      return;
    }
    showWaiting('draw');
    if (me.is_host) maybeAdvance();
  }

  function showWaiting(phase) {
    var panel = document.getElementById('waiting-panel-' + phase);
    if (panel) panel.classList.remove('hidden');
    renderWaitingAvatars(phase);
  }

  function hideWaiting(phase) {
    var panel = document.getElementById('waiting-panel-' + phase);
    if (panel) panel.classList.add('hidden');
  }

  async function renderWaitingAvatars(phase) {
    var eRes = await db().from('chain_entries').select('author_player_id')
      .eq('room_id', room.id).eq('step', gs.round);
    var done = new Set((eRes.data || []).map(function(e) { return e.author_player_id; }));
    var order = (gs.payload && gs.payload.order) || [];
    var allPlayers = Lobby.getPlayers ? Lobby.getPlayers() : [];
    var pmap = {};
    allPlayers.forEach(function(p) { pmap[p.id] = p; });
    var container = document.getElementById('waiting-avatars-' + phase);
    if (!container) return;
    container.innerHTML = '';
    order.forEach(function(pid, i) {
      var p = pmap[pid];
      var av = document.createElement('div');
      av.className = 'waiting-avatar av-' + (i % 10) + (done.has(pid) ? ' done' : '');
      av.title = p ? p.username : 'Player';
      av.textContent = p ? avatarFor(p.avatar) : '?';
      container.appendChild(av);
    });
  }

  async function maybeAdvance() {
    if (!me.is_host || advancing) return;
    var order = (gs.payload && gs.payload.order) || [];
    var pRes = await db().from('players').select('id').eq('room_id', room.id).eq('is_connected', true);
    var activeIds = new Set((pRes.data || []).map(function(p) { return p.id; }));
    var expected = order.filter(function(id) { return activeIds.has(id); });
    var eRes = await db().from('chain_entries').select('author_player_id')
      .eq('room_id', room.id).eq('step', gs.round);
    var have = new Set((eRes.data || []).map(function(e) { return e.author_player_id; }));
    var allIn = expected.every(function(id) { return have.has(id); });
    var expired = gs.phase_ends_at && new Date(gs.phase_ends_at).getTime() < Date.now();
    if (allIn || expired) {
      if (expired && !allIn) await fillMissing(order, have);
      await advance();
    }
  }

  async function fillMissing(order, have) {
    var r = gs.round;
    var phase = phaseForRound(r);
    var chains = gs.payload.chains;
    var n = order.length;
    for (var i = 0; i < order.length; i++) {
      var pid = order[i];
      if (have.has(pid)) continue;
      var chainPos = ((i - r) % n + n * 50) % n;
      var cid = chains[chainPos];
      if (phase === 'DRAWING') {
        var dRes = await db().from('drawings')
          .insert({ room_id: room.id, chain_id: cid, author_player_id: pid,
                    data: { size: settings.canvas_size || 720, strokes: [] } })
          .select().single();
        await db().from('chain_entries').insert({
          chain_id: cid, room_id: room.id, author_player_id: pid,
          step: r, type: 'drawing', drawing_id: dRes.data.id
        }).catch(function() {});
      } else {
        await db().from('chain_entries').insert({
          chain_id: cid, room_id: room.id, author_player_id: pid,
          step: r, type: phase === 'PROMPT' ? 'prompt' : 'description',
          content: '(ran out of time)'
        }).catch(function() {});
      }
    }
  }

  async function advance() {
    advancing = true;
    try {
      var payload = gs.payload;
      var next = gs.round + 1;
      if (next >= payload.totalRounds) {
        await db().from('game_states')
          .update({ state: 'FINISHED', phase: 'FINISHED', updated_at: new Date().toISOString() })
          .eq('room_id', room.id);
        await db().from('rooms').update({ state: 'FINISHED' }).eq('id', room.id);
      } else {
        var phase = phaseForRound(next);
        var secs = phase === 'DRAWING' ? (settings.drawing_timer || 90)
          : phase === 'PROMPT' ? (settings.prompt_timer || 60)
          : (settings.description_timer || 60);
        await setPhase(phase, next, payload, secs);
      }
    } finally {
      advancing = false;
    }
  }

  async function setPhase(phase, round, payload, seconds) {
    var ends = new Date(Date.now() + seconds * 1000).toISOString();
    await db().from('game_states').update({
      state: phase, phase: phase, round: round, payload: payload,
      phase_ends_at: ends, updated_at: new Date().toISOString()
    }).eq('room_id', room.id);
    await db().from('rooms').update({
      state: phase, current_round: round, phase_ends_at: ends
    }).eq('id', room.id);
  }

  function startHostPoll() {
    clearInterval(hostPoll);
    hostPoll = setInterval(function() {
      if (me.is_host && gs && gs.phase !== 'FINISHED' && gs.phase !== 'REVEAL') {
        maybeAdvance();
        if (submittedThisRound) {
          var phaseName = phaseForRound(gs.round);
          var key = phaseName === 'PROMPT' ? 'prompt' : phaseName === 'DRAWING' ? 'draw' : 'desc';
          renderWaitingAvatars(key);
        }
      }
    }, 3000);
  }

  function syncTimer() {
    clearInterval(localTimer);
    if (!gs || !gs.phase_ends_at) return;
    var phase = gs.phase;
    var displayId = null, ringId = null;
    if (phase === 'PROMPT')       { displayId = 'timer-display-prompt'; ringId = 'timer-ring-prompt'; }
    else if (phase === 'DRAWING')  { displayId = 'timer-display-draw';  ringId = 'timer-ring-draw'; }
    else if (phase === 'DESCRIPTION') { displayId = 'timer-display-desc'; ringId = 'timer-ring-desc'; }
    var endMs = new Date(gs.phase_ends_at).getTime();
    var tick = function() {
      var left = Math.max(0, (endMs - Date.now()) / 1000);
      var display = displayId ? document.getElementById(displayId) : null;
      if (display) display.textContent = Math.ceil(left);
      var ring = ringId ? document.getElementById(ringId) : null;
      if (ring) {
        var pct = phaseTotalSecs > 0 ? left / phaseTotalSecs : 0;
        var offset = 113 * (1 - pct);
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
    var phase = phaseForRound(gs.round);
    if (phase === 'DRAWING') submitDrawing();
    else if (phase === 'PROMPT') {
      var ta = document.getElementById('prompt-textarea');
      submitText(ta ? ta.value : '', 'prompt');
    } else {
      var ta2 = document.getElementById('desc-textarea');
      submitText(ta2 ? ta2.value : '', 'description');
    }
  }

  async function goReveal() {
    clearInterval(localTimer);
    clearInterval(hostPoll);
    App.showScreen('waiting');
    var wb = document.getElementById('waiting-big-text');
    if (wb) wb.textContent = 'Loading results...';
    await Reveal.load(room, settings);
  }

  return { enter: enter, start: start };
})();
