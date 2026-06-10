const Settings = (function () {
  let roomId = null;
  let isHost = false;
  let current = {};

  async function init(room, host) {
    roomId = room.id;
    isHost = host;

    const { data } = await db().from('settings').select('*').eq('room_id', roomId).single();
    current = data || {};

    syncToUI();

    if (isHost) {
      bindControls();
    } else {
      // Lock all controls for non-hosts
      $$('#settings-panel select, #settings-panel input').forEach(el => {
        el.disabled = true;
      });
    }

    Realtime.on('settings', p => {
      if (p.new) { current = p.new; syncToUI(); }
    });
  }

  function syncToUI() {
    setSelect('#setting-prompt-timer', current.prompt_timer ?? 60);
    setSelect('#setting-draw-timer', current.drawing_timer ?? 90);
    setSelect('#setting-desc-timer', current.description_timer ?? 60);

    const profanity = $('#setting-profanity');
    if (profanity) profanity.checked = current.profanity_filter || false;
  }

  function setSelect(selector, value) {
    const el = $(selector);
    if (!el) return;
    const opts = Array.from(el.options);
    // Find exact match first, then closest
    const exact = opts.find(o => parseInt(o.value, 10) === value);
    if (exact) { el.value = exact.value; return; }
    // Find closest option
    let best = opts[0];
    opts.forEach(o => {
      if (Math.abs(parseInt(o.value, 10) - value) < Math.abs(parseInt(best.value, 10) - value)) {
        best = o;
      }
    });
    if (best) el.value = best.value;
  }

  function bindControls() {
    const save = debounce(async (key, value) => {
      const patch = {};
      patch[key] = value;
      await db().from('settings').update(patch).eq('room_id', roomId);
    }, 300);

    const pt = $('#setting-prompt-timer');
    if (pt) pt.onchange = () => save('prompt_timer', parseInt(pt.value, 10));

    const dt = $('#setting-draw-timer');
    if (dt) dt.onchange = () => save('drawing_timer', parseInt(dt.value, 10));

    const desc = $('#setting-desc-timer');
    if (desc) desc.onchange = () => save('description_timer', parseInt(desc.value, 10));

    const pf = $('#setting-profanity');
    if (pf) pf.onchange = () => save('profanity_filter', pf.checked);
  }

  function get() { return current; }

  return { init, get };
})();
