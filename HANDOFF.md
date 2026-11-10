# HANDOFF — read this first (context for Claude in VS Code)

This file carries over the decisions from an earlier planning session. Read it fully before changing code.

## The project
- Computer Networks course, Project #2 "Multiplayer Game Arena" (team of 4). **Demo: Friday 13 Nov 2026.**
- Brief requirements: competitive game, 1 server + 3 clients on 4 separate computers, **real network sockets**,
  **two versions of the same game: TCP only and UDP only** (identical rules/features, only the transport changes).
  The UDP version must work with **no TCP at all**, with our own reliability and disconnection detection.
- Mandatory features in both versions: registration/login, lobby + room creation, join/leave room, game start/end
  and session status, real-time actions, **scores + ranking + winner**, detect/handle unexpected disconnections.
- Bonus: cross-network play (plan: Tailscale overlay VPN on all 4 laptops, server bound to 0.0.0.0).
- **Grading is on our understanding of networking and sockets.** Keep the network code simple, readable,
  commented, and built only on Node's `net` and `dgram`. No networking libraries.

## Decisions already made
1. **One repo, both versions.** Same game code; only the transport files differ. Launched with `--proto tcp|udp`.
2. **Remove Socket.IO, Express, CORS, dotenv, every `fetch`, the Vite proxy, `frontend/log.js`.** All of it runs over
   HTTP/WebSocket (TCP), which breaks "UDP only" and hides the networking.
3. **Client = Electron app.** A browser page cannot open raw TCP/UDP sockets. Electron's main process owns the real
   `net.Socket` (TCP) or `dgram` socket (UDP); the React + Phaser UI (unchanged) talks to it through Electron IPC
   (`contextBridge` → `window.gameNet`), which is not a network socket. Electron is already in `frontend/devDependencies`
   (`electron@33`).
   - Load the built UI from disk (`frontend/dist`). The code uses absolute paths like `/assets/...` (CSS and JSX), so
     register a privileged custom scheme (`app://`) with `protocol.handle` serving `dist/` instead of `loadFile`.
   - Each Electron instance: `app.setPath('userData', <temp>/among-us-client-<pid>)` so 3 clients can run on one PC.
   - Args: `--proto tcp|udp --server <ip> --port <n> [--loss 0.1] [--dev]`; last occurrence wins. Show proto + server
     in the window title (prevent `page-title-updated`).
   - Main process sends `net:message`, `net:status`, `net:stats` (every 1 s) to the renderer; renderer sends `net:send`;
     `net:info` (invoke) returns current status on renderer (re)load. Also append stats to a CSV
     (`netstats-<proto>-<pid>.csv`) for the comparison slides.
4. **Wire format = plain JSON** (readable in Wireshark).
   - TCP: one JSON object per line: `{"type":"room:join","data":{...}}\n` (newline framing, `shared/lineFramer.cjs`).
     `setNoDelay(true)`. Heartbeat: client sends `{"type":"PING","data":{"ts":…}}` every 1 s, server replies `PONG`;
     5 s of silence = disconnected. Server sends `{"type":"welcome","data":{"sessionId"}}` on connect.
   - UDP: one JSON object per datagram, field `t`: `HELLO`→`WELCOME {sessionId}` handshake (client resends HELLO
     every 1 s until WELCOME), `PING {ts}`/`PONG`, `BYE`, and `MSG/ACK/FAST` handled by `shared/reliableUdp.cjs`.
     Reliable = seq + ACK + retransmit (RTO = 2×SRTT, 100–1000 ms) + dedupe + in-order delivery. Unreliable (`FAST`)
     only for `player:move` / `player:moved`; stale ones dropped per player. Server replies `BYE` to unknown addresses;
     client then restarts with HELLO and a fresh channel. Optional `--loss` drops random datagrams (demo/testing).
5. **Ports:** TCP 5000, UDP 5001 (`shared/protocol.cjs`).
6. **Server is authoritative**; client sends requests, server validates and broadcasts.

## Already written (in this zip)
- `shared/protocol.cjs` — constants (ports, heartbeat 1 s, timeout 5 s, RTO, MAX_RETRIES, UNRELIABLE_TYPES).
- `shared/lineFramer.cjs` — TCP framing (StringDecoder for split UTF-8, 64 KB guard).
- `shared/reliableUdp.cjs` — `ReliableChannel` (sendReliable, sendUnreliable, handlePacket, tick(), snapshot()).
- `backend/src/transport/tcpServer.js` and `udpServer.js` — same interface:
  `on('connect'|'message'|'disconnect')`, `send(sessionId, type, data)`, `sessionStats()`.
  ESM files importing the shared `.cjs` files with named imports.
- `backend/src/managers/rooms.manager.js` — rewritten: no fake room "1", one meeting timer per room, `scores`,
  imposter rotation (`imposterHistory`), `resetRoom()` after each game (scores kept), `checkWin()` where with 3
  players the imposter must kill both crewmates (parity rule only with 4+), and `publicRoom(room)` which never
  includes the imposter. `players.manager.js` is unchanged.

## Still to do (in this order)
### 1. Backend
- `backend/src/main.js`: parse `--proto tcp|udp --port --loss`, start the transport, keep the maps
  `sessionId ↔ playerId`, helpers `sendTo`, `sendToPlayer`, `sendToRoom(roomId, type, data, exceptPlayerId)`,
  `sendToEveryone`. Log stats every 10 s.
