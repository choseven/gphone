function createCanvasEngine(mount, opts) {
  opts = opts || {};
  const SIZE = opts.size || 720;
  const MIN_BRUSH = opts.minBrush || 1;
  const MAX_BRUSH = opts.maxBrush || 60;

  // Use provided canvas or create one
  let canvas = opts.canvas || null;
  let ctx = null;

  if (canvas) {
    ctx = canvas.getContext('2d');
    canvas.width = SIZE;
    canvas.height = SIZE;
    fitDisplay();
  } else if (mount) {
    canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    mount.appendChild(canvas);
    ctx = canvas.getContext('2d');
    fitDisplay();
  }

  // State
  let tool = 'brush';
  let color = '#000000';
  let brushSize = 6;
  let drawing = false;
  let currentStroke = null;
  let strokes = [];
  let undoStack = [];
  let redoStack = [];

  // Init white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);

  function fitDisplay() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const maxW = parent.clientWidth || SIZE;
    const maxH = parent.clientHeight || SIZE;
    const scale = Math.min(1, maxW / SIZE, maxH / SIZE);
    canvas.style.width  = Math.floor(SIZE * scale) + 'px';
    canvas.style.height = Math.floor(SIZE * scale) + 'px';
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return [(src.clientX - rect.left) * scaleX, (src.clientY - rect.top) * scaleY];
  }

  function startStroke(e) {
    e.preventDefault();
    drawing = true;
    const pos = getPos(e);
    if (tool === 'fill') {
      doFill(pos[0], pos[1]);
      return;
    }
    currentStroke = { tool, color, size: brushSize, points: [pos] };
    render();
  }

  function moveStroke(e) {
    e.preventDefault();
    if (!drawing || !currentStroke) return;
    const pos = getPos(e);
    currentStroke.points.push(pos);
    render();
  }

  function endStroke(e) {
    if (!drawing) return;
    drawing = false;
    if (currentStroke) {
      strokes.push(currentStroke);
      undoStack.push('stroke');
      redoStack = [];
      currentStroke = null;
    }
  }

  function doFill(x, y) {
    const s = { tool: 'fill', color, x, y };
    _floodFill(ctx, x, y, color, SIZE);
    strokes.push(s);
    undoStack.push('fill');
    redoStack = [];
  }

  function render() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    strokes.forEach(function(s) { _renderStroke(ctx, s, SIZE); });
    if (currentStroke) _renderStroke(ctx, currentStroke, SIZE);
  }

  function undo() {
    if (!strokes.length) return;
    const s = strokes.pop();
    redoStack.push(s);
    render();
  }

  function redo() {
    if (!redoStack.length) return;
    const s = redoStack.pop();
    strokes.push(s);
    render();
  }

  function clear() {
    strokes = [];
    undoStack = [];
    redoStack = [];
    currentStroke = null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  function setTool(t) { tool = t; }
  function getTool() { return tool; }
  function setColor(c) { color = c; }
  function getColor() { return color; }
  function setBrush(n) { brushSize = Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, n)); }
  function getBrush() { return brushSize; }

  function serialize() {
    return { size: SIZE, strokes: JSON.parse(JSON.stringify(strokes)) };
  }

  function loadData(data, clearFirst) {
    if (clearFirst !== false) clear();
    strokes = (data && data.strokes) ? JSON.parse(JSON.stringify(data.strokes)) : [];
    render();
  }

  // Wire pointer events
  canvas.addEventListener('mousedown',  startStroke, { passive: false });
  canvas.addEventListener('mousemove',  moveStroke,  { passive: false });
  canvas.addEventListener('mouseup',    endStroke);
  canvas.addEventListener('mouseleave', endStroke);
  canvas.addEventListener('touchstart', startStroke, { passive: false });
  canvas.addEventListener('touchmove',  moveStroke,  { passive: false });
  canvas.addEventListener('touchend',   endStroke,   { passive: false });

  // Resize observer
  if (window.ResizeObserver && canvas.parentElement) {
    new ResizeObserver(fitDisplay).observe(canvas.parentElement);
  }

  return {
    setTool, getTool, setColor, getColor, setBrush, getBrush,
    undo, redo, clear, serialize, loadData, getCanvas: function() { return canvas; }
  };
}
