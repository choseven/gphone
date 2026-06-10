// ═══════════════════════════════════════════════════════════
//  lobby.js — Room creation, joining, player list, presence
// ═══════════════════════════════════════════════════════════

const Lobby = (() => {
  let roomId      = null;
  let playerId    = null;
  let isHost      = false;
  let isSpectator = false;
  let playerName  = '';
  let unsubFns    = [];
  let settingsDisabled = false;

  const COLORS = ['#7c6aff','#ff6ad5','#42e8b5','#ffb84d','#ff4d6a',
                  '#4dc8ff','#a8ff78','#ff8c42','#c77dff','#5dfdcb'];

  function getRoomId()   { return roomId; }
  function getPlayerId() { return playerId; }
  function getIsHost()   { return isHost; }

  // ── Room code ─────────────────────────────────────────────
  function genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // ── Create room ───────────────────────────────────────────
  async function createRoom(name) {
    playerName = name.trim() || 'Anonymous';
    playerId   = FB.getUid();
    roomId     = genCode();

    // Ensure unique
    let existing = await FB.dbGet('rooms', { id: roomId });
    while (existing) {
      roomId   = genCode();
      existing = await FB.dbGet('rooms', { id: roomId });
    }

    // ── CHANGED: insert into rooms table ──
    await FB.dbSet('rooms', {
      id:               roomId,
      host_id:          playerId,
      state:            'LOBBY',
      round:            0,
      round_start_time: null,
      player_order:     [],
      reveal_chain_idx: 0,
      reveal_entry_idx: 0,
      settings: {
        promptTimer: 60,
        drawTimer:   90,
        descTimer:   60,
        maxPlayers:  8,
        spectators:  true,
        profanity:   false,
        theme:       ''
      }
    });

    // ── CHANGED: insert into players table ──
    await FB.dbSet('players', {
      id:          playerId,
      room_id:     roomId,
      name:        playerName,
      connected:   true,
      joined_at:   Date.now(),
      avatar_index: avatarIndex(playerId),
      is_spectator: false,
      score:        0
    });

    setupPresence();
    return roomId;
  }

  // ── Join room ─────────────────────────────────────────────
  async function joinRoom(code, name) {
    playerName = name.trim() || 'Anonymous';
    playerId   = FB.getUid();
    roomId     = code.toUpperCase().trim();

    const room = await FB.dbGet('rooms', { id: roomId });
    if (!room) throw new Error('Room not found.');
    if (room.state !== 'LOBBY') throw new Error('Game already in progress.');

    const settings    = room.settings || {};
    const allPlayers  = await FB.dbGetAll('players', { room_id: roomId });
    const connected   = allPlayers.filter(p => p.connected && !p.is_spectator);
    const maxPlayers  = settings.maxPlayers || 8;

    let spectate = false;
    if (connected.length >= maxPlayers) {
      if (!settings.spectators) throw new Error('Room is full.');
      spectate = true;
    }

    await FB.dbSet('players', {
      id:           playerId,
      room_id:      roomId,
      name:         playerName,
      connected:    true,
      joined_at:    Date.now(),
      avatar_index: avatarIndex(playerId),
      is_spectator: spectate,
      score:        0
    });

    isSpectator = spectate;
    setupPresence();
    return { roomId, isSpectator: spectate };
  }

  // ── Rejoin ────────────────────────────────────────────────
  async function rejoinRoom(savedRoomId, savedPlayerId) {
    const pData = await FB.dbGet('players', { id: savedPlayerId, room_id: savedRoomId });
    if (!pData) return false;
    roomId      = savedRoomId;
    playerId    = savedPlayerId;
    playerName  = pData.name;
    isSpectator = pData.is_spectator || false;
    await FB.dbUpdate('players', { id: playerId }, { connected: true });
    setupPresence();
    return true;
  }

  // ── Presence (heartbeat — Supabase has no onDisconnect) ───
  function setupPresence() {
    // Mark connected on load
    FB.dbUpdate('players', { id: playerId }, { connected: true }).catch(() => {});

    // Heartbeat every 20s
    window._presenceInterval = setInterval(() => {
      FB.dbUpdate('players', { id: playerId }, { connected: true }).catch(() => {});
    }, 20000);

    // Mark disconnected on tab close
    window.addEventListener('beforeunload', () => {
      // Synchronous fetch so it fires before page unloads
      const url  = `${FB.supabase.supabaseUrl}/rest/v1/players?id=eq.${playerId}`;
      const body = JSON.stringify({ connected: false });
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    });
  }

  // ── Leave room ────────────────────────────────────────────
  async function leaveRoom() {
    if (!roomId || !playerId) return;
    clearInterval(window._presenceInterval);
    unsubFns.forEach(fn => fn());
    unsubFns = [];
    await FB.dbUpdate('players', { id: playerId }, { connected: false });
    roomId   = null;
    playerId = null;
    isHost   = false;
  }

  // ── Enter lobby screen ────────────────────────────────────
  function enterLobby() {
    document.getElementById('lobby-room-code').textContent = roomId;
    updateHostUI();

    // ── CHANGED: listen on rooms table ──
    const unsubRoom = FB.dbOn({
      table: 'rooms', event: 'UPDATE',
      match: { id: roomId },
      callback: payload => {
        const room = payload.new;
        if (!room) { App.showScreen('landing'); App.toast('Room closed.', 'warn'); return; }
        isHost = (room.host_id === playerId);
        updateHostUI();
        applySettings(room.settings || {});
        if (room.state && room.state !== 'LOBBY') {
          unsubFns.forEach(fn => fn());
          // Need to fetch full room with players/chains for Game.sync
          fetchAndSync(room);
        }
      }
    });
    unsubFns.push(unsubRoom);

    // ── CHANGED: listen on players table ──
    const unsubPlayers = FB.dbOn({
      table: 'players', event: '*',
      match: { room_id: roomId },
      callback: async () => {
        const rows = await FB.dbGetAll('players', { room_id: roomId });
        const playersObj = Object.fromEntries(rows.map(p => [p.id, normalizePlayer(p)]));
        renderPlayerList(playersObj);
        checkHostMigration(playersObj);
        updateStartButton(playersObj);
      }
    });
    unsubFns.push(unsubPlayers);

    // Initial player load
    FB.dbGetAll('players', { room_id: roomId }).then(rows => {
      const playersObj = Object.fromEntries(rows.map(p => [p.id, normalizePlayer(p)]));
      renderPlayerList(playersObj);
      updateStartButton(playersObj);
    });

    // Initial host check
    FB.dbGet('rooms', { id: roomId }).then(room => {
      if (!room) return;
      isHost = (room.host_id === playerId);
      updateHostUI();
      applySettings(room.settings || {});
    });

    setupChat('lobby');

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(roomId).then(() => App.toast('Code copied!', 'success'));
    });

    document.getElementById('btn-leave-lobby').onclick = async () => {
      await leaveRoom();
      App.showScreen('landing');
    };

    document.getElementById('btn-start-game').onclick = async () => {
      if (!isHost) return;
      const rows    = await FB.dbGetAll('players', { room_id: roomId });
      const active  = rows.filter(p => p.connected && !p.is_spectator);
      if (active.length < 2) { App.toast('Need at least 2 players to start.', 'warn'); return; }
      const playersObj = Object.fromEntries(rows.map(p => [p.id, normalizePlayer(p)]));
      await Game.startGame(roomId, playersObj);
    };

    setupSettingsListeners();
    document.getElementById('spectator-notice').classList.toggle('hidden', !isSpectator);
  }

  // Convert snake_case player row → camelCase for game logic
  function normalizePlayer(p) {
    return {
      name:        p.name,
      connected:   p.connected,
      joinedAt:    p.joined_at,
      avatarIndex: p.avatar_index,
      isSpectator: p.is_spectator,
      score:       p.score || 0
    };
  }

  // Fetch full room state and pass to Game.sync
  async function fetchAndSync(roomRow) {
    const players = await FB.dbGetAll('players', { room_id: roomRow.id });
    const chains  = await FB.dbGetAll('chains',  { room_id: roomRow.id });

    const chainsObj = {};
    for (const chain of chains) {
      const entries  = await FB.dbGetAll('entries', { chain_id: chain.id });
      const entriesObj = Object.fromEntries(entries.map(e => [e.id, e]));
      chainsObj[chain.id] = { owner: chain.owner_uid, entries: entriesObj };
    }

    const playersObj = Object.fromEntries(players.map(p => [p.id, normalizePlayer(p)]));

    Game.sync({
      id:               roomRow.id,
      hostId:           roomRow.host_id,
      state:            roomRow.state,
      round:            roomRow.round,
      roundStartTime:   roomRow.round_start_time,
      playerOrder:      roomRow.player_order || [],
      revealChainIdx:   roomRow.reveal_chain_idx || 0,
      revealEntryIdx:   roomRow.reveal_entry_idx || 0,
      settings:         roomRow.settings || {},
      players:          playersObj,
      chains:           chainsObj
    });
  }

  // ── Player list ───────────────────────────────────────────
  function renderPlayerList(players) {
    const grid = document.getElementById('player-list');
    grid.innerHTML = '';
    Object.entries(players).forEach(([uid, p]) => {
      if (!p.connected) return;
      const card = document.createElement('div');
      card.className = 'player-card';
      if (uid === playerId) card.classList.add('is-you');
      const av = p.avatarIndex ?? avatarIndex(uid);
      card.innerHTML = `
        <div class="player-avatar av-${av % 10}">${p.name[0].toUpperCase()}</div>
        <div>
          <div class="player-name">${escHtml(p.name)}</div>
          <div class="player-badge">${p.isSpectator ? '👁️ Spectator' : ''}</div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  // ── Host migration ────────────────────────────────────────
  async function checkHostMigration(players) {
    const room = await FB.dbGet('rooms', { id: roomId });
    if (!room) return;
    const hostPlayer = players[room.host_id];
    if (hostPlayer && hostPlayer.connected) return;

    const connected = Object.entries(players)
      .filter(([, p]) => p.connected && !p.isSpectator)
      .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

    if (connected.length && connected[0][0] === playerId) {
      await FB.dbUpdate('rooms', { id: roomId }, { host_id: playerId });
    }
  }

  // ── Start button ──────────────────────────────────────────
  function updateStartButton(players) {
    const btn    = document.getElementById('btn-start-game');
    const hint   = document.getElementById('start-hint');
    const active = Object.values(players).filter(p => p.connected && !p.isSpectator);
    if (isHost) {
      btn.disabled     = active.length < 2;
      hint.textContent = active.length < 2 ? 'Need at least 2 players.' : 'Ready!';
    } else {
      btn.disabled     = true;
      hint.textContent = 'Waiting for host to start…';
    }
  }

  // ── Settings ──────────────────────────────────────────────
  function applySettings(s) {
    if (settingsDisabled) return;
    document.getElementById('setting-prompt-timer').value = s.promptTimer || 60;
    document.getElementById('setting-draw-timer').value   = s.drawTimer   || 90;
    document.getElementById('setting-desc-timer').value   = s.descTimer   || 60;
    document.getElementById('setting-max-players').value  = s.maxPlayers  || 8;
    document.getElementById('setting-spectators').checked = s.spectators !== false;
    document.getElementById('setting-profanity').checked  = s.profanity   || false;
    document.getElementById('setting-theme').value        = s.theme       || '';
  }

  function setupSettingsListeners() {
    const ids = ['setting-prompt-timer','setting-draw-timer','setting-desc-timer',
                 'setting-max-players','setting-spectators','setting-profanity','setting-theme'];
    ids.forEach(id => {
      const el  = document.getElementById(id);
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, async () => {
        if (!isHost) return;
        settingsDisabled = true;
        const settings = {
          promptTimer: parseInt(document.getElementById('setting-prompt-timer').value),
          drawTimer:   parseInt(document.getElementById('setting-draw-timer').value),
          descTimer:   parseInt(document.getElementById('setting-desc-timer').value),
          maxPlayers:  parseInt(document.getElementById('setting-max-players').value),
          spectators:  document.getElementById('setting-spectators').checked,
          profanity:   document.getElementById('setting-profanity').checked,
          theme:       document.getElementById('setting-theme').value.trim()
        };
        // ── CHANGED: settings stored as jsonb column on rooms ──
        await FB.dbUpdate('rooms', { id: roomId }, { settings });
        setTimeout(() => { settingsDisabled = false; }, 500);
      });
      el.disabled = !isHost;
    });
  }

  function updateHostUI() {
    const ids = ['setting-prompt-timer','setting-draw-timer','setting-desc-timer',
                 'setting-max-players','setting-spectators','setting-profanity','setting-theme'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isHost;
    });
    document.getElementById('btn-start-game').disabled = !isHost;
    document.getElementById('start-hint').textContent  = isHost
      ? 'You are the host.'
      : 'Waiting for host to start…';
  }

  // ── Chat ──────────────────────────────────────────────────
  // ── CHANGED: 'child_added' → INSERT listener on chat table ──
  function setupChat(scope) {
    const msgBox  = document.getElementById(`${scope}-chat-messages`);
    const input   = document.getElementById(`${scope}-chat-input`);
    const sendBtn = document.getElementById(`btn-${scope}-chat-send`);

    // Load existing messages
    FB.dbGetAll('chat', { room_id: roomId }).then(rows => {
      rows
        .filter(m => m.context === scope)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
        .forEach(m => appendChatMsg(msgBox, m));
    });

    // Live new messages
    const unsub = FB.dbOn({
      table: 'chat', event: 'INSERT',
      match: { room_id: roomId },
      callback: payload => {
        const m = payload.new;
        if (m.context !== scope) return;
        appendChatMsg(msgBox, m);
      }
    });
    unsubFns.push(unsub);

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      FB.dbPush('chat', {
        room_id:    roomId,
        context:    scope,
        uid:        playerId,
        author:     playerName,
        text:       filterProfanity(text),
        created_at: Date.now()
      });
    };

    sendBtn.onclick = send;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  function appendChatMsg(msgBox, m) {
    const div = document.createElement('div');
    div.className = `chat-msg ${m.system ? 'system' : ''}`;
    if (m.system) {
      div.textContent = m.text;
    } else {
      const name = document.createElement('span');
      name.className   = 'msg-author';
      name.style.color = COLORS[avatarIndex(m.uid) % COLORS.length];
      name.textContent = escHtml(m.author) + ':';
      div.appendChild(name);
      div.appendChild(document.createTextNode(' ' + escHtml(m.text)));
    }
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function sendSystemMessage(scope, text) {
    FB.dbPush('chat', { room_id: roomId, context: scope, system: true, text, created_at: Date.now() });
  }

  // ── Helpers ───────────────────────────────────────────────
  function avatarIndex(uid) {
    if (!uid) return 0;
    let n = 0;
    for (let i = 0; i < Math.min(uid.length, 8); i++) n += uid.charCodeAt(i);
    return n % 10;
  }

  const PROFANITY = ['badword1','badword2'];
  function filterProfanity(text) {
    const on = document.getElementById('setting-profanity')?.checked;
    if (!on) return text;
    let out = text;
    PROFANITY.forEach(w => { out = out.replace(new RegExp(w, 'gi'), '*'.repeat(w.length)); });
    return out;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function cleanup() {
    unsubFns.forEach(fn => fn());
    unsubFns = [];
  }

  return {
    createRoom, joinRoom, rejoinRoom, enterLobby, leaveRoom, cleanup,
    setupChat, sendSystemMessage,
    getRoomId, getPlayerId, getIsHost,
    get playerName() { return playerName; },
    get isSpectator() { return isSpectator; },
    avatarIndex, escHtml, filterProfanity,
    pushUnsub(fn) { unsubFns.push(fn); },
    normalizePlayer, fetchAndSync
  };
})();

window.Lobby = Lobby;
