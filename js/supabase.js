// ═══════════════════════════════════════════════════════════
//  supabase.js — replaces firebase.js entirely
//  Drop this in js/ and delete js/firebase.js
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

// Read single row. match = { col: val, ... }
async function dbGet(table, match = {}) {
  let q = _db.from(table).select('*');
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

// Read multiple rows
async function dbGetAll(table, match = {}) {
  let q = _db.from(table).select('*');
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Insert or replace (upsert)
async function dbSet(table, row) {
  const { error } = await _db.from(table).upsert(row);
  if (error) throw error;
}

// Update matching rows
async function dbUpdate(table, match, updates) {
  let q = _db.from(table).update(updates);
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { error } = await q;
  if (error) throw error;
}

// Insert new row, return it
async function dbPush(table, row) {
  const { data, error } = await _db.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

// Delete matching rows
async function dbDelete(table, match) {
  let q = _db.from(table).delete();
  Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
  const { error } = await q;
  if (error) throw error;
}

// ── Realtime listener ─────────────────────────────────────
// Returns an unsubscribe function.
// Usage: FB.dbOn({ table, event, match, callback })
// event = 'INSERT' | 'UPDATE' | 'DELETE' | '*'
// match = { col: val } (optional, filters to one row)
function dbOn({ table, event = '*', match, callback }) {
  let cfg = { event, schema: 'public', table };
  if (match) {
    cfg.filter = Object.entries(match)
      .map(([k, v]) => `${k}=eq.${v}`)
      .join(',');
  }
  const channel = _db
    .channel(`${table}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', cfg, callback)
    .subscribe();

  return () => _db.removeChannel(channel);
}

// ── Storage ───────────────────────────────────────────────
// Bucket name: 'drawings' (create in Supabase → Storage → New bucket, set Public)
async function uploadDrawing(roomId, chainId, round, dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const path   = `rooms/${roomId}/drawings/${chainId}/${round}.png`;

  const { error } = await _db.storage
    .from('drawings')
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) throw error;

  const { data } = _db.storage.from('drawings').getPublicUrl(path);
  return data.publicUrl;
}

// ── Export ────────────────────────────────────────────────
window.FB = {
  ensureAuth, getUid,
  dbGet, dbGetAll, dbSet, dbUpdate, dbPush, dbDelete,
  dbOn,
  uploadDrawing,
  supabase: _db
};
