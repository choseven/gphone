const Lobby = (function () {
  let players = [];

  async function enter(room, me) {
    App.showScreen('lobby');
    location.hash = room.code;

    $('#lobby-room-code').textContent = room.code;

    await refreshPlayers();
    Chat.initLobby(room, me);
    Settings.init(room, me.is_host);

    $('#btn-copy-code').onclick = () => {
      copyToClipboard(inviteLink(room.code));
      showToast('Room code copied!', 'success');
    };

    $('#btn-leave-lobby').onclick = async () => {
      await Room.leave();
      App.goHome();
    };

    $('#btn-start-game').onclick = () => Game.start();

    Realtime.on('players', () => refreshPlayers());
    Realtime.on('room', p => {
      if (p.new && p.new.state && p.new.state !== 'WAITING') {
        Game.enter(Room.get(), Room.getMe());
      }
    });
  }

  async function refreshPlayers() {
    const room = Room.get();
    if (!room) return;

    const { data } = await db()
      .from('players')
      .select('*')
      .eq('room_id', room.id)
      .order('joined_at', { ascending: true });

    players = data || [];

    const me = Room.getMe();
    if (!me) return;

    const mine = players.find(p => p.id === me.id);
    if (mine) {
      me.is_host = mine.is_host;
      me.is_ready = mine.is_ready;
      Room.setMe(me);
    }

    if (!players.find(p => p.id === me.id)) {
      showToast('You were removed from the room', 'error');
      Room.clearSession();
      App.goHome();
      return;
    }

    renderPlayers();
    renderStartButton();
  }

  function renderPlayers() {
    const me = Room.getMe();
    const list = $('#player-list');
    list.innerHTML = '';

    players.forEach((p, i) => {
      const card = document.createElement('div');
      const colorIdx = i % 10;
      card.className = [
        'player-card',
        p.id === me?.id ? 'is-you' : '',
        p.is_host ? 'is-host' : ''
      ].filter(Boolean).join(' ');

      const badges = [];
      if (p.is_spectator) badges.push('<div class="player-badge">spectating</div>');
      if (!p.is_connected) badges.push('<div class="player-badge">away</div>');

      card.innerHTML = `
        <div class="player-avatar av-${colorIdx}">${avatarFor(p.avatar)}</div>
        <div style="min-width:0">
          <div class="player-name">${escapeHtml(p.username)}${p.id === me?.id ? ' (you)' : ''}</div>
          ${badges.join('')}
        </div>
      `;
      list.appendChild(card);
    });
  }

  function renderStartButton() {
    const me = Room.getMe();
    const btn = $('#btn-start-game');
    const hint = $('#start-hint');
    const active = players.filter(p => !p.is_spectator && p.is_connected);

    if (me?.is_host) {
      btn.disabled = active.length < 2;
      hint.textContent = active.length < 2
        ? `Need at least 2 players (${active.length} here)`
        : 'Ready to start!';
    } else {
      btn.disabled = true;
      hint.textContent = 'Waiting for host to start…';
    }
  }

  function returnToLobby() {
    const room = Room.get();
    if (!room) { App.goHome(); return; }
    enter(room, Room.getMe());
  }

  function getPlayers() { return players; }

  return { enter, refreshPlayers, returnToLobby, getPlayers };
})();
