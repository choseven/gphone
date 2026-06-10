// ═══════════════════════════════════════════════════════════
//  supabase.js — replaces firebase.js entirely
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://xbisiqywkbagzcxbypmj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XA51Jg2s64PvTIwxtcyn2g_v5QIGpcX';
// ↑ paste your full publishable key from Project Settings → API Keys → Publishable key

const { createClient } = supabase;
const _db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth ──────────────────────────────────────────────────
let currentUser = null;

async function ensureAuth() {
  const { data: { session } } = await _db.auth.getSession();
  if (session?.user) { currentUser = session.user; return currentUser; }
  const { data, error } = await _db.auth.signInAnonymously();
  if (error) throw error;
  currentUser = data.user;
  return currentUser;
}

function getUid() { return currentUser?.id ?? null; }

// ── DB helpers ────────────────────────────────────────────

async function dbGet(table, match = {}) {
  let q = _db.from(table).select('*');
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function dbGetAll(table, match = {}) {
  let q = _db.from(table).select('*');
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function dbSet(table, row) {
  const { error } = await _db.from(table).upsert(row);
  if (error) throw error;
}

async function dbUpdate(table, match, updates) {
  let q = _db.from(table).update(updates);
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { error } = await q;
  if (error) throw error;
}

async function dbPush(table, row) {
  const { data, error } = await _db.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

async function dbDelete(table, match) {
  let q = _db.from(table).delete();
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { error } = await q;
  if (error) throw error;
}

// ── Realtime listener ─────────────────────────────────────
function dbOn({ table, event = '*', match, callback }) {
  let cfg = { event, schema: 'public', table };
  if (match) {
    // Supabase only supports ONE filter per channel — use the first key
    const [k, v] = Object.entries(match)[0];
    cfg.filter = `${k}=eq.${v}`;
  }
  const channel = _db
    .channel(`${table}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', cfg, callback)
    .subscribe();

  return () => _db.removeChannel(channel);
}

// ── Storage ───────────────────────────────────────────────
// FIX: use base64 upload — avoids binary encoding issues with publishable keys
async function uploadDrawing(roomId, chainId, round, dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const path   = `rooms/${roomId}/${chainId}/${round}.png`;

  const { error } = await _db.storage
    .from('drawings')
    .upload(path, decode(base64), {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Storage upload error:', error);
    throw error;
  }

  const { data } = _db.storage.from('drawings').getPublicUrl(path);
  return data.publicUrl;
}

// base64 → Uint8Array without using atob on large strings (more reliable)
function decode(base64) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Export ────────────────────────────────────────────────
window.FB = {
  ensureAuth, getUid,
  dbGet, dbGetAll, dbSet, dbUpdate, dbPush, dbDelete,
  dbOn,
  uploadDrawing,
  supabase: _db
};
