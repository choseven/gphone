const Settings = (function () {
  let room = null;
  let me = null;

  function init(r, m) {
    room = r; me = m;
    load();
  }

  async function load() {
    const { data: set } = await db()
      .from('settings').select('*').eq('room_id', room.id).single();

    const isHost = me && me.is_host;

    setVal('setting-prompt-timer',  set?.prompt_timer     || 60);
    setVal('setting-draw-timer',    set?.drawing_timer    || 90);
    setVal('setting-desc-timer',    set?.description_timer|| 60);
    setVal('setting-profanity',     set?.profanity_filter ? '1' : '0');

    const selects = ['setting-prompt-timer','setting-draw-timer','setting-desc-timer','setting-profanity'];
    selects.forEach(function(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = !isHost;
      if (isHost) {
        el.onchange = save;
      }
    });
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = String(val);
  }

  async function save() {
    if (!me || !me.is_host) return;
    const promptTimer  = parseInt(document.getElementById('setting-prompt-timer')?.value || '60', 10);
    const drawTimer    = parseInt(document.getElementById('setting-draw-timer')?.value   || '90', 10);
    const descTimer    = parseInt(document.getElementById('setting-desc-timer')?.value   || '60', 10);
    const profanity    = document.getElementById('setting-profanity')?.value === '1';

    await db().from('settings').upsert({
      room_id: room.id,
      prompt_timer: promptTimer,
      drawing_timer: drawTimer,
      description_timer: descTimer,
      profanity_filter: profanity
    }, { onConflict: 'room_id' });
  }

  return { init };
})();
