// backend/src/main.js
// Entry point of the game server. Run it with ONE of the two transports:
//
//   node src/main.js --proto tcp --port 5000
//   node src/main.js --proto udp --port 5001 [--loss 0.1]
//
// This is the only file that knows which transport is used. The game logic (events/*.js) only sees
// "sessions" (one per connected client) and calls ctx.sendTo / sendToRoom / ... below. That is how the
// two versions keep identical rules: the game code is shared, only transport/tcpServer.js or
// transport/udpServer.js changes.
//
// Both transports expose exactly the same interface:
//   transport.on('connect',    (sessionId, address) => {})   a client is now reachable
//   transport.on('message',    (sessionId, type, data) => {}) one complete game message arrived
//   transport.on('disconnect', (sessionId, reason) => {})    the client left, crashed or timed out
//   transport.send(sessionId, type, data)                     send one message to one client
//
// The SESSION is the identity of a client:
//   - TCP: one session = one accepted TCP connection (one socket).
//   - UDP: one session = one remote "ip:port" that completed the HELLO -> WELCOME handshake.
// A client never chooses its session id; the server assigns it. So when a message arrives we know
// WHO sent it from the socket / address it came from, never from what the payload claims.

import { startTcpServer } from './transport/tcpServer.js';
import { startUdpServer } from './transport/udpServer.js';
import protocol from '../../shared/protocol.cjs';
import { RoomsManager, publicRoom } from './managers/rooms.manager.js';
import { PlayersManager } from './managers/players.manager.js';
import { roomHandlers, handleSessionGone } from './events/roomEvents.js';
import { gameHandlers } from './events/gameEvents.js';

const { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT } = protocol;
const STATS_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------------------------
// 1. Command-line arguments: --proto tcp|udp  --port <n>  --loss <0..1>
//    Accepts "--port 5000" and "--port=5000". If a flag is given twice, the LAST one wins
//    (so "npm run tcp -- --port 6000" overrides the port written in package.json).
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;
        const eq = arg.indexOf('=');
        if (eq !== -1) {
            args[arg.slice(2, eq)] = arg.slice(eq + 1);
        } else {
            args[arg.slice(2)] = argv[i + 1];
            i++;
        }
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const proto = String(args.proto || '').toLowerCase();
if (proto !== 'tcp' && proto !== 'udp') {
    console.error('Usage: node src/main.js --proto tcp|udp [--port <n>] [--loss <0..1>]');
    process.exit(1);
}
// Port: --port, else the GAME_PORT environment variable, else 5000 (TCP) / 5001 (UDP).
// The server always listens on 0.0.0.0 (every interface, Tailscale/ZeroTier included), so it never
// needs to know its own IP address; only the clients do (GAME_SERVER, see frontend/electron/main.cjs).
const port = Number(args.port) || Number(process.env.GAME_PORT) || (proto === 'tcp' ? DEFAULT_TCP_PORT : DEFAULT_UDP_PORT);
const loss = Number(args.loss) || 0;
if (!(loss >= 0 && loss < 1)) {
    console.error('--loss must be between 0 and 1 (e.g. 0.1 = drop 10% of datagrams)');
    process.exit(1);
}
if (proto === 'tcp' && loss > 0) {
    // In TCP, packet loss is repaired by the operating system's TCP stack, below our code: we cannot
    // "drop a message" without breaking the byte stream. To test TCP under loss, impair the network
    // itself (clumsy on Windows, tc netem on Linux) and watch the latency go up instead.
    console.warn('[server] --loss is ignored in the TCP version (use clumsy / tc netem to impair TCP)');
}

// ---------------------------------------------------------------------------------------------
// 2. Start the chosen transport. Both listen on 0.0.0.0 (every interface: Wi-Fi, Ethernet, Tailscale).
// ---------------------------------------------------------------------------------------------
const transport = proto === 'tcp' ? startTcpServer(port) : startUdpServer(port, { loss });

// ---------------------------------------------------------------------------------------------
// 3. Who is who.
//    connectedSessions: every client currently reachable (registered or not), for "send to everyone".
//    sessionToPlayer / playerToSession: set when a client registers (player:register).
// ---------------------------------------------------------------------------------------------
const connectedSessions = new Set();
const sessionToPlayer = new Map(); // sessionId -> playerId
const playerToSession = new Map(); // playerId  -> sessionId

