const Realtime = (function () {
  let channel = null;
  let roomId = null;
  let handlers = {};
  let heartbeat = null;

  function on(event, fn) {
    handlers[event] = handlers[event] || [];
    handlers[event].push(fn);
  }

  function emit(event, payload) {
    (handlers[event] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }

  async function subscribe(rid, playerId) {
    roomId = rid;
    if (channel) await unsubscribe();

    channel = db().channel('room:' + rid, { config: { presence: { key: playerId } } });

    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + rid }, p => emit('room', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'room_id=eq.' + rid }, p => emit('players', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: 'room_id=eq.' + rid }, p => emit('settings', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_states', filter: 'room_id=eq.' + rid }, p => emit('game_state', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chain_entries', filter: 'room_id=eq.' + rid }, p => emit('chain_entry', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: 'room_id=eq.' + rid }, p => emit('chat', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes', filter: 'room_id=eq.' + rid }, p => emit('vote', p))
      .on('broadcast', { event: 'stroke' }, p => emit('stroke', p.payload))
      .on('broadcast', { event: 'cursor' }, p => emit('cursor', p.payload))
      .on('presence', { event: 'sync' }, () => emit('presence', channel.presenceState()))
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ player_id: playerId, online_at: Date.now() });
          emit('connected', {});
          startHeartbeat(playerId);
        }
      });
  }

  function startHeartbeat(playerId) {
    clearInterval(heartbeat);
    heartbeat = setInterval(async () => {
      try {
        await db().from('players').update({ last_seen: new Date().toISOString(), is_connected: true }).eq('id', playerId);
      } catch (e) {}
    }, 15000);
  }

  function broadcast(event, payload) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event, payload });
  }

  async function unsubscribe() {
    clearInterval(heartbeat);
    if (channel) {
      try { await db().removeChannel(channel); } catch (e) {}
    }
    channel = null;
    handlers = {};
  }

  return { on, emit, subscribe, unsubscribe, broadcast };
})();
