// ═══════════════════════════════════════════════════════════
//  firebase.js — Configuration & Firebase init
//  Replace the firebaseConfig object with your project values.
// ═══════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ── Init ─────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);

const auth    = firebase.auth();
const db      = firebase.database();
const storage = firebase.storage();

// ── Auth ─────────────────────────────────────────────────
let currentUser = null;

async function ensureAuth() {
  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged(user => {
      unsub();
      if (user) {
        currentUser = user;
        resolve(user);
      } else {
        auth.signInAnonymously()
          .then(cred => { currentUser = cred.user; resolve(cred.user); })
          .catch(reject);
      }
    });
  });
}

function getUid() {
  return currentUser ? currentUser.uid : null;
}

// ── DB helpers ───────────────────────────────────────────
function dbRef(path)    { return db.ref(path); }
function dbSet(path, v) { return db.ref(path).set(v); }
function dbUpdate(path, v) { return db.ref(path).update(v); }
function dbPush(path, v)   { return db.ref(path).push(v); }
function dbGet(path) {
  return db.ref(path).once('value').then(s => s.val());
}
function dbOnce(path) {
  return db.ref(path).once('value');
}
function dbOn(path, event, cb) {
  const ref = db.ref(path);
  ref.on(event, cb);
  return () => ref.off(event, cb);
}
function dbOff(path) { db.ref(path).off(); }

// Storage helper: upload a base64 PNG, return download URL
async function uploadDrawing(roomId, chainId, round, dataUrl) {
  const path = `rooms/${roomId}/drawings/${chainId}/${round}.png`;
  const ref  = storage.ref(path);
  await ref.putString(dataUrl, 'data_url');
  return ref.getDownloadURL();
}

window.FB = {
  ensureAuth, getUid,
  dbRef, dbSet, dbUpdate, dbPush, dbGet, dbOnce, dbOn, dbOff,
  uploadDrawing,
  db, storage, auth
};
