// ═══════════════════════════════════════════════════════════
//  drawing.js — Canvas engine: pen, eraser, fill, undo/redo
// ═══════════════════════════════════════════════════════════

const Drawing = (() => {
  const PALETTE = [
    '#ffffff','#000000','#808080','#c0c0c0',
    '#ff0000','#ff6600','#ffcc00','#00cc00',
    '#0066ff','#9900ff','#ff00cc','#00cccc',
    '#8B4513','#228B22','#000080','#FF69B4',
    '#FFA500','#7CFC00','#00FFFF','#FF1493',
  ];

  let canvas, ctx, previewCanvas, previewCtx;
  let isDrawing = false;
  let tool = 'pen';
  let color = '#000000';
  let brushSize = 6;
  let history = [];   // array of ImageData snapshots
  let redoStack = [];
  let lastX = 0, lastY = 0;
  let autosaveTimer = null;

  function init() {
    canvas        = document.getElementById('draw-canvas');
    ctx           = canvas.getContext('2d');
    previewCanvas = document.getElementById('brush-preview');
    previewCtx    = previewCanvas.getContext('2d');

    buildSwatches();
    bindToolButtons();
    bindCanvasEvents();
    bindBrushSlider();
    updateBrushPreview();
    clearCanvas(true); // white background
    saveHistory();
  }

  // ── Palette ──────────────────────────────────────────────
  function buildSwatches() {
    const grid = document.getElementById('color-swatches');
    grid.innerHTML = '';
    PALETTE.forEach(hex => {
      const s = document.createElement('button');
      s.className = 'color-swatch';
      s.style.background = hex;
      s.style.border = hex === '#ffffff' ? '2px solid #555' : '';
      s.title = hex;
      s.addEventListener('click', () => setColor(hex, s));
      if (hex === color) s.classList.add('active');
      grid.appendChild(s);
    });

    document.getElementById('color-picker').addEventListener('input', e => {
      setColor(e.target.value, null);
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    });
  }

  function setColor(hex, swatchEl) {
    color = hex;
    if (swatchEl) {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatchEl.classList.add('active');
    }
    document.getElementById('color-picker').value = hex;
    if (tool === 'eraser') setTool('pen');
    updateBrushPreview();
  }

  // ── Tools ─────────────────────────────────────────────────
  function bindToolButtons() {
    document.getElementById('tool-pen').addEventListener('click', () => setTool('pen'));
    document.getElementById('tool-eraser').addEventListener('click', () => setTool('eraser'));
    document.getElementById('tool-fill').addEventListener('click', () => setTool('fill'));
    document.getElementById('tool-undo').addEventListener('click', undo);
    document.getElementById('tool-redo').addEventListener('click', redo);
    document.getElementById('tool-clear').addEventListener('click', () => {
      saveHistory();
      clearCanvas(false);
    });
  }

  function setTool(t) {
    tool = t;
    ['pen','eraser','fill'].forEach(id => {
      const el = document.getElementById(`tool-${id}`);
      if (el) el.classList.toggle('active', id === t);
    });
    canvas.style.cursor = t === 'fill' ? 'cell' : 'crosshair';
    updateBrushPreview();
  }

  // ── Brush slider ─────────────────────────────────────────
  function bindBrushSlider() {
    const slider = document.getElementById('brush-size');
    slider.addEventListener('input', () => {
      brushSize = parseInt(slider.value, 10);
      updateBrushPreview();
    });
  }

  function updateBrushPreview() {
    previewCtx.clearRect(0, 0, 40, 40);
    previewCtx.beginPath();
    previewCtx.arc(20, 20, Math.min(brushSize / 2, 18), 0, Math.PI * 2);
    previewCtx.fillStyle = tool === 'eraser' ? '#888' : color;
    previewCtx.fill();
  }

  // ── Canvas events ─────────────────────────────────────────
  function bindCanvasEvents() {
    // Mouse
    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('mouseleave', onEnd);

    // Touch
    canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0]); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0]); },  { passive: false });
    canvas.addEventListener('touchend',   e => { e.preventDefault(); onEnd(); },               { passive: false });
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY
    };
  }

  function onStart(e) {
    if (!Drawing.enabled) return;
    const pos = getPos(e);
    if (tool === 'fill') {
      saveHistory();
      floodFill(Math.round(pos.x), Math.round(pos.y), color);
      scheduleAutosave();
      return;
    }
    isDrawing = true;
    saveHistory();
    lastX = pos.x;
    lastY = pos.y;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    applyStyle();
    ctx.fill();
  }

  function onMove(e) {
    if (!isDrawing || !Drawing.enabled) return;
    const pos = getPos(e);

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    applyStyle();
    ctx.lineWidth   = brushSize;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
    scheduleAutosave();
  }

  function onEnd() {
    if (!isDrawing) return;
    isDrawing = false;
    redoStack = [];
  }

  function applyStyle() {
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle   = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.fillStyle   = color;
    }
  }

  // ── Flood fill ────────────────────────────────────────────
  function hexToRgba(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r, g, b, 255];
  }

  function colorsMatch(a, b, tol = 30) {
    return Math.abs(a[0]-b[0]) <= tol &&
           Math.abs(a[1]-b[1]) <= tol &&
           Math.abs(a[2]-b[2]) <= tol &&
           Math.abs(a[3]-b[3]) <= tol;
  }

  function floodFill(sx, sy, fillHex) {
    const imgData  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data     = imgData.data;
    const W        = canvas.width;
    const H        = canvas.height;
    const fillRgba = hexToRgba(fillHex);

    const idx = (x, y) => (y * W + x) * 4;
    const getColor = (x, y) => {
      const i = idx(x, y);
      return [data[i], data[i+1], data[i+2], data[i+3]];
    };

    const target = getColor(sx, sy);
    if (colorsMatch(target, fillRgba, 5)) return; // already that color

    const stack = [[sx, sy]];
    const visited = new Uint8Array(W * H);

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      if (visited[y * W + x]) continue;
      if (!colorsMatch(getColor(x, y), target)) continue;

      visited[y * W + x] = 1;
      const i = idx(x, y);
      data[i]   = fillRgba[0];
      data[i+1] = fillRgba[1];
      data[i+2] = fillRgba[2];
      data[i+3] = fillRgba[3];

      stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ── History ───────────────────────────────────────────────
  function saveHistory() {
    if (history.length > 40) history.shift();
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  function undo() {
    if (history.length <= 1) return;
    redoStack.push(history.pop());
    ctx.putImageData(history[history.length - 1], 0, 0);
    scheduleAutosave();
  }

  function redo() {
    if (!redoStack.length) return;
    const state = redoStack.pop();
    history.push(state);
    ctx.putImageData(state, 0, 0);
    scheduleAutosave();
  }

  // ── Clear ─────────────────────────────────────────────────
  function clearCanvas(init = false) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!init) { redoStack = []; scheduleAutosave(); }
  }

  // ── Export ────────────────────────────────────────────────
  function getDataUrl() {
    // Compress: draw to a smaller temp canvas
    const tmp  = document.createElement('canvas');
    tmp.width  = 512;
    tmp.height = 320;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(canvas, 0, 0, 512, 320);
    return tmp.toDataURL('image/png', 0.85);
  }

  // ── Autosave ──────────────────────────────────────────────
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (Drawing.onAutosave) Drawing.onAutosave(getDataUrl());
    }, 4000);
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    reset() {
      history    = [];
      redoStack  = [];
      clearCanvas(true);
      saveHistory();
      setTool('pen');
    },
    enable()  { Drawing.enabled = true;  canvas.style.pointerEvents = 'auto'; },
    disable() { Drawing.enabled = false; canvas.style.pointerEvents = 'none'; },
    enabled: true,
    getDataUrl,
    onAutosave: null,
    // keyboard shortcuts
    bindKeyboard() {
      document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
        if (e.key === 'e') setTool('eraser');
        if (e.key === 'b') setTool('pen');
        if (e.key === 'f') setTool('fill');
      });
    }
  };
})();

window.Drawing = Drawing;
