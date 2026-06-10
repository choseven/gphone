# Scribble Chain — Setup & Deployment Guide

A full Gartic Phone clone running on Firebase + GitHub Pages. No server required.

---

## Prerequisites

- A Google account (for Firebase)
- A GitHub account (for hosting)
- A modern browser (Chrome, Edge, Firefox, or Chromebook)

---

## Step 1 — Create a Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **Add project** → name it (e.g. `scribble-chain`)
3. Disable Google Analytics (optional)
4. Click **Create project**

---

## Step 2 — Enable Firebase Services

### Authentication
1. In the left sidebar, click **Authentication → Get started**
2. Click the **Sign-in method** tab
3. Enable **Anonymous** → Save

### Realtime Database
1. In the left sidebar, click **Realtime Database → Create database**
2. Choose a region close to your users
3. Start in **test mode** (we'll fix rules next)

### Storage
1. In the left sidebar, click **Storage → Get started**
2. Click through the wizard, start in test mode

---

## Step 3 — Set Security Rules

### Realtime Database Rules
1. Go to **Realtime Database → Rules**
2. Replace the default with the contents of **`firebase-rules.json`**
3. Click **Publish**

### Storage Rules
1. Go to **Storage → Rules**
2. Replace with:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /rooms/{roomId}/drawings/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.resource.size < 2 * 1024 * 1024
                   && request.resource.contentType == 'image/png';
    }
  }
}
```

---

## Step 4 — Get Your Firebase Config

1. Go to **Project Settings** (gear icon, top-left)
2. Scroll to **Your apps** → Click **Web** (`</>`)
3. Register the app (nickname: `scribble-chain-web`)
4. Copy the `firebaseConfig` object — it looks like:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "scribble-chain.firebaseapp.com",
  databaseURL: "https://scribble-chain-default-rtdb.firebaseio.com",
  projectId: "scribble-chain",
  storageBucket: "scribble-chain.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Step 5 — Configure the Game

Open **`js/firebase.js`** and replace the placeholder `firebaseConfig` with your values from Step 4:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",           // ← paste here
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

---

## Step 6 — Deploy to GitHub Pages

### Option A — GitHub Web UI (no tools needed, works on Chromebook)

1. Go to **github.com → New repository**
2. Name it `scribble-chain` (or anything you like)
3. Set to **Public**
4. Click **Create repository**
5. In the repository, click **Add file → Upload files**
6. Upload all files maintaining folder structure:
   - `index.html`
   - `css/style.css`
   - `js/firebase.js`
   - `js/app.js`
   - `js/lobby.js`
   - `js/game.js`
   - `js/drawing.js`
   - `js/reveal.js`
7. Click **Commit changes**
8. Go to **Settings → Pages**
9. Under **Source**, select `main` branch, `/ (root)` folder
10. Click **Save**
11. Your site will be live at: `https://YOUR_USERNAME.github.io/scribble-chain/`

### Option B — GitHub Desktop (easier bulk upload)

1. Install GitHub Desktop from desktop.github.com
2. Clone your new repository
3. Copy all game files into the cloned folder
4. Commit and push

---

## Step 7 — Play!

1. Open your GitHub Pages URL in two browser windows (or share with friends)
2. One player clicks **Create Room** → enters their name
3. Share the 5-letter room code
4. Other players click **Join Room** → enter code and name
5. Host clicks **Start Game** when everyone is in

---

## Database Schema Reference

```
rooms/
  {roomId}/
    hostId: string (UID)
    state: "LOBBY" | "PROMPT_WRITING" | "DRAWING" | "DESCRIPTION" | "REVEAL" | "GAME_OVER"
    round: number
    roundStartTime: timestamp
    playerOrder: [uid, uid, ...]
    revealChainIdx: number
    revealEntryIdx: number

    settings/
      promptTimer: number (seconds)
      drawTimer: number (seconds)
      descTimer: number (seconds)
      maxPlayers: number
      spectators: boolean
      profanity: boolean
      theme: string

    players/
      {uid}/
        name: string
        connected: boolean
        joinedAt: timestamp
        avatarIndex: number
        isSpectator: boolean
        score: number

    chains/
      {chainId}/
        owner: uid
        entries/
          {entryId}/
            type: "prompt" | "drawing" | "description"
            content: string (text or image URL)
            author: uid
            round: number
            t: timestamp

    submissions/
      prompt/         {uid: true, ...}
      drawing-{n}/    {uid: true, ...}
      description-{n}/ {uid: true, ...}

    chat/
      lobby/  {pushId: {uid, author, text, t}}
      reveal/ {pushId: {uid, author, text, t}}

    reactions/
      laugh/  {uid: true, ...}
      wow/    {uid: true, ...}
      heart/  {uid: true, ...}

    autosave/
      {uid}: base64 string (compressed, temp)
```

---

## Gameplay Flow

```
LOBBY
  ↓ host starts game
PROMPT_WRITING (all players write a prompt)
  ↓ all submitted or timer expires
DRAWING (each player draws another's prompt)
  ↓ all submitted or timer expires
DESCRIPTION (each player describes a drawing)
  ↓ all submitted or timer expires
[DRAWING → DESCRIPTION repeats n-2 more times]
  ↓ all rounds complete
REVEAL (host steps through each chain)
  ↓ host clicks Finish
GAME_OVER
```

---

## Troubleshooting

**"Room not found"** — Check that databaseURL in firebase.js matches your project exactly (include the full URL with `-default-rtdb`).

**Images not uploading** — Verify Storage rules allow writes and your storageBucket is set correctly.

**Auth errors** — Make sure Anonymous auth is enabled in the Firebase console.

**Game won't start** — Need at least 2 non-spectator connected players.

**Timer out of sync** — All timers are server-authoritative: clients use `roundStartTime` from Firebase, not local clocks.

---

## Extending the Game

- **More reactions**: Add emojis to `REACTION_EMOJIS` in `reveal.js` and corresponding buttons in `index.html`
- **Animation mode**: Add canvas playback by recording stroke deltas — store `{x, y, t}` arrays instead of a final PNG
- **Scoring**: Increment `players/{uid}/score` in `reveal.js` when reactions are given
- **Custom avatars**: Replace the letter-based avatar with user-uploaded images via Firebase Storage
