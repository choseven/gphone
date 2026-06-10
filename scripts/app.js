const App = (function () {
  let pendingAction = null; // 'create' | 'join'
  let pendingCode = null;

  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    else console.warn('Screen not found: screen-' + name);
  }

  function goHome() {
    showScreen('landing');
    location.hash = '';
    $('#join-form').classList.add('hidden');
    $('#name-form').classList.add('hidden');
    pendingAction = null;
    pendingCode = null;
  }

  async function boot() {
    initSupabase();

    const stored = getStoredName();
    if (stored) $('#name-input').value = stored;

    bindLanding();

    // Try to rejoin an existing session
    try {
      const rejoin = await Room.tryRejoin();
      if (rejoin) {
        await Realtime.subscribe(rejoin.room.id, rejoin.me.id);
        if (rejoin.room.state === 'WAITING') {
          Lobby.enter(rejoin.room, rejoin.me);
        } else if (rejoin.room.state === 'FINISHED') {
          showScreen('reveal');
          await Reveal.load(rejoin.room, {});
        } else {
          Game.enter(rejoin.room, rejoin.me);
        }
        showToast('Reconnected!', 'success');
        return;
      }
    } catch (_) {}

    // Check URL hash for invite code
    const code = hashCode();
    if (code) {
      $('#join-code-input').value = code;
      showJoinFlow();
    }
  }

  function showJoinFlow() {
    pendingAction = 'join';
    $('#join-form').classList.remove('hidden');
    $('#name-form').classList.add('hidden');
  }

  function bindLanding() {
    $('#btn-create-room').onclick = () => {
      pendingAction = 'create';
      pendingCode = null;
      $('#join-form').classList.add('hidden');
      $('#name-form').classList.remove('hidden');
      $('#name-input').focus();
    };

    $('#btn-join-room').onclick = showJoinFlow;

    $('#btn-join-confirm').onclick = () => {
      const code = $('#join-code-input').value.trim().toUpperCase();
      if (!code || code.length < 4) {
        showToast('Enter a valid room code', 'error');
        return;
      }
      pendingCode = code;
      pendingAction = 'join';
      $('#join-form').classList.add('hidden');
      $('#name-form').classList.remove('hidden');
      $('#name-input').focus();
    };

    $('#join-code-input').onkeydown = e => {
      if (e.key === 'Enter') $('#btn-join-confirm').click();
    };

    $('#btn-name-confirm').onclick = async () => {
      const name = $('#name-input').value.trim() || 'Player';
      setStoredName(name);
      $('#btn-name-confirm').disabled = true;
      try {
        if (pendingAction === 'create') {
          await doCreate();
        } else if (pendingAction === 'join' && pendingCode) {
          await doJoin(pendingCode);
        } else {
          showToast('Please choose Create or Join first', 'warn');
        }
      } finally {
        $('#btn-name-confirm').disabled = false;
      }
    };

    $('#name-input').onkeydown = e => {
      if (e.key === 'Enter') $('#btn-name-confirm').click();
    };
  }

  async function doCreate() {
    try {
      const { room, me } = await Room.create(false);
      await Realtime.subscribe(room.id, me.id);
      Lobby.enter(room, me);
    } catch (e) {
      showToast(e.message || 'Could not create room', 'error');
    }
  }

  async function doJoin(code) {
    try {
      const { room, me, rejoined } = await Room.join(code);
      await Realtime.subscribe(room.id, me.id);
      if (room.state === 'WAITING') {
        Lobby.enter(room, me);
      } else if (room.state === 'FINISHED') {
        showScreen('reveal');
        await Reveal.load(room, {});
      } else {
        Game.enter(room, me);
      }
      showToast(rejoined ? 'Welcome back!' : 'Joined!', 'success');
    } catch (e) {
      showToast(e.message || 'Could not join room', 'error');
    }
  }

  window.addEventListener('beforeunload', () => {
    const me = Room.getMe();
    if (me) {
      try { db().from('players').update({ is_connected: false }).eq('id', me.id); } catch (_) {}
    }
  });

  return { showScreen, goHome, boot };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
