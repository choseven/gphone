function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

function getClientId() {
  let id = localStorage.getItem('gartic_client_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'c-' + Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem('gartic_client_id', id);
  }
  return id;
}

function getStoredName() { return localStorage.getItem('gartic_name') || ''; }
function setStoredName(n) { localStorage.setItem('gartic_name', n); }
function getStoredAvatar() { return localStorage.getItem('gartic_avatar') || '0'; }
function setStoredAvatar(a) { localStorage.setItem('gartic_avatar', a); }

const AVATARS = ['🐱','🐶','🦊','🐸','🐵','🐼','🦄','🐙','🐧','🦖','👽','🤖','🦋','🌮','👻','🍄'];

function avatarFor(idx) {
  const i = parseInt(idx, 10);
  return AVATARS[isNaN(i) ? 0 : i % AVATARS.length];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0, pending = null;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, ms - (now - last));
    }
  };
}

function showToast(msg, type = 'info', ms = 3000) {
  const host = document.getElementById('toast-container');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'success' ? ' success' : type === 'error' ? ' error' : type === 'warn' ? ' warn' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms + 400);
}

function floatEmoji(emoji) {
  const host = document.getElementById('float-reactions');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = (15 + Math.random() * 70) + '%';
  host.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function fmtTime(secs) {
  if (secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
}

const PROFANITY = ['fuck','shit','bitch','asshole','cunt','dick','bastard'];
function cleanText(str, filter) {
  if (!filter) return str;
  let out = str;
  PROFANITY.forEach(w => {
    out = out.replace(new RegExp(w, 'gi'), m => m[0] + '*'.repeat(Math.max(0, m.length - 1)));
  });
  return out;
}

const DEFAULT_PROMPTS = [
  'A cat running a coffee shop',
  'The last slice of pizza on earth',
  'A robot learning to dance',
  'A haunted vending machine',
  'Two ghosts arguing over a remote',
  'A dragon afraid of fire',
  'An octopus playing every instrument',
  'A banana riding a skateboard',
  'A wizard who lost his hat',
  'A spy disguised as a houseplant',
  'A penguin at the beach',
  'A dog trying to use a computer',
  'A snail winning a race',
  'A cloud having a bad day',
  'Pizza delivery to the moon'
];

function randomPrompt() {
  return DEFAULT_PROMPTS[Math.floor(Math.random() * DEFAULT_PROMPTS.length)];
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

function inviteLink(code) {
  const base = location.origin + location.pathname;
  return `${base}#${code}`;
}

function hashCode() {
  const h = location.hash.replace('#', '').trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(h) ? h : '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Render drawing stroke data to a canvas and return a PNG data URL
function drawingToDataURL(drawingData) {
  if (!drawingData) return '';
  const size = drawingData.size || 720;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  (drawingData.strokes || []).forEach(s => _renderStroke(ctx, s, size));
  return c.toDataURL('image/png');
}

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
}

function _floodFill(ctx, sx, sy, hex, size) {
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  const px = Math.floor(sx), py = Math.floor(sy);
  if (px < 0 || py < 0 || px >= size || py >= size) return;
  const idx = (py * size + px) * 4;
  const tr = data[idx], tg = data[idx+1], tb = data[idx+2], ta = data[idx+3];
  const fc = _hexToRgb(hex);
  if (tr === fc.r && tg === fc.g && tb === fc.b) return;
  const stack = [[px, py]];
  const match = i => Math.abs(data[i]-tr)<16 && Math.abs(data[i+1]-tg)<16 && Math.abs(data[i+2]-tb)<16 && Math.abs(data[i+3]-ta)<16;
  while (stack.length) {
    const [x, y] = stack.pop();
    let ny = y;
    while (ny >= 0 && match((ny*size+x)*4)) ny--;
    ny++;
    let spanL = false, spanR = false;
    while (ny < size && match((ny*size+x)*4)) {
      const i = (ny*size+x)*4;
      data[i]=fc.r; data[i+1]=fc.g; data[i+2]=fc.b; data[i+3]=255;
      if (x > 0) { const li=(ny*size+x-1)*4; if (match(li)){if(!spanL){stack.push([x-1,ny]);spanL=true;}}else spanL=false; }
      if (x < size-1) { const ri=(ny*size+x+1)*4; if (match(ri)){if(!spanR){stack.push([x+1,ny]);spanR=true;}}else spanR=false; }
      ny++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function _renderStroke(ctx, s, size) {
  if (s.tool === 'fill') {
    _floodFill(ctx, s.x, s.y, s.color, size);
    return;
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
  ctx.lineWidth = s.size;
  const pts = s.points;
  if (!pts || pts.length === 0) return;
  ctx.beginPath();
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
