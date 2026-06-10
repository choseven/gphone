const Drawing = (function () {
  let engine = null;
  let settings = {};

  const PALETTE = [
    '#000000','#ffffff','#888888','#ff4d4d',
    '#ff9f43','#ffd93d','#46d98a','#2ee6c9',
    '#4d8dff','#6c4dff','#ff77c2','#8b5a2b'
  ];

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
    var toolBtns = { 'tool-pen': 'brush', 'tool-eraser': 'eraser', 'tool-fill': 'fill' };
    Object.entries(toolBtns).forEach(function(pair) {
      var id = pair[0], tool = pair[1];
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.onclick = function() {
        engine.setTool(tool);
        var toolbar = document.querySelector('.toolbar');
        if (toolbar) {
          toolbar.querySelectorAll('.tool-btn').forEach(function(b) { b.classList.remove('active'); });
        }
        btn.classList.add('active');
      };
    });

    var swatchGrid = document.getElementById('color-swatches');
    if (swatchGrid) {
      swatchGrid.innerHTML = '';
      var palette = settings.color_restrictions ? PALETTE.slice(0, 6) : PALETTE;
      palette.forEach(function(color, i) {
        var sw = document.createElement('div');
        sw.className = 'color-swatch' + (i === 0 ? ' active' : '');
        sw.style.background = color;
        sw.title = color;
        sw.onclick = function() {
          engine.setColor(color);
          if (engine.getTool() === 'eraser') {
            engine.setTool('brush');
            var pen = document.getElementById('tool-pen');
            var er = document.getElementById('tool-eraser');
            if (pen) pen.classList.add('active');
            if (er) er.classList.remove('active');
          }
          document.querySelectorAll('.color-swatch').forEach(function(s) { s.classList.remove('active'); });
          var picker = document.getElementById('color-picker');
          if (picker) picker.style.outline = 'none';
          sw.classList.add('active');
        };
        swatchGrid.appendChild(sw);
      });
    }

    var picker = document.getElementById('color-picker');
    if (picker) {
      picker.oninput = function() {
        engine.setColor(picker.value);
        document.querySelectorAll('.color-swatch').forEach(function(s) { s.classList.remove('active'); });
        picker.style.outline = '2px solid white';
      };
    }

    var slider = document.getElementById('brush-size');
    if (slider) {
      slider.min = settings.min_brush || 1;
      slider.max = settings.max_brush || 60;
      slider.value = 6;
      slider.oninput = function() {
        engine.setBrush(parseInt(slider.value, 10));
        updateBrushPreview();
      };
    }

    var undoBtn = document.getElementById('tool-undo');
    if (undoBtn) undoBtn.onclick = function() { engine.undo(); };

    var redoBtn = document.getElementById('tool-redo');
    if (redoBtn) redoBtn.onclick = function() { engine.redo(); };

    var clearBtn = document.getElementById('tool-clear');
    if (clearBtn) {
      clearBtn.onclick = function() {
        if (confirm('Clear the whole canvas?')) engine.clear();
      };
    }
  }

  function updateBrushPreview() {
    var preview = document.getElementById('brush-preview');
    if (!preview) return;
    var ctx = preview.getContext('2d');
    var size = parseInt(document.getElementById('brush-size') && document.getElementById('brush-size').value || '6', 10);
    ctx.clearRect(0, 0, 40, 40);
    ctx.fillStyle = '#e8e8f0';
    ctx.beginPath();
    ctx.arc(20, 20, Math.min(size / 2, 18), 0, Math.PI * 2);
    ctx.fill();
  }

  function getData() { return engine ? engine.serialize() : null; }
  function getEngine() { return engine; }

  return { mount: mount, getData: getData, getEngine: getEngine };
})();
