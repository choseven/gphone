const Settings = (function () {
  let roomId = null;
  let isHost = false;
  let current = {};
  let mode = 'normal';

  const MODES = [
    { id: 'normal', name: 'Normal', enabled: true },
    { id: 'knockoff', name: 'Knockoff', enabled: false },
    { id: 'animation', name: 'Animation', enabled: false },
    { id: 'secret', name: 'Secret', enabled: false },
    { id: 'score', name: 'Score', enabled: false },
    { id: 'custom', name: 'Custom', enabled: false }
  ];

  async function init(room, host) {
    roomId = room.id;
    isHost = host;
    mode = room.mode || 'normal';
    const { data } = await db().from('settings').select('*').eq('room_id', roomId).single();
    current = data || {};
    render();
    Realtime.on('settings', p => { if (p.new) { current = p.new; render(); } });
    Realtime.on('room', p => { if (p.new && p.new.mode) { mode = p.new.mode; render(); } });
  }

  function render() {
    const wrap = $('#host-settings');
    const ro = isHost ? '' : 'settings-readonly';
    wrap.className = 'settings-wrap ' + ro;
    wrap.innerHTML = `
      <div class="setting-group">
        <h3>Mode</h3>
        <div class="mode-grid">
          ${MODES.map(m => `<div class="mode-card ${m.id === mode ? 'selected' : ''} ${m.enabled ? '' : 'disabled'}" data-mode="${m.id}">${m.name}${m.enabled ? '' : '<br><small>soon</small>'}</div>`).join('')}
        </div>
      </div>
      <div class="setting-group">
        <h3>Timing</h3>
        ${rangeRow('Prompt timer', 'prompt_timer', 10, 120, current.prompt_timer)}
        ${rangeRow('Drawing timer', 'drawing_timer', 30, 300, current.drawing_timer)}
        ${rangeRow('Description timer', 'description_timer', 10, 120, current.description_timer)}
      </div>
      <div class="setting-group">
        <h3>Gameplay</h3>
        <div class="setting-row"><label>Rounds</label>
          <select data-key="rounds">
            <option value="0">Auto (one per player)</option>
            ${[2,3,4,5,6,7,8].map(n => `<option value="${n}" ${current.rounds === n ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        ${rangeRow('Reveal speed', 'reveal_speed', 1, 5, current.reveal_speed)}
        ${toggleRow('Profanity filter', 'profanity_filter', current.profanity_filter)}
        ${toggleRow('Anonymous mode', 'anonymous', current.anonymous)}
        ${toggleRow('Allow late joining', 'late_joining', current.late_joining)}
        ${toggleRow('Spectator mode', 'spectator_mode', current.spectator_mode)}
      </div>
    `;

    if (isHost) bind(wrap);
  }

  function rangeRow(label, key, min, max, val) {
    const v = val != null ? val : min;
    return `<div class="setting-row"><label>${label}</label>
      <span><input type="range" data-key="${key}" min="${min}" max="${max}" value="${v}"> <b data-out="${key}">${v}</b></span></div>`;
  }
  function toggleRow(label, key, val) {
    return `<div class="setting-row"><label>${label}</label>
      <input type="checkbox" data-key="${key}" ${val ? 'checked' : ''}></div>`;
  }

  function bind(wrap) {
    $$('.mode-card', wrap).forEach(c => {
      if (c.classList.contains('disabled')) return;
      c.onclick = async () => {
        mode = c.dataset.mode;
        await db().from('rooms').update({ mode }).eq('id', roomId);
        render();
      };
    });
    $$('input[type=range]', wrap).forEach(inp => {
      inp.oninput = () => { const out = $(`[data-out="${inp.dataset.key}"]`, wrap); if (out) out.textContent = inp.value; };
      inp.onchange = () => save(inp.dataset.key, parseInt(inp.value, 10));
    });
    $$('input[type=checkbox]', wrap).forEach(inp => { inp.onchange = () => save(inp.dataset.key, inp.checked); });
    $$('select', wrap).forEach(sel => { sel.onchange = () => save(sel.dataset.key, parseInt(sel.value, 10)); });
  }

  const save = debounce(async (key, value) => {
    const patch = {}; patch[key] = value;
    await db().from('settings').update(patch).eq('room_id', roomId);
  }, 250);

  function get() { return current; }
  function getMode() { return mode; }

  return { init, get, getMode };
})();
