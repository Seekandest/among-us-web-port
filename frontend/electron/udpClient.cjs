// frontend/electron/udpClient.cjs
// UDP version of the CLIENT transport. Runs in Electron's main process (Node.js), because a web page
// cannot open a raw UDP socket. Uses ONLY Node's built-in 'dgram' module. No TCP anywhere.
//
// UDP gives us much less than TCP: each send() is one independent datagram that may be LOST,
// DUPLICATED or arrive OUT OF ORDER, and there is no connection, so nobody tells us when the
// server goes away. Everything TCP did in the kernel, we do here, in our own code:
//   - "connection":   HELLO every 1 s until the server answers WELCOME {sessionId}
//   - reliability:    shared/reliableUdp.cjs (seq numbers, ACKs, retransmission, ordering, dedupe)
//                     for game events; positions use unreliable FAST packets (a lost one is replaced
//                     50 ms later, resending it would be useless)
//   - liveness:       PING every 1 s, PONG gives the RTT; nothing heard for 5 s = server gone
//   - leaving:        BYE when we quit, so the server does not have to wait for the timeout
//   - reconnection:   after any disconnection, back to the HELLO loop with a fresh channel
//
// Datagrams on the wire (one JSON object each, field "t" = packet kind):
//   {"t":"HELLO"}                                 client -> server
//   {"t":"WELCOME","sessionId":"udp-2","proto":"udp"} server -> client
//   {"t":"PING","ts":1731270000000} / {"t":"PONG","ts":...}
//   {"t":"BYE","reason":"..."}                    either direction
//   {"t":"MSG","seq":7,"type":"room:join","data":{...}}  reliable    (needs an ACK)
//   {"t":"ACK","seq":7}                                  acknowledgement
//   {"t":"FAST","n":345,"type":"player:move","data":{...}} unreliable (no ACK, no resend)
//
// Same interface as tcpClient.cjs:
//   createUdpClient({ host, port, loss, onMessage(type, data), onStatus(status) })
//     -> { send(type, data), close(), status(), stats() }

const dgram = require('node:dgram');
const { ReliableChannel } = require('../../shared/reliableUdp.cjs');
const {
    HEARTBEAT_INTERVAL_MS, TIMEOUT_MS, MAX_DATAGRAM_BYTES, UNRELIABLE_TYPES,
} = require('../../shared/protocol.cjs');

const HELLO_INTERVAL_MS = 1000;
const TICK_MS = 50;

// Counters of the ReliableChannel. A new channel is created on every (re)connection, so we add the
// counters of the old channels to keep totals that only go up (nicer for the CSV / slides).
const CHANNEL_COUNTERS = [
    'reliableSent', 'fastSent', 'retransmits', 'acksReceived',
    'duplicatesIgnored', 'outOfOrderBuffered', 'staleDropped',
];

