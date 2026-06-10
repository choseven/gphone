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

let toastTimer = null;
function showToast(msg, type = 'info', ms = 3000) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
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
  'A spy disguised as a houseplant'
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
