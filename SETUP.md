# Doodle Relay — setup & deploy

A Gartic-Phone-style multiplayer drawing-telephone game. Vanilla HTML/CSS/JS frontend, Supabase backend (Realtime + Postgres + Auth), hostable on GitHub Pages.

## 1. Supabase setup

1. Create a project at https://supabase.com (free tier is fine).
2. In the dashboard go to **SQL Editor → New query**, paste the entire contents of `schema.sql`, and run it. This creates all tables, the room helper functions, Row Level Security policies, and adds every table to the `supabase_realtime` publication.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key
4. (Realtime) Under **Database → Replication / Realtime**, confirm the tables are enabled. The schema already runs `alter publication supabase_realtime add table ...` for each one, so this should be on.
5. (Auth, optional) Under **Authentication → Providers**, email is on by default. For quick testing turn **off** "Confirm email" so sign-ups work without a verification step.

### A note on the security model
For this phase the RLS policies are permissive (anyone with the anon key can read/write rooms they know about), and host-authority is enforced in the client plus the `security definer` SQL functions. This is normal for a casual party game and keeps guest play frictionless. Tightening RLS (per-room tokens, server-validated transitions) is a later hardening pass — flag it if you want that next.

## 2. Configure the app

Open `scripts/config.js` and paste your two values:

```js
window.GARTIC_CONFIG = {
  url: 'https://YOURPROJECT.supabase.co',
  anonKey: 'eyJ...your anon key...'
};
```

That's the only file you edit. Don't commit a service-role key — only the anon key belongs in the frontend.

## 3. Run locally

Because it uses ES features and fetches scripts, serve it over http rather than opening the file directly:

```bash
cd gartic
python3 -m http.server 8000
```

Open http://localhost:8000 in two browser tabs (or two devices) to test multiplayer. Use an incognito window for the second player so it gets its own client id.

## 4. Deploy to GitHub Pages

1. Create a repo and push the contents of this folder to the root (so `index.html` is at the top level).
   ```bash
   git init && git add . && git commit -m "doodle relay"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```
2. In the repo: **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, **Branch: main / root**, save.
3. Wait ~1 minute. Your game is live at `https://USERNAME.github.io/REPO/`.
4. Add that URL (and your Pages origin) to **Supabase → Authentication → URL Configuration → Site URL / Redirect URLs** if you use accounts.

Invite links use `#CODE` on the hash, so they work fine on Pages without any routing config.

## What's in this build (phase 1)

- Lobby: create/join, public + private rooms, room codes, invite links, live player list, ready status, kick, host transfer, room chat.
- Players: guest names, avatars, optional email accounts, reconnect/rejoin after refresh, disconnect handling.
- **Normal mode** end-to-end: prompt → draw → describe → ... → animated reveal with prev/next, step, auto-play, and fullscreen.
- Drawing canvas: brush, eraser, fill (flood), undo/redo, color palette + picker, brush-size slider, zoom (wheel), pan (space-drag / middle-mouse), clear, mouse + touch + stylus via Pointer Events. Strokes stored as compact vectors.
- Settings: timers, rounds, reveal speed, profanity filter, anonymous, late join, spectator, brush/color limits — host-editable and realtime-synced.
- Host-authoritative phase transitions with timeout fallback and auto-fill for players who run out of time or drop.

## Not in this phase yet
Animation, Knockoff, Secret, Score (voting), and Custom modes are scaffolded in the schema and settings UI but not wired to gameplay. Live stroke streaming (broadcast) is plumbed in the realtime layer but only matters for Knockoff. Say the word and I'll build these on top of this foundation one mode at a time.