function createUdpClient({ host, port, loss = 0, onMessage, onStatus }) {
    // One UDP socket for the whole life of the client. Unlike TCP there is no per-connection socket:
    // the same socket sends to and receives from the server's ip:port.
    const socket = dgram.createSocket('udp4');

    let state = 'connecting';
    let sessionId = null;
    let reason = null;
    let local = null;
    let channel = null;           // ReliableChannel, only while connected
    let lastHeardAt = 0;
    let rttMs = null;
    let closed = false;

    const counters = { msgsOut: 0, msgsIn: 0, bytesOut: 0, bytesIn: 0, simulatedLoss: 0 };
    const previousChannels = Object.fromEntries(CHANNEL_COUNTERS.map(k => [k, 0]));
    let lastSecond = { ...counters };
    let perSecond = { msgsOut: 0, msgsIn: 0, bytesOut: 0, bytesIn: 0 };

    function status() {
        return { state, sessionId, reason, proto: 'udp', server: host, port, local };
    }

    function setState(newState, newReason = null) {
        state = newState;
        reason = newReason;
        onStatus(status());
    }

    // Send ONE datagram to the server. With --loss 0.1, 10% of them are "lost" on purpose
    // (never handed to the OS) to show what our reliability layer does on a bad network.
    function sendPacket(packet, { simulateLoss = true } = {}) {
        if (closed && packet.t !== 'BYE') return;
        if (simulateLoss && loss > 0 && Math.random() < loss) {
            counters.simulatedLoss++;
            return;
        }
        const bytes = Buffer.from(JSON.stringify(packet));
        if (bytes.length > MAX_DATAGRAM_BYTES) {
            console.warn(`[UDP] ${bytes.length}-byte datagram (${packet.type || packet.t}) may be fragmented by IP`);
        }
        counters.msgsOut++;
        counters.bytesOut += bytes.length;
        socket.send(bytes, port, host);
    }

    function connected(newSessionId) {
        sessionId = newSessionId;
        lastHeardAt = Date.now();
        // A fresh channel for a fresh session: both sides start their sequence numbers at 1 again.
        channel = new ReliableChannel({
            sendPacket: (packet) => sendPacket(packet),
            onMessage: (type, data) => onMessage(type, data),
        });
        console.log(`[UDP] connected: local ${local} -> server ${host}:${port}, session ${sessionId}`);
        setState('connected');
    }

    // Back to "not connected": forget the channel (and every message waiting for an ACK in it) and
    // let the HELLO loop start a new handshake.
    function reset(why) {
        if (state !== 'connected') return;
        if (channel) {
            const snap = channel.snapshot();
            for (const k of CHANNEL_COUNTERS) previousChannels[k] += snap[k];
        }
        channel = null;
        sessionId = null;
        console.log(`[UDP] disconnected: ${why}`);
        setState('disconnected', why);
    }

    socket.on('message', (buffer, rinfo) => {
        // Our socket can receive datagrams from anyone: only accept the server's port.
        if (rinfo.port !== port) return;
        if (loss > 0 && Math.random() < loss) {
            counters.simulatedLoss++;
            return;
        }
        counters.msgsIn++;
        counters.bytesIn += buffer.length;

        let packet;
        try {
            packet = JSON.parse(buffer.toString('utf8'));
        } catch {
            return; // not one of our packets
        }
        if (!packet || typeof packet.t !== 'string') return;

        if (packet.t === 'WELCOME') {
            if (state !== 'connected') {
                connected(packet.sessionId);
            } else if (packet.sessionId !== sessionId) {
                // A late WELCOME for a newer HELLO: the server restarted our session (its sequence
                // numbers are back to 1), so ours must restart too.
                reset('server restarted the session');
                connected(packet.sessionId);
            }
            return;
        }
        if (state !== 'connected') return; // anything else before WELCOME is stale: ignore it

        lastHeardAt = Date.now();
        if (packet.t === 'PONG') {
            if (typeof packet.ts === 'number') rttMs = Date.now() - packet.ts;
        } else if (packet.t === 'BYE') {
            // The server closed our session, or does not know us (it restarted, or timed us out).
            reset(`server said BYE: ${packet.reason || 'no reason'}`);
        } else {
            channel.handlePacket(packet); // MSG / ACK / FAST
        }
    });

    socket.on('error', (err) => {
        // On Windows, an ICMP "port unreachable" (no server on that port) can surface here as
        // ECONNRESET. It must not crash the client: the HELLO loop just keeps trying.
        console.warn(`[UDP] socket error: ${err.code || err.message}`);
    });

    // HELLO loop: while not connected, knock on the server's door once a second.
    const helloTimer = setInterval(() => {
        if (state === 'connected' || closed) return;
        if (state !== 'connecting') setState('connecting', reason);
        sendPacket({ t: 'HELLO' });
    }, HELLO_INTERVAL_MS);

    // Heartbeat: PING once a second while connected (the server answers PONG).
    const pingTimer = setInterval(() => {
        if (state === 'connected') sendPacket({ t: 'PING', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    // Every 50 ms: resend reliable messages that were not ACKed in time, and check the server is alive.
    const tickTimer = setInterval(() => {
        if (state !== 'connected') return;
        if (Date.now() - lastHeardAt > TIMEOUT_MS) {
            reset(`timeout: nothing received from the server for ${TIMEOUT_MS / 1000} s`);
        } else if (!channel.tick()) {
            reset('too many retransmissions without ACK');
        }
    }, TICK_MS);

    const rateTimer = setInterval(() => {
        perSecond = {
            msgsOut: counters.msgsOut - lastSecond.msgsOut,
            msgsIn: counters.msgsIn - lastSecond.msgsIn,
            bytesOut: counters.bytesOut - lastSecond.bytesOut,
            bytesIn: counters.bytesIn - lastSecond.bytesIn,
        };
        lastSecond = { ...counters };
    }, 1000);

    // bind(0): the OS picks a free local port for us. The server will see that port in the UDP
    // header of each datagram (rinfo.port) and use it as our address.
    socket.bind(0, () => {
        local = `${socket.address().address}:${socket.address().port}`;
        console.log(`[UDP] socket bound to ${local}, sending HELLO to ${host}:${port}`);
        onStatus(status());
        sendPacket({ t: 'HELLO' });
    });

    return {
        /** Reliable MSG for game events, unreliable FAST for positions. Dropped if not connected. */
        send(type, data) {
            if (state !== 'connected' || !channel) {
                console.warn(`[UDP] not connected, dropped "${type}"`);
                return;
            }
            if (UNRELIABLE_TYPES.includes(type)) channel.sendUnreliable(type, data);
            else channel.sendReliable(type, data);
        },

        /**
         * Clean exit: say BYE so the server frees our session now instead of after the 5 s timeout.
         * BYE itself is a plain datagram and could be lost on a real network; that is exactly why
         * the server ALSO has the timeout. (We don't apply the simulated loss to it.)
         */
        close() {
            if (closed) return;
            const wasConnected = state === 'connected';
            closed = true;
            [helloTimer, pingTimer, tickTimer, rateTimer].forEach(clearInterval);
            setState('disconnected', 'closed by user');
            if (wasConnected) {
                const bye = Buffer.from(JSON.stringify({ t: 'BYE', reason: 'client quit' }));
                // Close the socket only once the datagram has been handed to the OS.
                socket.send(bye, port, host, () => socket.close());
            } else {
                socket.close();
            }
        },

        status,

        stats() {
            const snap = channel ? channel.snapshot() : { waitingForAck: 0, rtoMs: null };
            const reliability = {};
            for (const k of CHANNEL_COUNTERS) reliability[k] = previousChannels[k] + (snap[k] || 0);
            return {
                proto: 'udp',
                state,
                rttMs,
                ...counters,
                perSecond,
                ...reliability,
                waitingForAck: snap.waitingForAck,
                rtoMs: snap.rtoMs,
            };
        },
    };
}

module.exports = { createUdpClient };