// ctx = everything the event handlers need. They never touch the transport directly.
const ctx = {
    proto,

    // --- identity ---
    playerIdOf(sessionId) {
        return sessionToPlayer.get(sessionId) || null;
    },
    sessionOf(playerId) {
        return playerToSession.get(playerId) || null;
    },
    isConnected(sessionId) {
        return connectedSessions.has(sessionId);
    },
    bind(sessionId, playerId) {
        sessionToPlayer.set(sessionId, playerId);
        playerToSession.set(playerId, sessionId);
    },
    unbind(sessionId) {
        const playerId = sessionToPlayer.get(sessionId);
        sessionToPlayer.delete(sessionId);
        if (playerId && playerToSession.get(playerId) === sessionId) playerToSession.delete(playerId);
        return playerId || null;
    },

    // --- sending ---
    // One message to one client. In TCP it becomes one line on that client's socket; in UDP one
    // datagram (reliable MSG, or FAST for positions) to that client's ip:port.
    sendTo(sessionId, type, data) {
        transport.send(sessionId, type, data);
    },
    sendToPlayer(playerId, type, data) {
        const sessionId = playerToSession.get(playerId);
        if (sessionId) transport.send(sessionId, type, data);
    },
    // Neither TCP nor UDP unicast has "rooms" or "broadcast to a group": a room broadcast is simply
    // one separate send per player (3 players = 3 TCP writes, or 3 UDP datagrams).
    sendToRoom(roomId, type, data, exceptPlayerId = null) {
        const room = RoomsManager.fetchRoom(roomId);
        if (!room) return;
        for (const playerId of Object.keys(room.players)) {
            if (playerId !== exceptPlayerId) ctx.sendToPlayer(playerId, type, data);
        }
    },
    sendToEveryone(type, data) {
        for (const sessionId of connectedSessions) transport.send(sessionId, type, data);
    },
    // The lobby list is pushed to everybody whenever any room changes (no polling, no HTTP).
    broadcastRooms() {
        ctx.sendToEveryone('rooms:list', { rooms: RoomsManager.fetchRooms().map(publicRoom) });
    },
};

// ---------------------------------------------------------------------------------------------
// 4. Wire transport events to the game.
// ---------------------------------------------------------------------------------------------
const handlers = { ...roomHandlers, ...gameHandlers };

transport.on('connect', (sessionId, address) => {
    connectedSessions.add(sessionId);
    console.log(`[server] session ${sessionId} ready (${address}), ${connectedSessions.size} connected`);
});

transport.on('message', (sessionId, type, data) => {
    const handler = handlers[type];
    if (!handler) {
        console.log(`[server] ignored unknown message "${type}" from ${sessionId}`);
        return;
    }
    // Positions arrive 20 times per second per player: do not flood the console with them.
    if (type !== 'player:move') console.log(`[server] ${sessionId} -> ${type}`);

    // Never trust the payload's shape: it came from the network.
    const safeData = data && typeof data === 'object' ? data : {};
    // A bug in one handler must not crash the server for everybody. Some handlers are async
    // (player:register waits for the password hash), so catch both thrown errors and rejections.
    const onError = (err) => console.error(`[server] error while handling "${type}" from ${sessionId}:`, err);
    try {
        const result = handler(ctx, sessionId, safeData);
        if (result && typeof result.then === 'function') result.catch(onError);
    } catch (err) {
        onError(err);
    }
});

// Fired for a clean exit, a reset connection, or a heartbeat timeout (pulled cable, closed lid).
// The game reacts the same way in all cases: the player leaves the room.
transport.on('disconnect', (sessionId, reason) => {
    connectedSessions.delete(sessionId);
    try {
        handleSessionGone(ctx, sessionId, reason);
    } catch (err) {
        console.error(`[server] error while cleaning up ${sessionId}:`, err);
    }
    console.log(`[server] session ${sessionId} gone (${reason}), ${connectedSessions.size} connected`);
});

// ---------------------------------------------------------------------------------------------
// 5. Network statistics every 10 s (useful for the TCP vs UDP comparison slides).
// ---------------------------------------------------------------------------------------------
setInterval(() => {
    const sessions = transport.sessionStats();
    const players = PlayersManager.getAllPlayers().length;
    const rooms = RoomsManager.fetchRooms().length;
    console.log(`[stats] ${proto.toUpperCase()} | ${sessions.length} sessions, ${players} players, ${rooms} rooms`);

    if (proto === 'udp' && transport.totals) {
        const t = transport.totals;
        console.log(`[stats]   datagrams in/out ${t.datagramsIn}/${t.datagramsOut}, bytes in/out ${t.bytesIn}/${t.bytesOut}, ` +
            `simulated loss ${t.simulatedLoss}, wrong session token ${t.badToken}`);
    }
    for (const s of sessions) {
        const who = sessionToPlayer.get(s.id) || 'not registered';
        if (proto === 'tcp') {
            console.log(`[stats]   ${s.id} ${s.address} (${who}): bytes in/out ${s.bytesIn}/${s.bytesOut}, msgs in/out ${s.msgsIn}/${s.msgsOut}`);
        } else {
            console.log(`[stats]   ${s.id} ${s.address} (${who}): reliable ${s.reliableSent}, fast ${s.fastSent}, ` +
                `retransmits ${s.retransmits}, positions lost ${s.fastLost}/${s.fastLost + s.fastReceived}, ` +
                `dup ${s.duplicatesIgnored}, out-of-order ${s.outOfOrderBuffered}, ` +
                `stale ${s.staleDropped}, waiting ACK ${s.waitingForAck}, RTO ${s.rtoMs} ms`);
        }
    }
}, STATS_INTERVAL_MS);

console.log(`[server] Among Us Arena game server, ${proto.toUpperCase()} version, port ${port}`);
