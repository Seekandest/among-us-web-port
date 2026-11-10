// backend/src/transport/tcpServer.js
// TCP version of the server transport. Uses ONLY Node's built-in 'net' module (raw TCP sockets).
//
// What TCP already gives us (the OS does it, not our code):
//   - connection setup (3-way handshake SYN / SYN-ACK / ACK)
//   - reliable, ordered delivery (sequence numbers, ACKs, retransmissions inside the kernel)
// What we still have to do ourselves:
//   - FRAMING: TCP is a byte stream, so we cut it into messages (see shared/lineFramer.cjs)
//   - DISCONNECTION DETECTION: 'close' tells us about clean exits and resets, but a pulled cable or
//     a dead Wi-Fi sends nothing, so we use our own heartbeat (PING every 1 s, timeout 5 s).
//
// Interface (identical in udpServer.js, so the game code does not know which one it uses):
//   transport.on('connect',    (sessionId, address) => {})
//   transport.on('message',    (sessionId, type, data) => {})
//   transport.on('disconnect', (sessionId, reason) => {})
//   transport.send(sessionId, type, data)

import net from 'node:net';
import { EventEmitter } from 'node:events';
// The shared files are CommonJS (so Electron can require them too): import the whole module, then pick.
import framing from '../../../shared/lineFramer.cjs';
import protocol from '../../../shared/protocol.cjs';

const { LineFramer, encodeLine } = framing;
const { TIMEOUT_MS } = protocol;

export function startTcpServer(port) {
    const events = new EventEmitter();
    const sessions = new Map(); // sessionId -> { id, socket, address, lastHeardAt, stats }
    let nextId = 1;

    const server = net.createServer((socket) => {
        // A new client finished the TCP 3-way handshake: we get a dedicated socket for it.
        const session = {
            id: `tcp-${nextId++}`,
            socket,
            address: `${socket.remoteAddress}:${socket.remotePort}`,
            lastHeardAt: Date.now(),
            closed: false,
            stats: { bytesIn: 0, bytesOut: 0, msgsIn: 0, msgsOut: 0 },
        };
        sessions.set(session.id, session);

        // Disable Nagle's algorithm: by default TCP waits to group small writes together,
        // which adds delay to our small, frequent game messages.
        socket.setNoDelay(true);

        const framer = new LineFramer((msg) => {
            session.stats.msgsIn++;
            if (!msg || typeof msg.type !== 'string') return;

            if (msg.type === 'PING') {
                // Heartbeat: answer immediately so the client can measure the round-trip time.
                send(session.id, 'PONG', msg.data);
                return;
            }
            events.emit('message', session.id, msg.type, msg.data);
        });

        socket.on('data', (chunk) => {
            session.lastHeardAt = Date.now();
            session.stats.bytesIn += chunk.length;
            framer.push(chunk);
        });

        // 'error' (e.g. ECONNRESET when the client process is killed) is always followed by 'close'.
        socket.on('error', (err) => {
            console.log(`[TCP] ${session.id} socket error: ${err.code || err.message}`);
        });
        socket.on('close', (hadError) => {
            closeSession(session, hadError ? 'connection reset' : 'connection closed');
        });

        console.log(`[TCP] + ${session.id} connected from ${session.address}`);
        send(session.id, 'welcome', { sessionId: session.id, proto: 'tcp' });
        events.emit('connect', session.id, session.address);
    });

    function send(sessionId, type, data) {
        const session = sessions.get(sessionId);
        if (!session || session.closed || session.socket.destroyed) return;
        const line = encodeLine({ type, data });
        session.stats.bytesOut += Buffer.byteLength(line);
        session.stats.msgsOut++;
        // write() only copies the bytes into the kernel send buffer; TCP delivers them later.
        session.socket.write(line);
    }

    function closeSession(session, reason) {
        if (session.closed) return;
        session.closed = true;
        sessions.delete(session.id);
        if (!session.socket.destroyed) session.socket.destroy();
        console.log(`[TCP] - ${session.id} disconnected (${reason})`);
        events.emit('disconnect', session.id, reason);
    }

    // Heartbeat check: a client that sent nothing for TIMEOUT_MS is considered gone.
    // This is what detects a pulled cable / closed laptop lid: TCP itself would stay silent.
    setInterval(() => {
        const now = Date.now();
        for (const session of sessions.values()) {
            if (now - session.lastHeardAt > TIMEOUT_MS) {
                closeSession(session, `timeout: nothing received for ${TIMEOUT_MS / 1000} s`);
            }
        }
    }, 500);

    server.on('error', (err) => {
        console.error(`[TCP] server error: ${err.message}`);
        process.exit(1);
    });

    // 0.0.0.0 = listen on every network interface (Wi-Fi, Ethernet, Tailscale...), not only localhost.
    server.listen(port, '0.0.0.0', () => {
        console.log(`[TCP] game server listening on 0.0.0.0:${port}`);
    });

    return {
        proto: 'tcp',
        on: (event, handler) => events.on(event, handler),
        send,
        sessionStats() {
            return [...sessions.values()].map((s) => ({ id: s.id, address: s.address, ...s.stats }));
        },
    };
}
