// ═══════════════════════════════════════════════════════════
//  app.js — Entry point, screen router, auth, toasts
// ═══════════════════════════════════════════════════════════

const App = (() => {

  const screens = {
    landing:     document.getElementById('screen-landing'),
    lobby:       document.getElementById('screen-lobby'),
    prompt:      document.getElementById('screen-prompt'),
    drawing:     document.getElementById('screen-drawing'),
    description: document.getElementById('screen-description'),
    waiting:     document.getElementById('screen-waiting'),
    reveal:      document.getElementById('screen-reveal'),
    gameover:    document.getElementById('screen-gameover')
  };

  let pendingAction = null;
  let pendingCode   = null;

  // ── Show screen ───────────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => {
      s.classList.remove('active');
      s.style.display = '';
    });
    const target = screens[name];
    if (target) target.classList.add('active');
  }

  // ── Toast ─────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation  = 'none';
      el.style.opacity    = '0';
      el.style.transform  = 'translateX(24px)';
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  // ── Landing ───────────────────────────────────────────────
  function bindLanding() {
    document.getElementById('btn-create-room').onclick = () => {
      pendingAction = 'create';
      showNameForm();
    };

    document.getElementById('btn-join-room').onclick = () => {
      document.getElementById('join-form').classList.remove('hidden');
      document.getElementById('join-code-input').focus();
    };

    document.getElementById('btn-join-confirm').onclick = () => {
      const code = document.getElementById('join-code-input').value.trim().toUpperCase();
      if (code.length < 4) { toast('Enter a valid room code.', 'warn'); return; }
      pendingCode   = code;
      pendingAction = 'join';
      document.getElementById('join-form').classList.add('hidden');
      showNameForm();
    };

    document.getElementById('join-code-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
    });

    document.getElementById('btn-name-confirm').onclick = () => confirmName();
    document.getElementById('name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmName();
    });
  }

  function showNameForm() {
    document.getElementById('name-form').classList.remove('hidden');
    document.getElementById('name-input').focus();
    const saved = localStorage.getItem('sc_name');
    if (saved) document.getElementById('name-input').value = saved;
  }

  async function confirmName() {
    const name = document.getElementById('name-input').value.trim();
    if (!name) { toast('Enter your name!', 'warn'); return; }
    localStorage.setItem('sc_name', name);
    document.getElementById('name-form').classList.add('hidden');
    if (pendingAction === 'create') await doCreate(name);
    else if (pendingAction === 'join') await doJoin(name, pendingCode);
  }

  async function doCreate(name) {
    try {
      const code = await Lobby.createRoom(name);
      toast(`Room created: ${code}`, 'success');
      showScreen('lobby');
      Lobby.enterLobby();
      Game.watchRoom(code);
      saveSession(code, Lobby.getPlayerId());
    } catch (e) {
      toast('Failed to create room: ' + e.message, 'error');
    }
  }

  async function doJoin(name, code) {
    try {
      const result = await Lobby.joinRoom(code, name);
      if (result.isSpectator) toast('Room full — joined as spectator.', 'warn');
      else toast(`Joined room ${code}!`, 'success');
      showScreen('lobby');
      Lobby.enterLobby();
      Game.watchRoom(code);
      saveSession(code, Lobby.getPlayerId());
    } catch (e) {
      toast(e.message, 'error');
      document.getElementById('join-form').classList.remove('hidden');
    }
  }

  // ── Session ───────────────────────────────────────────────
  function saveSession(roomId, playerId) {
    sessionStorage.setItem('sc_room',   roomId);
    sessionStorage.setItem('sc_player', playerId);
  }

  async function tryRejoin() {
    const savedRoom   = sessionStorage.getItem('sc_room');
    const savedPlayer = sessionStorage.getItem('sc_player');
    if (!savedRoom || !savedPlayer) return false;

    try {
      const ok = await Lobby.rejoinRoom(savedRoom, savedPlayer);
      if (!ok) return false;

      // ── CHANGED: table-based dbGet instead of path-based ──
      const room = await FB.dbGet('rooms', { id: savedRoom });
      if (!room) return false;

      showScreen('lobby');
      if (room.state === 'LOBBY') Lobby.enterLobby();
      Game.watchRoom(savedRoom);
      toast('Reconnected to room!', 'success');
      return true;
    } catch {
      return false;
    }
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    showScreen('waiting');
    document.getElementById('waiting-big-text').textContent = 'Connecting…';

    try {
      await FB.ensureAuth();
    } catch (e) {
      toast('Auth failed. Check Supabase config.', 'error');
      showScreen('landing');
      bindLanding();
      return;
    }

    const rejoined = await tryRejoin();
    if (!rejoined) showScreen('landing');
    bindLanding();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.getElementById('join-form').classList.add('hidden');
        document.getElementById('name-form').classList.add('hidden');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { showScreen, toast };
})();

window.App = App;
