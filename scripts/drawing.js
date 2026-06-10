const Drawing = (function () {
  let engine = null;
  let settings = {};
  const PALETTE = ['#000000','#ffffff','#7f7f7f','#ff4d4d','#ff9f43','#ffd93d','#46d98a','#2ee6c9','#4d8dff','#6c4dff','#ff77c2','#8b5a2b'];

  function mount(initialData, opts) {
    opts = opts || {};
    settings = opts.settings || {};
    const wrap = $('#canvas-wrap');
    engine = createCanvasEngine(wrap, {
      size: settings.canvas_size || 720,
      minBrush: settings.min_brush || 2,
      maxBrush: settings.max_brush || 60,
      onStroke: s => { if (opts.stream) Realtime.broadcast('stroke', { chainId: opts.chainId, stroke: s }); }
    });
    if (initialData) engine.loadData(initialData, false);
    buildToolbar();
    return engine;
  }

  function buildToolbar() {
    const tb = $('#toolbar');
    tb.innerHTML = '';

    const tools = [
      { id: 'brush', icon: '🖌️' },
      { id: 'eraser', icon: '🧽' },
      { id: 'fill', icon: '🪣' }
    ];
    tools.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tool-btn' + (t.id === 'brush' ? ' active' : '');
      b.textContent = t.icon;
      b.title = t.id;
      b.onclick = () => {
        engine.setTool(t.id);
        $$('.tool-btn', tb).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      };
      tb.appendChild(b);
    });

    sep(tb);

    const colors = settings.color_restrictions ? PALETTE.slice(0, 6) : PALETTE;
    const colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    colors.forEach((c, i) => {
      const s = document.createElement('button');
      s.className = 'swatch' + (i === 0 ? ' active' : '');
      s.style.background = c;
      s.onclick = () => {
        engine.setColor(c);
        if (engine.getTool() === 'eraser') { engine.setTool('brush'); $$('.tool-btn', tb)[0].click(); }
        $$('.swatch', tb).forEach(x => x.classList.remove('active'));
        s.classList.add('active');
      };
      colorRow.appendChild(s);
    });
    tb.appendChild(colorRow);

    if (!settings.color_restrictions) {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = '#000000';
      picker.className = 'swatch';
      picker.oninput = () => engine.setColor(picker.value);
      tb.appendChild(picker);
    }

    sep(tb);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'size-slider';
    slider.min = settings.min_brush || 2;
    slider.max = settings.max_brush || 60;
    slider.value = 8;
    slider.oninput = () => engine.setBrush(parseInt(slider.value, 10));
    tb.appendChild(slider);

    sep(tb);

    addBtn(tb, '↶', () => engine.undo());
    addBtn(tb, '↷', () => engine.redo());
    addBtn(tb, '🗑️', () => { if (confirm('Clear the whole canvas?')) engine.clear(); });
  }

  function addBtn(tb, icon, fn) {
    const b = document.createElement('button');
    b.className = 'tool-btn';
    b.textContent = icon;
    b.onclick = fn;
    tb.appendChild(b);
  }
  function sep(tb) {
    const s = document.createElement('div');
    s.className = 'tool-sep';
    tb.appendChild(s);
  }

  function getData() { return engine ? engine.serialize() : null; }
  function getEngine() { return engine; }

  return { mount, getData, getEngine };
})();
