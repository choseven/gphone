const Chat = (function () {
  let roomId = null;
  let me = null;

  function init(room, player) {
    roomId = room.id;
    me = player;
    const log = $('#chat-log');
    log.innerHTML = '';
    loadHistory();

    $('#chat-send').onclick = send;
    $('#chat-input').onkeydown = e => { if (e.key === 'Enter') send(); };

    Realtime.on('chat', payload => {
      if (payload.eventType === 'INSERT') append(payload.new);
    });
  }

  async function loadHistory() {
    const { data } = await db().from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true }).limit(50);
    (data || []).forEach(append);
  }

  function append(msg) {
    const log = $('#chat-log');
    const el = document.createElement('div');
    if (msg.player_id === null && msg.username === 'system') {
      el.className = 'chat-msg system';
      el.textContent = msg.body;
    } else {
      el.className = 'chat-msg';
      el.innerHTML = `<span class="cname">${escapeHtml(msg.username)}:</span> ${escapeHtml(msg.body)}`;
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const input = $('#chat-input');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    await db().from('chat_messages').insert({ room_id: roomId, player_id: me.id, username: me.username, body });
  }

  async function system(text) {
    await db().from('chat_messages').insert({ room_id: roomId, player_id: null, username: 'system', body: text });
  }

  return { init, system };
})();
