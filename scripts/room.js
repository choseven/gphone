const Room = (function () {
  let room = null;
  let me = null;

  async function create(isPublic) {
    const user = await getAuthUser();
    const name = $('#name-input').value.trim() || 'Player';
    setStoredName(name);
    const avatar = getStoredAvatar();
    const hostId = user?.id || (crypto.randomUUID ? crypto.randomUUID() : getClientId());
    const { data, error } = await db().rpc('create_room', {
      p_host_id: hostId,
      p_client_id: getClientId(),
      p_username: name,
      p_avatar: avatar,
      p_is_public: isPublic
    });
    if (error) throw error;
    room = data.room;
    me = data.player;
    persist();
    return { room, me };
  }

  async function join(code) {
    const user = await getAuthUser();
    const name = $('#name-input').value.trim() || getStoredName() || 'Player';
    setStoredName(name);
    const { data, error } = await db().rpc('join_room', {
      p_code: code.toUpperCase(),
      p_user_id: user?.id || null,
      p_client_id: getClientId(),
      p_username: name,
      p_avatar: getStoredAvatar()
    });
    if (error) throw error;
    room = data.room;
    me = data.player;
    persist();
    return { room, me, rejoined: data.rejoined };
  }

  async function tryRejoin() {
    const saved = JSON.parse(localStorage.getItem('gartic_session') || 'null');
    if (!saved) return null;
    const { data } = await db().from('rooms').select('*').eq('id', saved.roomId).single();
    if (!data) { clearSession(); return null; }
    const { data: p } = await db().from('players').select('*').eq('id', saved.playerId).single();
    if (!p) { clearSession(); return null; }
    await db().from('players').update({ is_connected: true, last_seen: new Date().toISOString() }).eq('id', p.id);
    room = data; me = p;
    return { room, me };
  }

  function persist() {
    localStorage.setItem('gartic_session', JSON.stringify({ roomId: room.id, playerId: me.id }));
  }
  function clearSession() { localStorage.removeItem('gartic_session'); }

  async function leave() {
    if (!me) return;
    const wasHost = me.is_host;
    if (wasHost) {
      const { data: others } = await db().from('players').select('*').eq('room_id', room.id).eq('is_connected', true).neq('id', me.id).order('joined_at', { ascending: true });
      if (others && others.length) {
        await db().from('players').update({ is_host: true, is_ready: true }).eq('id', others[0].id);
        await db().from('rooms').update({ host_id: others[0].user_id || others[0].id }).eq('id', room.id);
      }
    }
    await db().from('players').delete().eq('id', me.id);
    const { count } = await db().from('players').select('id', { count: 'exact', head: true }).eq('room_id', room.id);
    if (!count) await db().from('rooms').delete().eq('id', room.id);
    clearSession();
    await Realtime.unsubscribe();
    room = null; me = null;
  }

  async function kick(playerId) {
    if (!me?.is_host) return;
    await db().from('players').delete().eq('id', playerId);
  }

  async function transferHost(playerId) {
    if (!me?.is_host) return;
    const { data: target } = await db().from('players').select('*').eq('id', playerId).single();
    await db().from('players').update({ is_host: false }).eq('id', me.id);
    await db().from('players').update({ is_host: true, is_ready: true }).eq('id', playerId);
    await db().from('rooms').update({ host_id: target.user_id || target.id }).eq('id', room.id);
    me.is_host = false;
  }

  async function toggleReady() {
    me.is_ready = !me.is_ready;
    await db().from('players').update({ is_ready: me.is_ready }).eq('id', me.id);
    return me.is_ready;
  }

  async function listPublic() {
    const { data } = await db().from('rooms').select('code, state, mode, players(count)').eq('is_public', true).eq('state', 'WAITING').order('created_at', { ascending: false }).limit(20);
    return data || [];
  }

  function get() { return room; }
  function getMe() { return me; }
  function setRoom(r) { room = r; }
  function setMe(p) { me = p; }

  return { create, join, tryRejoin, leave, kick, transferHost, toggleReady, listPublic, get, getMe, setRoom, setMe, clearSession };
})();
