const App = (function () {
  let pendingAction = null;
  let pendingCode = null;

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    else console.warn('Screen not found: screen-' + name);
  }

  function goHome() {
    showScreen('landing');
    location.hash = '';
    document.getElementById('join-form').classList.add('hidden');
    document.getElementById('name-form').classList.add('hidden');
    pendingAction = null;
    pendingCode = null;
  }

  async function boot() {
    // Bind UI first — before any async work that might fail
    const stored = getStoredName();
    if (stored) document.getElementById('name-input').value = stored;
    bindLanding();

    // Initialize Supabase
    try {
      initSupabase();
    } catch (e) {
      showToast('Could not connect to server: ' + e.message, 'error', 8000);
      return;
    }

    // Try to rejoin a saved session
    try {
      const rejoin = await Room.tryRejoin();
      if (rejoin) {
        await Realtime.subscribe(rejoin.room.id, rejoin.me.id);
        if (rejoin.room.state === 'WAITING') {
          Lobby.enter(rejoin.room, rejoin.me);
        } else if (rejoin.room.state === 'FINISHED') {
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
      document.getElementById('join-code-input').value = code;
      pendingAction = 'join';
      document.getElementById('join-form').classList.remove('hidden');
      document.getElementById('name-form').classList.add('hidden');
    }
  }

  function bindLanding() {
    document.getElementById('btn-create-room').onclick = () => {
      pendingAction = 'create';
      pendingCode = null;
      document.getElementById('join-form').classList.add('hidden');
      document.getElementById('name-form').classList.remove('hidden');
      document.getElementById('name-input').focus();
    };

    document.getElementById('btn-join-room').onclick = () => {
      pendingAction = 'join';
      document.getElementById('join-form').classList.remove('hidden');
      document.getElementById('name-form').classList.add('hidden');
    };

    document.getElementById('btn-join-confirm').onclick = () => {
      const code = document.getElementById('join-code-input').value.trim().toUpperCase();
      if (!code || code.length < 4) { showToast('Enter a valid room code', 'error'); return; }
      pendingCode = code;
      pendingAction = 'join';
      document.getElementById('join-form').classList.add('hidden');
      document.getElementById('name-form').classList.remove('hidden');
      document.getElementById('name-input').focus();
    };

    document.getElementById('join-code-input').onkeydown = e => {
      if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
    };

    document.getElementById('btn-name-confirm').onclick = async () => {
      const name = document.getElementById('name-input').value.trim() || 'Player';
      setStoredName(name);
      const btn = document.getElementById('btn-name-confirm');
      btn.disabled = true;
      try {
        if (pendingAction === 'create') await doCreate();
        else if (pendingAction === 'join' && pendingCode) await doJoin(pendingCode);
        else showToast('Choose Create or Join first', 'warn');
      } finally {
        btn.disabled = false;
      }
    };

    document.getElementById('name-input').onkeydown = e => {
      if (e.key === 'Enter') document.getElementById('btn-name-confirm').click();
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
      if (room.state === 'WAITING') Lobby.enter(room, me);
      else if (room.state === 'FINISHED') await Reveal.load(room, {});
      else Game.enter(room, me);
      showToast(rejoined ? 'Welcome back!' : 'Joined!', 'success');
    } catch (e) {
      showToast(e.message || 'Could not join room', 'error');
    }
  }

  window.addEventListener('beforeunload', () => {
    const me = Room.getMe();
    if (me) { try { db().from('players').update({ is_connected: false }).eq('id', me.id); } catch (_) {} }
  });

  return { showScreen, goHome, boot };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
