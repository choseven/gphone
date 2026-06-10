const App = (function () {
  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
  }

  function goHome() {
    showScreen('home');
    location.hash = '';
    loadPublic();
  }

  async function boot() {
    initSupabase();
    $('#name-input').value = getStoredName();
    $('#avatar-pick').textContent = avatarFor(getStoredAvatar());

    bindHome();
    bindAuth();
    await refreshAuthUi();

    const rejoin = await Room.tryRejoin().catch(() => null);
    if (rejoin) {
      await Realtime.subscribe(rejoin.room.id, rejoin.me.id);
      if (['WAITING'].includes(rejoin.room.state)) {
        Lobby.enter(rejoin.room, rejoin.me);
      } else if (rejoin.room.state === 'FINISHED') {
        showScreen('reveal');
        const { data: set } = await db().from('settings').select('*').eq('room_id', rejoin.room.id).single();
        Reveal.load(rejoin.room, set);
      } else {
        Game.enter(rejoin.room, rejoin.me);
      }
      showToast('Reconnected', 'success');
      return;
    }

    const code = hashCode();
    if (code) $('#code-input').value = code;
    loadPublic();
  }

  function bindHome() {
    $('#brand').onclick = () => { if (confirm('Leave and go home?')) location.reload(); };
    $('#avatar-pick').onclick = openAvatarPicker;

    $('#create-btn').onclick = async () => {
      try {
        toggleBusy(true);
        const { room, me } = await Room.create($('#public-toggle').checked);
        await Realtime.subscribe(room.id, me.id);
        Lobby.enter(room, me);
      } catch (e) { showToast(e.message || 'Could not create room', 'error'); }
      finally { toggleBusy(false); }
    };

    $('#join-btn').onclick = joinFlow;
    $('#code-input').onkeydown = e => { if (e.key === 'Enter') joinFlow(); };
    $('#refresh-public').onclick = loadPublic;

    if (hashCode()) $('#code-input').value = hashCode();
  }

  async function joinFlow() {
    const code = $('#code-input').value.trim();
    if (!code) { showToast('Enter a room code', 'error'); return; }
    try {
      toggleBusy(true);
      const { room, me, rejoined } = await Room.join(code);
      await Realtime.subscribe(room.id, me.id);
      if (room.state === 'WAITING') Lobby.enter(room, me);
      else if (room.state === 'FINISHED') {
        showScreen('reveal');
        const { data: set } = await db().from('settings').select('*').eq('room_id', room.id).single();
        Reveal.load(room, set);
      } else Game.enter(room, me);
      showToast(rejoined ? 'Welcome back' : 'Joined room', 'success');
    } catch (e) { showToast(e.message || 'Could not join', 'error'); }
    finally { toggleBusy(false); }
  }

  async function loadPublic() {
    const list = $('#public-list');
    list.innerHTML = '<div class="meta">Loading...</div>';
    try {
      const rooms = await Room.listPublic();
      if (!rooms.length) { list.innerHTML = '<div class="meta">No public rooms right now.</div>'; return; }
      list.innerHTML = '';
      rooms.forEach(r => {
        const count = r.players?.[0]?.count ?? 0;
        const item = document.createElement('div');
        item.className = 'public-item';
        item.innerHTML = `<span><b>${r.code}</b> <span class="meta">${r.mode}</span></span><span class="meta">${count} players</span>`;
        item.onclick = () => { $('#code-input').value = r.code; joinFlow(); };
        item.style.cursor = 'pointer';
        list.appendChild(item);
      });
    } catch (e) { list.innerHTML = '<div class="meta">Could not load rooms.</div>'; }
  }

  function toggleBusy(on) {
    $('#create-btn').disabled = on;
    $('#join-btn').disabled = on;
  }

  function openAvatarPicker() {
    const root = $('#modal-root');
    const cur = getStoredAvatar();
    root.innerHTML = `<div class="modal-overlay"><div class="modal">
      <h2>Pick an avatar</h2>
      <div class="avatar-grid">
        ${AVATARS.map((a, i) => `<button data-i="${i}" class="${String(i) === cur ? 'sel' : ''}">${a}</button>`).join('')}
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="modal-close">Close</button></div>
    </div></div>`;
    $$('.avatar-grid button', root).forEach(b => {
      b.onclick = () => {
        setStoredAvatar(b.dataset.i);
        $('#avatar-pick').textContent = avatarFor(b.dataset.i);
        root.innerHTML = '';
      };
    });
    $('#modal-close').onclick = () => root.innerHTML = '';
  }

  function bindAuth() {
    $('#auth-btn').onclick = async () => {
      const user = await getAuthUser();
      if (user) { await signOut(); await refreshAuthUi(); showToast('Signed out'); return; }
      openAuthModal();
    };
  }

  function openAuthModal() {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal">
      <h2>Account</h2>
      <p class="phase-hint" style="margin-bottom:14px">Optional — saves your name across games.</p>
      <input id="auth-email" class="input" placeholder="Email" style="margin-bottom:10px">
      <input id="auth-pass" type="password" class="input" placeholder="Password">
      <div class="modal-actions">
        <button class="btn btn-secondary" id="auth-signup">Sign up</button>
        <button class="btn btn-primary" id="auth-signin">Sign in</button>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" id="auth-cancel">Cancel</button></div>
    </div></div>`;
    const email = () => $('#auth-email').value.trim();
    const pass = () => $('#auth-pass').value;
    $('#auth-signin').onclick = async () => {
      try { await signInWithEmail(email(), pass()); root.innerHTML = ''; await refreshAuthUi(); showToast('Signed in', 'success'); }
      catch (e) { showToast(e.message || 'Sign in failed', 'error'); }
    };
    $('#auth-signup').onclick = async () => {
      try { await signUpWithEmail(email(), pass()); root.innerHTML = ''; await refreshAuthUi(); showToast('Account created', 'success'); }
      catch (e) { showToast(e.message || 'Sign up failed', 'error'); }
    };
    $('#auth-cancel').onclick = () => root.innerHTML = '';
  }

  async function refreshAuthUi() {
    const user = await getAuthUser();
    if (user) {
      $('#auth-status').textContent = user.email;
      $('#auth-btn').textContent = 'Sign out';
    } else {
      $('#auth-status').textContent = '';
      $('#auth-btn').textContent = 'Sign in';
    }
  }

  window.addEventListener('beforeunload', () => {
    const me = Room.getMe();
    if (me) navigator.sendBeacon && db().from('players').update({ is_connected: false }).eq('id', me.id);
  });

  return { showScreen, goHome, boot, loadPublic };
})();

document.addEventListener('DOMContentLoaded', () => App.boot());
