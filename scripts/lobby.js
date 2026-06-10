const Lobby = (function () {
  let players = [];

  async function enter(room, me) {
    App.showScreen('lobby');
    $('#lobby-code').textContent = room.code;
    await refreshPlayers();
    Chat.init(room, me);
    Settings.init(room, me.is_host);

    Realtime.on('players', () => refreshPlayers());
    Realtime.on('room', p => {
      if (p.new && p.new.state && p.new.state !== 'WAITING') {
        Game.enter(Room.get(), Room.getMe());
      }
    });

    $('#ready-btn').onclick = async () => {
      const r = await Room.toggleReady();
      $('#ready-btn').textContent = r ? 'Not ready' : 'Ready';
    };
    $('#start-btn').onclick = () => Game.start();
    $('#leave-btn').onclick = async () => { await Room.leave(); App.goHome(); };
    $('#copy-link').onclick = () => { copyToClipboard(inviteLink(room.code)); showToast('Invite link copied', 'success'); };
  }

  async function refreshPlayers() {
    const room = Room.get();
    if (!room) return;
    const { data } = await db().from('players').select('*').eq('room_id', room.id).order('joined_at', { ascending: true });
    players = data || [];
    const me = Room.getMe();
    const mine = players.find(p => p.id === me.id);
    if (mine) { me.is_host = mine.is_host; me.is_ready = mine.is_ready; Room.setMe(me); }

    if (!players.find(p => p.id === me.id)) {
      showToast('You were removed from the room', 'error');
      Room.clearSession();
      App.goHome();
      return;
    }

    render();
  }

  function render() {
    const me = Room.getMe();
    $('#player-count').textContent = players.length;
    const list = $('#player-list');
    list.innerHTML = '';
    players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-row';
      const tags = [];
      if (p.is_host) tags.push('<span class="ptag host">host</span>');
      else if (p.is_spectator) tags.push('<span class="ptag spectator">watching</span>');
      else if (p.is_ready) tags.push('<span class="ptag ready">ready</span>');
      if (!p.is_connected) tags.push('<span class="ptag spectator">away</span>');
      row.innerHTML = `<span class="pavatar">${avatarFor(p.avatar)}</span>
        <span class="pname">${escapeHtml(p.username)}${p.id === me.id ? ' (you)' : ''}</span>${tags.join('')}`;
      if (me.is_host && p.id !== me.id) {
        const kick = document.createElement('button');
        kick.className = 'pkick';
        kick.textContent = '✕';
        kick.title = 'Kick';
        kick.onclick = () => Room.kick(p.id);
        row.appendChild(kick);
        row.querySelector('.pname').style.cursor = 'pointer';
        row.querySelector('.pname').title = 'Click to make host';
        row.querySelector('.pname').onclick = () => {
          if (confirm(`Make ${p.username} the host?`)) Room.transferHost(p.id);
        };
      }
      list.appendChild(row);
    });

    const activePlayers = players.filter(p => !p.is_spectator);
    const allReady = activePlayers.every(p => p.is_ready);
    const startBtn = $('#start-btn');
    startBtn.style.display = me.is_host ? '' : 'none';
    startBtn.disabled = !(me.is_host && activePlayers.length >= 2 && allReady);
    $('#ready-btn').style.display = me.is_host ? 'none' : '';
  }

  function returnToLobby() {
    const room = Room.get();
    if (!room) { App.goHome(); return; }
    enter(room, Room.getMe());
  }

  function getPlayers() { return players; }

  return { enter, refreshPlayers, returnToLobby, getPlayers };
})();
