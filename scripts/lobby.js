const Lobby = (function () {
  let room = null;
  let me = null;
  let players = [];

  function enter(r, m) {
    room = r; me = m;
    App.showScreen('lobby');

    // Show room code
    const codeEl = document.getElementById('lobby-room-code');
    if (codeEl) codeEl.textContent = room.code;

    // Copy-invite button
    const copyBtn = document.getElementById('btn-copy-invite');
    if (copyBtn) {
      copyBtn.onclick = function() {
        copyToClipboard(inviteLink(room.code)).then(function() {
          showToast('Invite link copied!', 'success');
        });
      };
    }

    // Host-only start button
    const startBtn = document.getElementById('btn-start-game');
    if (startBtn) {
      startBtn.classList.toggle('hidden', !me.is_host);
      startBtn.onclick = async function() {
        startBtn.disabled = true;
        try { await Game.start(); }
        catch (e) { showToast(e.message || 'Could not start', 'error'); }
        finally { startBtn.disabled = false; }
      };
    }

    // Settings panel
    Settings.init(room, me);

    // Chat
    Chat.initLobby(room, me);

    // Initial player list from room data
    loadPlayers();

    // Realtime updates
    Realtime.on('players', function(payload) {
      if (payload.new) upsertPlayer(payload.new);
      renderPlayers();
    });

    Realtime.on('room', function(payload) {
      if (!payload.new) return;
      const newRoom = payload.new;
      if (newRoom.state && newRoom.state !== 'WAITING') {
        Game.enter(newRoom, me);
      }
    });
  }

  async function loadPlayers() {
    const { data } = await db()
      .from('players').select('*').eq('room_id', room.id).order('joined_at', { ascending: true });
    players = data || [];
    renderPlayers();
  }

  function upsertPlayer(p) {
    const idx = players.findIndex(function(x) { return x.id === p.id; });
    if (idx >= 0) players[idx] = p;
    else players.push(p);
  }

  function renderPlayers() {
    const list = document.getElementById('player-list');
    if (!list) return;
    list.innerHTML = '';
    players.filter(function(p) { return p.is_connected !== false; }).forEach(function(p, i) {
      const card = document.createElement('div');
      card.className = 'player-card av-' + (i % 10) + (p.id === me.id ? ' is-you' : '') + (p.is_host ? ' is-host' : '');
      card.innerHTML =
        '<span class="player-avatar">' + avatarFor(p.avatar) + '</span>' +
        '<span class="player-name">' + escapeHtml(p.username) + '</span>' +
        (p.is_host ? '<span class="host-badge">HOST</span>' : '') +
        (p.id === me.id ? '<span class="you-badge">YOU</span>' : '');
      list.appendChild(card);
    });

    const count = document.getElementById('player-count');
    if (count) count.textContent = players.filter(function(p) { return p.is_connected !== false; }).length;
  }

  function getPlayers() { return players; }

  async function returnToLobby() {
    const { data: r } = await db().from('rooms').select('*').eq('id', room.id).single();
    const { data: m } = await db().from('players').select('*').eq('id', me.id).single();
    if (r && m) enter(r, m);
    else App.goHome();
  }

  return { enter, getPlayers, returnToLobby };
})();
