// ═══════════════════════════════════════════════════════════
//  game.js — State machine, timers, chain rotation, phases
// ═══════════════════════════════════════════════════════════

const Game = (() => {

  const STATES = {
    LOBBY:           'LOBBY',
    PROMPT_WRITING:  'PROMPT_WRITING',
    DRAWING:         'DRAWING',
    DESCRIPTION:     'DESCRIPTION',
    REVEAL:          'REVEAL',
    GAME_OVER:       'GAME_OVER'
  };

  let roomId       = null;
  let playerId     = null;
  let currentState = null;
  let currentRound = 0;
  let timerInterval = null;
  let gameSettings  = {};
  let playerOrder   = [];
  let chains        = {};
  let myChainId     = null;
  let unsubFns      = [];

  // ── Start game (host only) ────────────────────────────────
  async function startGame(rId, players) {
    roomId   = rId;
    playerId = Lobby.getPlayerId();

    const activePlayers = Object.entries(players)
      .filter(([, p]) => p.connected && !p.isSpectator)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));

    const order    = activePlayers.map(([uid]) => uid);
    const room     = await FB.dbGet('rooms', { id: roomId });
    const settings = room?.settings || {};

    // ── CHANGED: insert one chain per player into chains table ──
    const chainMap = {};
    for (const uid of order) {
      const chainId = db_key();
      await FB.dbSet('chains', { id: chainId, room_id: roomId, owner_uid: uid });
      chainMap[chainId] = { owner: uid, entries: {} };
    }

    // ── CHANGED: update rooms table columns ──
    await FB.dbUpdate('rooms', { id: roomId }, {
      state:            STATES.PROMPT_WRITING,
      round:            0,
      round_start_time: Date.now(),
      player_order:     order,
      settings
    });

    chains = chainMap;
  }

  // ── Sync: called when room state changes ──────────────────
  function sync(room) {
    roomId   = Lobby.getRoomId() || room.id;
    playerId = Lobby.getPlayerId();
    if (!roomId || !playerId) return;

    const newState = room.state;
    if (newState === currentState) return;
    currentState = newState;
    currentRound = room.round || 0;
    gameSettings = room.settings || {};
    // ── CHANGED: player_order (snake_case from DB) ──
    playerOrder  = room.playerOrder || room.player_order || [];
    chains       = room.chains || {};

    clearTimer();
    Lobby.cleanup();

    switch (newState) {
      case STATES.PROMPT_WRITING: enterPromptPhase(room);      break;
      case STATES.DRAWING:        enterDrawingPhase(room);     break;
      case STATES.DESCRIPTION:    enterDescriptionPhase(room); break;
      case STATES.REVEAL:         Reveal.enter(room);          break;
      case STATES.GAME_OVER:      enterGameOver(room);         break;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PROMPT PHASE
  // ═══════════════════════════════════════════════════════
  function enterPromptPhase(room) {
    App.showScreen('prompt');

    const settings = room.settings || {};
    const timer    = settings.promptTimer || 60;
    const theme    = settings.theme || '';

    document.getElementById('prompt-theme-hint').textContent =
      theme ? `Theme: "${theme}" — get creative!` : 'Write anything you can imagine!';

    const textarea = document.getElementById('prompt-textarea');
    textarea.value = '';
    textarea.focus();
    updateCharCount('prompt-textarea', 'prompt-char-count');

    myChainId = chainForPlayer(playerId, 0, room);

    // ── CHANGED: roundStartTime may be round_start_time ──
    const startTime = room.roundStartTime || room.round_start_time;
    startTimer('prompt', timer, startTime, async () => { await autoSubmitPrompt(); });

    listenForSubmissions('prompt', room, 0, () => {
      if (Lobby.getIsHost()) advanceToDrawing(room);
    });

    document.getElementById('btn-submit-prompt').onclick = () => submitPrompt(room);
    document.getElementById('prompt-textarea').addEventListener('input', () =>
      updateCharCount('prompt-textarea', 'prompt-char-count'));
  }

  async function submitPrompt(room) {
    const text = document.getElementById('prompt-textarea').value.trim();
    if (!text) { App.toast('Write a prompt first!', 'warn'); return; }
    const filtered = Lobby.filterProfanity(text);

    // ── CHANGED: insert into entries table ──
    await FB.dbPush('entries', {
      id: db_key(), chain_id: myChainId,
      type: 'prompt', content: filtered,
      author: playerId, round: 0, created_at: Date.now()
    });
    // ── CHANGED: insert into submissions table ──
    await FB.dbSet('submissions', { room_id: roomId, phase: 'prompt', uid: playerId });

    document.getElementById('btn-submit-prompt').disabled = true;
    App.toast('Prompt submitted! ✓', 'success');
    showWaitingPanel('prompt', room);
  }

  async function autoSubmitPrompt() {
    const already = await FB.dbGet('submissions', { room_id: roomId, phase: 'prompt', uid: playerId });
    if (already) return;
    const text = document.getElementById('prompt-textarea').value.trim() || 'A mystery object';
    await FB.dbPush('entries', {
      id: db_key(), chain_id: myChainId,
      type: 'prompt', content: text,
      author: playerId, round: 0, created_at: Date.now()
    });
    await FB.dbSet('submissions', { room_id: roomId, phase: 'prompt', uid: playerId });
  }

  // ═══════════════════════════════════════════════════════
  //  DRAWING PHASE
  // ═══════════════════════════════════════════════════════
  async function enterDrawingPhase(room) {
    App.showScreen('drawing');
    Drawing.init();
    Drawing.reset();
    Drawing.enable();
    Drawing.bindKeyboard();

    const round = room.round || 0;
    const timer = (room.settings || {}).drawTimer || 90;
    myChainId   = chainForPlayer(playerId, round, room);

    // ── CHANGED: fetch entries from entries table ──
    const entries = await FB.dbGetAll('entries', { chain_id: myChainId });
    entries.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const last = entries[entries.length - 1];
    const promptText = (last && last.type !== 'drawing') ? last.content : '???';

    document.getElementById('draw-prompt-display').textContent = promptText;

    // Autosave to localStorage instead of Firebase
    Drawing.onAutosave = (dataUrl) => {
      try { localStorage.setItem('sc_autosave', dataUrl.substring(0, 500000)); } catch {}
    };

    const startTime = room.roundStartTime || room.round_start_time;
    startTimer('draw', timer, startTime, async () => { await autoSubmitDrawing(room, round); });

    listenForSubmissions('drawing', room, round, () => {
      if (Lobby.getIsHost()) advanceToDescription(room);
    });

    document.getElementById('btn-submit-drawing').onclick = () => submitDrawing(room, round);
  }

  async function submitDrawing(room, round) {
    document.getElementById('btn-submit-drawing').disabled = true;
    App.toast('Uploading drawing…');
    Drawing.disable();

    try {
      const dataUrl = Drawing.getDataUrl();
      // ── CHANGED: uploadDrawing uses Supabase Storage ──
      const url = await FB.uploadDrawing(roomId, myChainId, round, dataUrl);

      await FB.dbPush('entries', {
        id: db_key(), chain_id: myChainId,
        type: 'drawing', content: url,
        author: playerId, round, created_at: Date.now()
      });
      await FB.dbSet('submissions', { room_id: roomId, phase: `drawing-${round}`, uid: playerId });

      App.toast('Drawing submitted! ✓', 'success');
      showWaitingPanel('draw', room);
    } catch (e) {
      document.getElementById('btn-submit-drawing').disabled = false;
      Drawing.enable();
      App.toast('Upload failed. Try again.', 'error');
    }
  }

  async function autoSubmitDrawing(room, round) {
    const already = await FB.dbGet('submissions', { room_id: roomId, phase: `drawing-${round}`, uid: playerId });
    if (already) return;
    await submitDrawing(room, round);
  }

  // ═══════════════════════════════════════════════════════
  //  DESCRIPTION PHASE
  // ═══════════════════════════════════════════════════════
  async function enterDescriptionPhase(room) {
    App.showScreen('description');

    const round = room.round || 0;
    const timer = (room.settings || {}).descTimer || 60;
    myChainId   = chainForPlayer(playerId, round, room);

    // ── CHANGED: fetch from entries table ──
    const entries = await FB.dbGetAll('entries', { chain_id: myChainId });
    entries.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    const drawing = [...entries].reverse().find(e => e.type === 'drawing');
    const imgUrl  = drawing ? drawing.content : '';

    document.getElementById('desc-image').src = imgUrl;

    const textarea = document.getElementById('desc-textarea');
    textarea.value = '';
    textarea.focus();
    updateCharCount('desc-textarea', 'desc-char-count');
    textarea.addEventListener('input', () => updateCharCount('desc-textarea', 'desc-char-count'));

    const startTime = room.roundStartTime || room.round_start_time;
    startTimer('desc', timer, startTime, async () => { await autoSubmitDesc(room, round); });

    listenForSubmissions('description', room, round, () => {
      if (Lobby.getIsHost()) advanceRoundOrReveal(room);
    });

    document.getElementById('btn-submit-desc').onclick = () => submitDesc(room, round);
  }

  async function submitDesc(room, round) {
    const text = document.getElementById('desc-textarea').value.trim();
    if (!text) { App.toast('Write a description first!', 'warn'); return; }
    const filtered = Lobby.filterProfanity(text);

    await FB.dbPush('entries', {
      id: db_key(), chain_id: myChainId,
      type: 'description', content: filtered,
      author: playerId, round, created_at: Date.now()
    });
    await FB.dbSet('submissions', { room_id: roomId, phase: `description-${round}`, uid: playerId });

    document.getElementById('btn-submit-desc').disabled = true;
    App.toast('Submitted! ✓', 'success');
    showWaitingPanel('desc', room);
  }

  async function autoSubmitDesc(room, round) {
    const already = await FB.dbGet('submissions', { room_id: roomId, phase: `description-${round}`, uid: playerId });
    if (already) return;
    const text = document.getElementById('desc-textarea').value.trim() || 'Something mysterious';
    await FB.dbPush('entries', {
      id: db_key(), chain_id: myChainId,
      type: 'description', content: text,
      author: playerId, round, created_at: Date.now()
    });
    await FB.dbSet('submissions', { room_id: roomId, phase: `description-${round}`, uid: playerId });
  }

  // ═══════════════════════════════════════════════════════
  //  GAME OVER
  // ═══════════════════════════════════════════════════════
  function enterGameOver(room) {
    App.showScreen('gameover');
    const players = room.players || {};
    const sorted  = Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    const board = document.getElementById('scoreboard');
    board.innerHTML = '';
    sorted.forEach(([uid, p], i) => {
      const row    = document.createElement('div');
      row.className = 'score-row';
      const medals = ['🥇','🥈','🥉'];
      row.innerHTML = `
        <span class="score-rank">${medals[i] || (i+1)}</span>
        <span class="score-name">${Lobby.escHtml(p.name || 'Player')}</span>
        <span class="score-pts">${p.score || 0} pts</span>
      `;
      board.appendChild(row);
    });

    document.getElementById('btn-play-again').onclick = async () => {
      // ── CHANGED: update rooms, delete old chains/submissions/reactions ──
      await FB.dbUpdate('rooms', { id: roomId }, {
        state: 'LOBBY', round: 0, player_order: [], reveal_chain_idx: 0, reveal_entry_idx: 0
      });
      // Clean up old data
      const oldChains = await FB.dbGetAll('chains', { room_id: roomId });
      for (const c of oldChains) {
        await FB.dbDelete('entries', { chain_id: c.id });
      }
      await FB.dbDelete('chains',      { room_id: roomId });
      await FB.dbDelete('submissions', { room_id: roomId });
      await FB.dbDelete('reactions',   { room_id: roomId });

      App.showScreen('lobby');
      Lobby.enterLobby();
    };

    document.getElementById('btn-back-lobby').onclick = async () => {
      await Lobby.leaveRoom();
      App.showScreen('landing');
    };
  }

  // ═══════════════════════════════════════════════════════
  //  CHAIN ROTATION
  // ═══════════════════════════════════════════════════════
  function chainForPlayer(uid, round, room) {
    const order  = room.playerOrder || room.player_order || playerOrder;
    const chData = room.chains || chains;
    const n      = order.length;
    if (!n) return null;

    const myIdx  = order.indexOf(uid);
    if (myIdx === -1) return null;

    // Build chainIds aligned to playerOrder
    const chainIds = order.map(ownerId =>
      Object.keys(chData).find(cid => chData[cid].owner === ownerId || chData[cid].owner_uid === ownerId)
    ).filter(Boolean);

    if (round === 0) return chainIds[myIdx];
    const target = (myIdx + round) % n;
    return chainIds[target] || null;
  }

  // ═══════════════════════════════════════════════════════
  //  PHASE ADVANCEMENT (host only)
  // ═══════════════════════════════════════════════════════
  async function advanceToDrawing(room) {
    clearTimer();
    await FB.dbUpdate('rooms', { id: roomId }, {
      state: STATES.DRAWING,
      round: room.round || 0,
      round_start_time: Date.now()
    });
  }

  async function advanceToDescription(room) {
    clearTimer();
    await FB.dbUpdate('rooms', { id: roomId }, {
      state: STATES.DESCRIPTION,
      round: room.round || 0,
      round_start_time: Date.now()
    });
  }

  async function advanceRoundOrReveal(room) {
    clearTimer();
    const order = room.playerOrder || room.player_order || playerOrder;
    const n     = order.length;
    const round = room.round || 0;
    const maxRound = n - 2;

    if (round >= maxRound) {
      await FB.dbUpdate('rooms', { id: roomId }, {
        state:            STATES.REVEAL,
        round:            round + 1,
        round_start_time: Date.now(),
        reveal_chain_idx: 0,
        reveal_entry_idx: 0
      });
    } else {
      await FB.dbUpdate('rooms', { id: roomId }, {
        state:            STATES.DRAWING,
        round:            round + 1,
        round_start_time: Date.now()
      });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SUBMISSION LISTENING
  // ═══════════════════════════════════════════════════════
  function listenForSubmissions(phase, room, round, onComplete) {
    if (!Lobby.getIsHost()) return;
    const key      = phase === 'prompt' ? 'prompt' : `${phase}-${round}`;
    const order    = room.playerOrder || room.player_order || playerOrder;
    const required = order.filter(uid => {
      const p = (room.players || {})[uid];
      return p && p.connected && !p.isSpectator;
    });

    // ── CHANGED: listen on submissions table ──
    const unsub = FB.dbOn({
      table: 'submissions', event: 'INSERT',
      match: { room_id: roomId },
      callback: async () => {
        const rows = await FB.dbGetAll('submissions', { room_id: roomId, phase: key });
        const done = required.every(uid => rows.some(r => r.uid === uid));
        if (done) { unsub(); onComplete(); }
      }
    });
    unsubFns.push(unsub);
  }

  // ═══════════════════════════════════════════════════════
  //  TIMER
  // ═══════════════════════════════════════════════════════
  function startTimer(scope, seconds, startTime, onExpire) {
    const ring    = document.getElementById(`timer-ring-${scope}`);
    const display = document.getElementById(`timer-display-${scope}`);
    const circumference = 113;
    clearTimer();

    const tick = () => {
      const elapsed   = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(seconds - elapsed));
      const fraction  = Math.max(0, 1 - elapsed / seconds);

      if (display) display.textContent = remaining;
      if (ring) {
        ring.style.strokeDashoffset = circumference * (1 - fraction);
        ring.style.stroke = remaining <= 10 ? 'var(--danger)' : remaining <= 20 ? 'var(--warn)' : 'var(--accent3)';
      }
      if (remaining <= 0) { clearTimer(); onExpire(); }
    };

    tick();
    timerInterval = setInterval(tick, 500);
  }

  function clearTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  // ═══════════════════════════════════════════════════════
  //  WAITING PANELS
  // ═══════════════════════════════════════════════════════
  function showWaitingPanel(scope, room) {
    const panel    = document.getElementById(`waiting-panel-${scope}`);
    const avatarEl = document.getElementById(`waiting-avatars-${scope}`);
    if (!panel) return;
    panel.classList.remove('hidden');

    const order    = room.playerOrder || room.player_order || playerOrder;
    const required = order.filter(uid => {
      const p = (room.players || {})[uid];
      return p && p.connected && !p.isSpectator;
    });

    avatarEl.innerHTML = '';
    required.forEach(uid => {
      const p   = (room.players || {})[uid] || { name: '?' };
      const dot = document.createElement('div');
      dot.className  = `waiting-avatar av-${Lobby.avatarIndex(uid) % 10}`;
      dot.id         = `wait-av-${scope}-${uid}`;
      dot.title      = p.name;
      dot.textContent = (p.name || '?')[0].toUpperCase();
      avatarEl.appendChild(dot);
    });

    const phaseKey = scope === 'prompt' ? 'prompt'
                   : scope === 'draw'   ? `drawing-${room.round || 0}`
                   :                      `description-${room.round || 0}`;

    // ── CHANGED: watch submissions table ──
    const unsub = FB.dbOn({
      table: 'submissions', event: 'INSERT',
      match: { room_id: roomId },
      callback: async () => {
        const rows = await FB.dbGetAll('submissions', { room_id: roomId, phase: phaseKey });
        required.forEach(uid => {
          const dot = document.getElementById(`wait-av-${scope}-${uid}`);
          if (dot) dot.classList.toggle('done', rows.some(r => r.uid === uid));
        });
      }
    });
    unsubFns.push(unsub);
  }

  // ═══════════════════════════════════════════════════════
  //  ROOM WATCHER
  // ═══════════════════════════════════════════════════════
  function watchRoom(rId) {
    roomId   = rId;
    playerId = Lobby.getPlayerId();

    // ── CHANGED: listen on rooms table, then fetch full state ──
    const unsub = FB.dbOn({
      table: 'rooms', event: 'UPDATE',
      match: { id: roomId },
      callback: async payload => {
        const roomRow = payload.new;
        chains      = {};
        playerOrder = roomRow.player_order || [];
        gameSettings = roomRow.settings || {};

        // Fetch players and chains to pass to sync
        await Lobby.fetchAndSync(roomRow);
      }
    });
    unsubFns.push(unsub);
  }

  // ── Utils ─────────────────────────────────────────────────
  function db_key() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }

  function updateCharCount(textareaId, counterId) {
    const ta  = document.getElementById(textareaId);
    const cnt = document.getElementById(counterId);
    if (ta && cnt) cnt.textContent = ta.value.length;
  }

  function cleanup() {
    clearTimer();
    unsubFns.forEach(fn => fn());
    unsubFns    = [];
    currentState = null;
  }

  return {
    startGame, sync, watchRoom, cleanup,
    chainForPlayer,
    get roomId()      { return roomId; },
    get playerOrder() { return playerOrder; },
    get chains()      { return chains; },
    get gameSettings(){ return gameSettings; },
    get currentState(){ return currentState; },
    STATES
  };
})();

window.Game = Game;
