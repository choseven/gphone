const Chat = (function () {

  // ── LOBBY CHAT ────────────────────────────────────────────
  function initLobby(room, me) {
    const log = $('#lobby-chat-messages');
    if (!log) return;
    log.innerHTML = '';
    loadHistory(room.id, log);

    const send = () => {
      const input = $('#lobby-chat-input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      db().from('chat_messages').insert({ room_id: room.id, player_id: me.id, username: me.username, body });
    };

    const sendBtn = $('#btn-lobby-chat-send');
    if (sendBtn) sendBtn.onclick = send;
    const inp = $('#lobby-chat-input');
    if (inp) inp.onkeydown = e => { if (e.key === 'Enter') send(); };

    Realtime.on('chat', payload => {
      if (payload.eventType === 'INSERT') appendMsg(log, payload.new);
    });
  }

  // ── REVEAL CHAT ───────────────────────────────────────────
  function initReveal(room, me) {
    const log = $('#reveal-chat-messages');
    if (!log) return;
    log.innerHTML = '';
    loadHistory(room.id, log);

    const send = () => {
      const input = $('#reveal-chat-input');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      db().from('chat_messages').insert({ room_id: room.id, player_id: me.id, username: me.username, body });
    };

    const sendBtn = $('#btn-reveal-chat-send');
    if (sendBtn) sendBtn.onclick = send;
    const inp = $('#reveal-chat-input');
    if (inp) inp.onkeydown = e => { if (e.key === 'Enter') send(); };

    // Add a second listener for reveal log (may co-exist with lobby listener)
    Realtime.on('chat', payload => {
      if (payload.eventType === 'INSERT') appendMsg(log, payload.new);
    });
  }

  async function loadHistory(roomId, log) {
    const { data } = await db()
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(60);
    (data || []).forEach(msg => appendMsg(log, msg));
  }

  function appendMsg(log, msg) {
    if (!log) return;
    const el = document.createElement('div');
    if (msg.player_id === null && msg.username === 'system') {
      el.className = 'chat-msg system';
      el.textContent = msg.body;
    } else {
      el.className = 'chat-msg';
      el.innerHTML = `<span class="msg-author">${escapeHtml(msg.username)}:</span> ${escapeHtml(msg.body)}`;
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  async function system(roomId, text) {
    await db().from('chat_messages').insert({ room_id: roomId, player_id: null, username: 'system', body: text });
  }

  return { initLobby, initReveal, system };
})();
