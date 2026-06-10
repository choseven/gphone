const Chat = (function () {
  let profanity = false;

  function initLobby(room, me) {
    const log = document.getElementById('lobby-chat-messages');
    const input = document.getElementById('lobby-chat-input');
    const sendBtn = document.getElementById('btn-lobby-chat-send');
    if (!log || !input || !sendBtn) return;

    log.innerHTML = '';

    Realtime.on('chat', function(payload) {
      if (payload.new && payload.new.scope === 'lobby') {
        appendMsg(log, payload.new, me.id, profanity);
      }
    });

    function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      db().from('chat_messages').insert({
        room_id: room.id,
        player_id: me.id,
        username: me.username,
        avatar: me.avatar,
        content: text,
        scope: 'lobby'
      }).catch(function() {});
    }

    sendBtn.onclick = send;
    input.onkeydown = function(e) { if (e.key === 'Enter') send(); };

    // Load recent messages
    db().from('chat_messages').select('*')
      .eq('room_id', room.id).eq('scope', 'lobby')
      .order('created_at', { ascending: true }).limit(50)
      .then(function(res) {
        (res.data || []).forEach(function(msg) {
          appendMsg(log, msg, me.id, profanity);
        });
      });
  }

  function initReveal(room, me) {
    const log = document.getElementById('reveal-chat-messages');
    const input = document.getElementById('reveal-chat-input');
    const sendBtn = document.getElementById('btn-reveal-chat-send');
    if (!log || !input || !sendBtn) return;

    log.innerHTML = '';

    Realtime.on('chat_reveal', function(payload) {
      if (payload.new && payload.new.scope === 'reveal') {
        appendMsg(log, payload.new, me.id, profanity);
      }
    });

    function send() {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      db().from('chat_messages').insert({
        room_id: room.id,
        player_id: me.id,
        username: me.username,
        avatar: me.avatar,
        content: text,
        scope: 'reveal'
      }).catch(function() {});
    }

    sendBtn.onclick = send;
    input.onkeydown = function(e) { if (e.key === 'Enter') send(); };
  }

  function appendMsg(log, msg, myId, filter) {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (msg.player_id === myId ? ' me' : '');
    const em = avatarFor(msg.avatar);
    const name = msg.player_id === myId ? 'You' : escapeHtml(msg.username || 'Someone');
    const text = cleanText(escapeHtml(msg.content || ''), filter);
    div.innerHTML = '<span class="chat-em">' + em + '</span><span class="chat-name">' + name + ':</span> ' + text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function setProfanity(v) { profanity = !!v; }

  return { initLobby, initReveal, setProfanity };
})();
