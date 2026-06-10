const Drawing = (function () {
  let engine = null;
  let settings = {};

  const PALETTE = [
    '#000000','#ffffff','#888888','#ff4d4d',
    '#ff9f43','#ffd93d','#46d98a','#2ee6c9',
    '#4d8dff','#6c4dff','#ff77c2','#8b5a2b'
  ];

  // Mount the engine onto the static #draw-canvas and wire up the static toolbar
  function mount(initialData, opts) {
    opts = opts || {};
    settings = opts.settings || {};

    const existingCanvas = document.getElementById('draw-canvas');
    engine = createCanvasEngine(null, {
      canvas: existingCanvas,
      size: settings.canvas_size || 720,
      minBrush: settings.min_brush || 2,
      maxBrush: settings.max_brush || 60
    });

    if (initialData) engine.loadData(initialData, false);

    buildStaticToolbar();
    updateBrushPreview();
    return engine;
  }

  function buildStaticToolbar() {
    // Tool buttons
    const toolBtns = {
      'tool-pen': 'brush',
      'tool-eraser': 'eraser',
      'tool-fill': 'fill'
    };
    Object.entries(toolBtns).forEach(([id, tool]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.onclick = () => {
        engine.setTool(tool);
        $$('.tool-btn', document.querySelector('.toolbar')).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });

    // Color swatches
    const swatchGrid = document.getElementById('color-swatches');
    if (swatchGrid) {
      swatchGrid.innerHTML = '';
      const palette = settings.color_restrictions ? PALETTE.slice(0, 6) : PALETTE;
      palette.forEach((color, i) => {
        const sw = document.createElement('div');
        sw.className = 'color-swatch' + (i === 0 ? ' active' : '');
        sw.style.background = color;
        sw.title = color;
        sw.onclick = () => {
          engine.setColor(color);
          if (engine.getTool() === 'eraser') {
            engine.setTool('brush');
            document.getElementById('tool-pen')?.classList.add('active');
            document.getElementById('tool-eraser')?.classList.remove('active');
          }
          $$('.color-swatch').forEach(s => s.classList.remove('active'));
          $$('.color-picker-full').forEach(p => p.style.outline = 'none');
          sw.classList.add('active');
        };
        swatchGrid.appendChild(sw);
      });
    }

    // Custom color picker
    const picker = document.getElementById('color-picker');
    if (picker) {
      picker.oninput = () => {
        engine.setColor(picker.value);
        $$('.color-swatch').forEach(s => s.classList.remove('active'));
        picker.style.outline = '2px solid white';
      };
    }

    // Brush size slider
    const slider = document.getElementById('brush-size');
    if (slider) {
      slider.min = settings.min_brush || 1;
      slider.max = settings.max_brush || 60;
      slider.value = 6;
      slider.oninput = () => {
        engine.setBrush(parseInt(slider.value, 10));
        updateBrushPreview();
      };
    }

    // Undo / Redo / Clear
    const undoBtn = document.getElementById('tool-undo');
    if (undoBtn) undoBtn.onclick = () => engine.undo();

    const redoBtn = document.getElementById('tool-redo');
    if (redoBtn) redoBtn.onclick = () => engine.redo();

    const clearBtn = document.getElementById('tool-clear');
    if (clearBtn) clearBtn.onclick = () => {
      if (confirm('Clear the whole canvas?')) engine.clear();
    };
  }

  function updateBrushPreview() {
    const preview = document.getElementById('brush-preview');
    if (!preview) return;
    const ctx = preview.getContext('2d');
    const size = parseInt(document.getElementById('brush-size')?.value || '6', 10);
    ctx.clearRect(0, 0, 40, 40);
    ctx.fillStyle = '#e8e8f0';
    ctx.beginPath();
    ctx.arc(20, 20, Math.min(size / 2, 18), 0, Math.PI * 2);
    ctx.fill();
  }

  function getData() { return engine ? engine.serialize() : null; }
  function getEngine() { return engine; }

  return { mount, getData, getEngine };
})();
