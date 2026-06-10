function createCanvasEngine(mount, opts) {
  opts = opts || {};
  const size = opts.size || 720;
  const minBrush = opts.minBrush || 2;
  const maxBrush = opts.maxBrush || 60;

  // Allow passing an existing canvas element via opts.canvas
  let canvas;
  if (opts.canvas) {
    canvas = opts.canvas;
    canvas.width = size;
    canvas.height = size;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    if (mount) {
      mount.innerHTML = '';
      mount.appendChild(canvas);
    }
  }
  const ctx = canvas.getContext('2d');

  function fitDisplay() {
    const parent = canvas.parentElement || (mount && mount.parentElement);
    const available = parent ? parent.clientWidth : size;
    const max = Math.min(available || size, size);
    canvas.style.width = max + 'px';
    canvas.style.height = max + 'px';
  }
  fitDisplay();
  window.addEventListener('resize', fitDisplay);

  let strokes = [];
  let redoStack = [];
  let current = null;
  let drawing = false;

  let tool = 'brush';
  let color = '#000000';
  let brushSize = 8;

  let zoom = 1, panX = 0, panY = 0;
  let spaceDown = false, panning = false, panStart = null;

  const state = {
    onStroke: opts.onStroke || function () {},
    onChange: opts.onChange || function () {}
  };

  function clearCtx() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }

  function applyTransform() {
    ctx.setTransform(zoom, 0, 0, zoom, panX, panY);
  }

  function drawStroke(s) {
    if (s.tool === 'fill') {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      floodFill(s.x, s.y, s.color);
      ctx.restore();
      return;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
    ctx.lineWidth = s.size;
    ctx.beginPath();
    const pts = s.points;
    if (pts.length === 1) {
      ctx.arc(pts[0][0], pts[0][1], s.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
      ctx.fill();
      return;
    }
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    ctx.stroke();
  }

  function render() {
    clearCtx();
    applyTransform();
    strokes.forEach(drawStroke);
    if (current) drawStroke(current);
    state.onChange();
  }

  function floodFill(sx, sy, hex) {
    const img = ctx.getImageData(0, 0, size, size);
    const data = img.data;
    const px = Math.floor(sx), py = Math.floor(sy);
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const idx = (py * size + px) * 4;
    const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2], ta = data[idx + 3];
    const fc = hexToRgb(hex);
    if (tr === fc.r && tg === fc.g && tb === fc.b) return;
    const stack = [[px, py]];
    const match = (i) => Math.abs(data[i] - tr) < 16 && Math.abs(data[i + 1] - tg) < 16 && Math.abs(data[i + 2] - tb) < 16 && Math.abs(data[i + 3] - ta) < 16;
    while (stack.length) {
      const [x, y] = stack.pop();
      let i = (y * size + x) * 4;
      let ny = y;
      while (ny >= 0 && match((ny * size + x) * 4)) ny--;
      ny++;
      let spanL = false, spanR = false;
      while (ny < size && match((ny * size + x) * 4)) {
        i = (ny * size + x) * 4;
        data[i] = fc.r; data[i + 1] = fc.g; data[i + 2] = fc.b; data[i + 3] = 255;
        if (x > 0) {
          const li = (ny * size + x - 1) * 4;
          if (match(li)) { if (!spanL) { stack.push([x - 1, ny]); spanL = true; } } else spanL = false;
        }
        if (x < size - 1) {
          const ri = (ny * size + x + 1) * 4;
          if (match(ri)) { if (!spanR) { stack.push([x + 1, ny]); spanR = true; } } else spanR = false;
        }
        ny++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }

  function toLocal(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
  }

  function pointerDown(e) {
    if (e.button === 1 || spaceDown) {
      panning = true;
      panStart = { x: e.clientX, y: e.clientY, panX, panY };
      return;
    }
    const p = toLocal(e);
    drawing = true;
    redoStack = [];
    if (tool === 'fill') {
      const s = { tool: 'fill', color, x: Math.floor(p.x), y: Math.floor(p.y) };
      strokes.push(s);
      render();
      state.onStroke(s);
      drawing = false;
      return;
    }
    current = { tool, color, size: brushSize, points: [[round(p.x), round(p.y)]] };
    render();
  }

  function pointerMove(e) {
    if (panning && panStart) {
      panX = panStart.panX + (e.clientX - panStart.x);
      panY = panStart.panY + (e.clientY - panStart.y);
      render();
      return;
    }
    if (!drawing || !current) return;
    const p = toLocal(e);
    const last = current.points[current.points.length - 1];
    if (Math.abs(p.x - last[0]) < 1 && Math.abs(p.y - last[1]) < 1) return;
    current.points.push([round(p.x), round(p.y)]);
    render();
  }

  function pointerUp() {
    if (panning) { panning = false; panStart = null; return; }
    if (!drawing || !current) return;
    drawing = false;
    strokes.push(current);
    state.onStroke(current);
    current = null;
    render();
  }

  function round(n) { return Math.round(n * 10) / 10; }

  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointerDown(e); });
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('pointerleave', e => { if (drawing) pointerUp(e); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clamp(zoom * factor, 1, 6);
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (size / rect.width);
    const my = (e.clientY - rect.top) * (size / rect.height);
    panX = mx - (mx - panX) * (newZoom / zoom);
    panY = my - (my - panY) * (newZoom / zoom);
    zoom = newZoom;
    if (zoom === 1) { panX = 0; panY = 0; }
    render();
  }, { passive: false });

  window.addEventListener('keydown', e => { if (e.code === 'Space') spaceDown = true; });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });

  function undo() {
    if (!strokes.length) return;
    redoStack.push(strokes.pop());
    render();
  }
  function redo() {
    if (!redoStack.length) return;
    strokes.push(redoStack.pop());
    render();
  }
  function clear() {
    strokes = [];
    redoStack = [];
    current = null;
    render();
  }

  function setTool(t) { tool = t; }
  function setColor(c) { color = c; }
  function setBrush(n) { brushSize = clamp(n, minBrush, maxBrush); }
  function getTool() { return tool; }

  function serialize() { return { size, strokes }; }
  function loadData(data, animate) {
    strokes = (data && data.strokes) ? data.strokes.slice() : [];
    redoStack = [];
    current = null;
    if (!animate) { render(); return Promise.resolve(); }
    return playback(data.strokes || []);
  }

  async function playback(list) {
    strokes = [];
    render();
    for (const s of list) {
      strokes.push(s);
      render();
      await sleep(s.tool === 'fill' ? 120 : 60);
    }
  }

  function applyRemoteStroke(s) {
    strokes.push(s);
    render();
  }

  function toDataURL() {
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, size, size);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  render();

  return {
    canvas, undo, redo, clear, setTool, setColor, setBrush, getTool,
    serialize, loadData, applyRemoteStroke, toDataURL,
    resetView() { zoom = 1; panX = 0; panY = 0; render(); }
  };
}