- Rewrite `events/roomEvents.js` + `events/gameEvents.js` as handler maps `(ctx, sessionId, data)`.
  **Take the player's identity from the session, never from the payload.**
  - `player:register {id,name,color}` → bind session; refuse an id bound to another live session; reply
    `player:registered`; send `rooms:list`.
  - `player:unregister`, `rooms:get` → `rooms:list {rooms: publicRoom[]}` (push to everyone on every room change).
  - `room:create {roomId}`, `room:join {roomId}` (room exists, not started, name not taken; if color taken, assign a
    free one), reply `room:joined {roomId, room: publicRoom, player}` + `player:joined` to the others;
    errors → `room:join:error {message}`.
  - `room:leave`, and on transport `disconnect`: remove from room, `player:left {playerId, reason}`, `room:host
    {hostId}` if host changed, win check, broadcast rooms.
  - `room:get` → `room:state {room, player}` (replaces `GET /player/room/:id`).
  - `game:start`: host only, ≥2 players (3 for the real demo), then send **privately to each player**
    `game:started {roomId, isImposter}` (replaces `GET /isImposter`).
  - `player:move {x,y,d,moving}`: finite numbers only; update state; relay `player:moved {id,…}` to the others
    (not back to the sender).
  - `player:kill {playerId}`: killer = room imposter, both alive, no meeting active, distance ≤ 100 px using the
    server's positions, cooldown 10 s. Broadcast `player:killed {playerId, killerId, x, y, color: VICTIM's color}`.
    Kill = +1 point.
  - `meeting:start`: alive, game started, no active meeting, once per player per game. Broadcast
    `meeting:started {callerId, durationMs: 30000, players: alive public players}`.
  - `meeting:vote {votedForId | 'skip'}`: alive voter, votes once, target alive. Broadcast
    `meeting:voted {callerId}` (do not reveal the choice). End early when everyone voted, else on the timer.
    `meeting:end` from clients is ignored. Correct vote (for the imposter) = +1 point.
    Broadcast `meeting:ended {results}`.
  - Game end: imposter win +3 to the imposter, crew win +2 to every crewmate. Broadcast
    `game:ended {roomId, isImposter, imposterId, imposterName, ranking:[{id,name,color,points}]}` then `resetRoom`.
  - Validation failures → `game:notif {message}` to that player only.
- Delete `server.js`, `routes/api.js`. `backend/package.json`: drop express/cors/dotenv/socket.io; scripts
  `"tcp": "node src/main.js --proto tcp --port 5000"`, `"udp": "node src/main.js --proto udp --port 5001"`.

### 2. Client
- `frontend/electron/main.cjs`, `preload.cjs`, `tcpClient.cjs` (reconnect every 2 s, PING every 1 s, 5 s timeout),
  `udpClient.cjs` (HELLO loop, ReliableChannel, PING, BYE on quit, `tick()` every 50 ms). Both require
  `../../shared/*.cjs`.
- `frontend/src/services/net.js` replaces `services/socket.js` + `utils/urls.js`: `on/off/once/emit`, `connected`,
  `id`, `request(type, data, replyType)`; listens to `window.gameNet`; dispatches `connect`/`disconnect`/`stats`.
- Update call sites (`App.jsx`, `pages/Menu.jsx`, `scenes/Lobby.js`, `scenes/BaseGameScene.js`, `scenes/Game.js`,
  `utils/imposter.js`, `components/MeetingTile.jsx`, `components/Meeting.jsx`, `components/EndGame.jsx`):
  - remove every `fetch`; Menu listens to `rooms:list`; join = just `emit('room:join', {roomId})`.
  - `fetchAndSetupPlayers` → `await net.request('room:get', {}, 'room:state')`.
  - Lobby: `data.isImposter = Promise.resolve(data.isImposter)`; App: `Promise.resolve(data.isImposter).then(...)`.
  - Movement: send at 20 Hz while moving, every 500 ms when idle, immediately on start/stop (no more per-frame
    sends). Smooth remote players toward their last received position (lerp, snap if > 200 px); when teleporting,
    set the targets too.
  - Register `this.events.once('shutdown'|'destroy')` → cleanup (Phaser never calls a `shutdown()` method itself);
    Game.js removes `game:ended` (it wrongly removed `game:end`).
  - Meeting uses the server's `players` list and `durationMs`; add a Skip button; MeetingTile reads playerId when
    voting, not at module load. On `meeting:ended` with `ejectedId`, mark that sprite dead.
  - EndGame shows the ranking + "Play again" (back to the waiting room) + "Leave". Listen to `room:host`.
  - Remove the fake "server slow" toast and the `socketService.connect/disconnect` calls in App (the connection
    lives in Electron's main process). Show a toast on disconnect; reload the page when the connection comes back.
  - Small network HUD (proto, server, state, RTT, packets/bytes, retransmits) from `stats`.
- `frontend/package.json`: drop socket.io-client/express/dotenv; scripts `"dev": "vite --config vite/config.dev.mjs"`,
  `"build": "vite build --config vite/config.prod.mjs"`, `"tcp": "electron electron/main.cjs --proto tcp --server
  127.0.0.1 --port 5000"`, `"udp": "electron electron/main.cjs --proto udp --server 127.0.0.1 --port 5001"`.
  Remove the proxy from `vite/config.dev.mjs`. Delete `log.js`, `services/socket.js`, `utils/urls.js`, `.env.example`.

### 3. Test, then README
- Headless Node test: 3 clients (using the same client transport modules) play a full game over TCP, then UDP, then
  UDP with `--loss 0.2`; kill a client mid-game (detected within 5 s, game continues or ends cleanly).
- README: per-version run commands (server laptop: `cd backend && npm run tcp|udp`; client laptops:
  `cd frontend && npm install && npm run build && npm run tcp -- --server <server IP>`), Windows Firewall rule for
  TCP 5000 / UDP 5001, Wireshark filters (`tcp.port == 5000`, `udp.port == 5001`), Tailscale for the bonus.
