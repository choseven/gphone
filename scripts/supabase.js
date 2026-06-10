const SUPABASE_URL = window.GARTIC_CONFIG?.url || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = window.GARTIC_CONFIG?.anonKey || 'YOUR_SUPABASE_ANON_KEY';

let supabase = null;

function initSupabase() {
  if (supabase) return supabase;
  if (!window.supabase) {
    throw new Error('Supabase library not loaded');
  }
  if (SUPABASE_URL.startsWith('YOUR_') || SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    showToast('Set your Supabase URL and key in scripts/config.js', 'error', 6000);
  }
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 20 } },
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return supabase;
}

function db() {
  return supabase || initSupabase();
}

async function getAuthUser() {
  try {
    const { data } = await db().auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}

async function signInWithEmail(email, password) {
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function signUpWithEmail(email, password) {
  const { data, error } = await db().auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

async function signOut() {
  await db().auth.signOut();
}
