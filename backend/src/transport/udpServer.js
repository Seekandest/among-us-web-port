// backend/src/transport/udpServer.js
// UDP version of the server transport. Uses ONLY Node's built-in 'dgram' module (raw UDP sockets).
//
// UDP has no connections, no ACKs, no ordering, no retransmission. One socket receives datagrams
// from every client, and each datagram tells us who sent it (rinfo.address + rinfo.port).
// So everything TCP did for us, we do here, only where the game needs it:
//   - "connection": HELLO -> WELCOME handshake creates a session for that address:port
//   - reliability:  shared/reliableUdp.cjs (seq + ACK + retransmission + order), one channel per client
//   - disconnection: no packet for 5 s -> timeout; BYE -> clean leave; 25 resends without ACK -> dead
//
// Packet kinds (one JSON object per datagram, field "t"):
//   HELLO / WELCOME   handshake             (client -> server / server -> client)
//   PING  / PONG      heartbeat + RTT       (client -> server / server -> client)
//   BYE               leaving / "I don't know you" (both directions)
//   MSG / ACK / FAST  game messages         (handled by ReliableChannel)
//
// Same interface as tcpServer.js: on('connect'|'message'|'disconnect'), send(sessionId, type, data).

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
// The shared files are CommonJS (so Electron can require them too): import the whole module, then pick.
import reliableUdp from '../../../shared/reliableUdp.cjs';
import protocol from '../../../shared/protocol.cjs';

const { ReliableChannel } = reliableUdp;
const { TIMEOUT_MS, MAX_DATAGRAM_BYTES, UNRELIABLE_TYPES } = protocol;

export function startUdpServer(port, { loss = 0 } = {}) {
    const events = new EventEmitter();
    const socket = dgram.createSocket('udp4');
    const sessionsByAddress = new Map(); // "ip:port" -> session
    const sessionsById = new Map();      // sessionId -> session
    let nextId = 1;
    const totals = { datagramsIn: 0, datagramsOut: 0, bytesIn: 0, bytesOut: 0, simulatedLoss: 0 };

    // Write one datagram to one address. Optional simulated loss (--loss 0.1 = drop 10%).
    function sendRaw(address, port, packet) {
        if (loss > 0 && Math.random() < loss) {
            totals.simulatedLoss++;
            return;
        }
        const bytes = Buffer.from(JSON.stringify(packet));
        if (bytes.length > MAX_DATAGRAM_BYTES) {
            console.warn(`[UDP] warning: ${bytes.length}-byte datagram (${packet.type || packet.t}) may be fragmented`);
        }
        totals.datagramsOut++;
        totals.bytesOut += bytes.length;
        socket.send(bytes, port, address);
    }

    function createSession(address, port) {
        const key = `${address}:${port}`;
        const session = {
            id: `udp-${nextId++}`,
            key,
            ip: address,
            port,
            lastHeardAt: Date.now(),
            closed: false,
            channel: null,
        };
        session.channel = new ReliableChannel({
            sendPacket: (packet) => sendRaw(address, port, packet),
            onMessage: (type, data) => events.emit('message', session.id, type, data),
        });
        sessionsByAddress.set(key, session);
        sessionsById.set(session.id, session);
        console.log(`[UDP] + ${session.id} connected from ${key}`);
        events.emit('connect', session.id, key);
        return session;
    }

    function closeSession(session, reason, { sayBye = true } = {}) {
        if (session.closed) return;
        session.closed = true;
        sessionsByAddress.delete(session.key);
        sessionsById.delete(session.id);
        if (sayBye) sendRaw(session.ip, session.port, { t: 'BYE', reason });
        console.log(`[UDP] - ${session.id} disconnected (${reason})`);
        events.emit('disconnect', session.id, reason);
    }

    socket.on('message', (buffer, rinfo) => {
        if (loss > 0 && Math.random() < loss) {
            totals.simulatedLoss++;
            return;
        }
        totals.datagramsIn++;
        totals.bytesIn += buffer.length;

        let packet;
        try {
            packet = JSON.parse(buffer.toString('utf8'));
        } catch {
            return; // not one of our packets: ignore it
        }
        if (!packet || typeof packet.t !== 'string') return;

        // The sender's address comes from the IP/UDP headers (rinfo), never from the payload.
        const key = `${rinfo.address}:${rinfo.port}`;
        let session = sessionsByAddress.get(key);

        if (packet.t === 'HELLO') {
            // A HELLO from an address we already know means the client restarted its side
            // (its sequence numbers start again at 1), so we start a fresh session too.
            if (session) closeSession(session, 'client restarted the handshake', { sayBye: false });
            session = createSession(rinfo.address, rinfo.port);
            sendRaw(rinfo.address, rinfo.port, { t: 'WELCOME', sessionId: session.id, proto: 'udp' });
            return;
        }

        if (!session) {
            // We don't know this address (e.g. we already timed it out): tell it to start again.
            sendRaw(rinfo.address, rinfo.port, { t: 'BYE', reason: 'unknown session, send HELLO' });
            return;
        }

        session.lastHeardAt = Date.now();

        if (packet.t === 'PING') {
            sendRaw(session.ip, session.port, { t: 'PONG', ts: packet.ts });
        } else if (packet.t === 'BYE') {
            closeSession(session, 'client said BYE', { sayBye: false });
        } else {
            session.channel.handlePacket(packet); // MSG / ACK / FAST
        }
    });

    // Every 50 ms: resend unacknowledged messages, and detect dead clients.
    setInterval(() => {
        const now = Date.now();
        for (const session of [...sessionsById.values()]) {
            if (now - session.lastHeardAt > TIMEOUT_MS) {
                closeSession(session, `timeout: nothing received for ${TIMEOUT_MS / 1000} s`);
            } else if (!session.channel.tick(now)) {
                closeSession(session, 'too many retransmissions without ACK');
            }
        }
    }, 50);

    function send(sessionId, type, data) {
        const session = sessionsById.get(sessionId);
        if (!session || session.closed) return;
        if (UNRELIABLE_TYPES.includes(type)) session.channel.sendUnreliable(type, data);
        else session.channel.sendReliable(type, data);
    }

    socket.on('error', (err) => {
        console.error(`[UDP] socket error: ${err.message}`);
        process.exit(1);
    });

    socket.bind(port, '0.0.0.0', () => {
        console.log(`[UDP] game server listening on 0.0.0.0:${port}` + (loss ? ` (simulated loss ${loss * 100}%)` : ''));
    });

    return {
        proto: 'udp',
        on: (event, handler) => events.on(event, handler),
        send,
        totals,
        sessionStats() {
            return [...sessionsById.values()].map((s) => ({ id: s.id, address: s.key, ...s.channel.snapshot() }));
        },
    };
}
