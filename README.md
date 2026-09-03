# RAGELAB

Browser multiplayer sandbox FPS. The client renders in Three.js, predicts movement locally, and talks to an authoritative Node.js game server over WebSockets. Persistent accounts, profiles, cosmetics and statistics live in the existing Supabase project.

This is a real vertical slice, not a mock: two players can join a room, move, shoot, take damage, die, respawn, throw props and hear spatial audio.

## Requirements

- Node.js 20.11 or newer
- A configured `.env` (copy from `.env.example`)
- The existing Supabase project already referenced by that file

## Install

```bash
npm install
```

## Environment

Copy `.env.example` to `.env` if you do not already have one. Use the **names that are already in the repo**. Do not invent new database credentials.

Public values (safe for the browser bundle):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `VITE_GAME_SERVER_URL` (default `ws://localhost:8080`)
- `VITE_GAME_SERVER_HTTP_URL` (default `http://localhost:8080`)

Server-only values (never sent to the client):

- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`
- `SUPABASE_JWT_SECRET`
- `POSTGRES_*` (used only by `npm run db:migrate`)

Game server:

- `GAME_SERVER_PORT` (default `8080`)
- `GAME_SERVER_ALLOW_GUESTS=true` for local play without an account
- `GAME_SERVER_PERSIST=true` to mirror rooms into Supabase for the server browser

Vite reads the monorepo `.env` and injects only the public Supabase URL/anon key plus the game-server URLs. Service-role keys are not referenced by the client config.

## Database

Supabase is already set up. Schema lives in `supabase/migrations/`. Apply migrations only when you need to:

```bash
npm run db:migrate
```

Do not edit production tables by hand. Add a new migration file if the schema must change.

## Run (development)

From the repo root, one command starts both processes:

```bash
npm run dev
```

- Game server: `ws://localhost:8080` and `http://localhost:8080/health`
- Client: `http://localhost:5173`

Or separately:

```bash
npm run dev:server
npm run dev:client
```

Open the client URL, click **Play**. Guest join works when `GAME_SERVER_ALLOW_GUESTS=true`.

### Local two-player test

1. Start `npm run dev`.
2. Open `http://localhost:5173` in two browser windows (or one window plus an incognito window).
3. Click **Play** in both. They should land in the same auto-matched room on Rage Yard.
4. Click the canvas to capture the mouse. WASD to move, mouse to look, left click to fire.

If the second window joins an empty extra room, join the listed room from **Servers** instead.

### LAN — other PCs on the same Wi‑Fi

Do **not** send friends `http://localhost:5173`. That address only works on your computer.

1. Start `npm run dev` on the host PC.
2. In the Vite log, copy the **Network** URL, e.g. `http://192.168.1.42:5173`.
3. Friends open that URL. The client proxies the game WebSocket through the same host, so they do not need port 8080.
4. If the page itself will not load, allow Node.js inbound on port **5173** in Windows Firewall (Private network).

## Controls (defaults)

| Action | Binding |
| --- | --- |
| Move | WASD |
| Look | Mouse |
| Jump | Space |
| Sprint | Shift |
| Crouch | C |
| Fire | Mouse 1 |
| Aim | Mouse 2 |
| Reload | R |
| Interact / pick up | E |
| Drop prop | G |
| Weapons | 1–5 / mouse wheel |
| Scoreboard | Tab |
| Chat | T |
| Pause | Escape (releases mouse) |
| Debug overlay | F3 |

While carrying a crate or barrel, left click throws it.

## Architecture

```
client/   Three.js renderer, prediction, interpolation, HUD, Supabase auth
server/   Authoritative simulation, combat, physics, rooms, anti-cheat
shared/   Protocol, weapons, maps, movement, constants
supabase/ SQL migrations and generated table types
```

High-frequency gameplay (position, shots, physics) never goes through Supabase Realtime. The Node server is the authority. The client sends **intent** (input + fire button). The server decides hits and damage.

## Production build

```bash
npm run build
npm start          # serves the compiled game server from server/dist
npm run preview    # optional: Vite preview of the client on :4173
```

Point `VITE_GAME_SERVER_URL` at the public WebSocket URL of the game server before building the client. Serve `client/dist` behind any static host. Keep service-role keys on the server only.

Health check for orchestrators: `GET /health`. Room list: `GET /rooms`.

### Vercel (client only)

Vite emits `client/dist`, not `public`. The repo root `vercel.json` sets:

- **Build Command:** `npm run build:client`
- **Output Directory:** `client/dist`
- **Root Directory:** repository root (leave empty / `.`)

If the dashboard still says `No Output Directory named "public"`, open **Project Settings → Build & Development** and set those three fields to the same values. Framework Preset should be **Other** (not Next.js).

Add these **public** env vars on Vercel (Settings → Environment Variables). Do not add service-role keys or JWT secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `VITE_GAME_SERVER_URL` (e.g. `wss://your-game-server.example.com`)
- `VITE_GAME_SERVER_HTTP_URL` (e.g. `https://your-game-server.example.com`)

The authoritative WebSocket game server is a long-lived Node process. It does **not** run on Vercel. Host it on a VPS, Fly.io, Railway, or similar, then point the two `VITE_GAME_SERVER_*` variables at that URL.

## Typecheck

```bash
npm run typecheck
```

## Troubleshooting

**Client stuck on “Connecting…”**  
The game server is not running, or `VITE_GAME_SERVER_URL` does not match `GAME_SERVER_PORT`. Check `http://localhost:8080/health`.

**“this server requires a signed-in account”**  
Set `GAME_SERVER_ALLOW_GUESTS=true`, or sign in. The handshake sends the Supabase access token; the server verifies it with `SUPABASE_JWT_SECRET` / the service role.

**“profile not found for this account”**  
The `handle_new_user` trigger in `0001_init.sql` should create a profile on signup. Confirm migrations were applied and the user was created through Supabase Auth (not a raw `auth.users` insert).

**No audio**  
The audio graph starts on the Play click (browser autoplay policy). If you joined without a gesture, click the canvas.

**Physics / Rapier fails to load**  
Keep `@dimforge/rapier3d-compat` out of Vite’s pre-bundle (already excluded). A hard refresh after `npm install` is enough.

**Two players cannot see each other**  
They are in different rooms. Use **Servers** and join the same room id. The process starts one warm room; Play auto-matches into the emptiest joinable room.

**Supabase errors in the browser**  
Only anon/publishable keys belong in the client. If URL/anon key are empty, guest play still works; accounts, profile and the mirrored server browser do not.
