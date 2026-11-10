// frontend/electron/tcpClient.cjs
// TCP version of the CLIENT transport. Runs in Electron's main process (Node.js), because a web page
// cannot open a raw TCP socket. Uses ONLY Node's built-in 'net' module.
//
// What the operating system's TCP stack does for us (not our code):
//   - the 3-way handshake (SYN, SYN-ACK, ACK) when we connect,
//   - reliable, ordered delivery: sequence numbers, ACKs and retransmissions happen in the kernel,
//   - FIN when we close cleanly, RST when the other side's process is killed.
// What we must still do ourselves:
//   - FRAMING: TCP is a byte stream, so we cut it into messages, one JSON per line (shared/lineFramer.cjs).
//   - DEAD-PEER DETECTION: if the server's cable is pulled, NO packet arrives to tell us. TCP would
//     stay silent (its keep-alive needs ~2 hours by default), so we send PING every 1 s and give up
//     after 5 s with nothing received.
//   - RECONNECTION: a TCP connection that died cannot be revived; we open a new one every 2 s.
//
// Messages on the wire (one JSON object + '\n' each):
//   server -> client  {"type":"welcome","data":{"sessionId":"tcp-3","proto":"tcp"}}   first message
//   client -> server  {"type":"PING","data":{"ts":1731270000000}}                       every 1 s
//   server -> client  {"type":"PONG","data":{"ts":1731270000000}}                       same ts back
//   both directions   {"type":"room:join","data":{"roomId":"AB12CD"}}                  game messages
//
// Same interface as udpClient.cjs, so electron/main.cjs does not care which one it uses:
//   createTcpClient({ host, port, onMessage(type, data), onStatus(status) })
//     -> { send(type, data), close(), status(), stats() }

const net = require('node:net');
const { LineFramer, encodeLine } = require('../../shared/lineFramer.cjs');
const { HEARTBEAT_INTERVAL_MS, TIMEOUT_MS } = require('../../shared/protocol.cjs');

const RECONNECT_DELAY_MS = 2000;

// Turn socket error codes into something readable in the UI.
function describeError(err) {
    switch (err.code) {
        case 'ECONNREFUSED': return 'server not running (ECONNREFUSED: nothing listens on that port)';
        case 'ECONNRESET': return 'connection reset by the server (ECONNRESET)';
        case 'ETIMEDOUT': return 'connection timed out (ETIMEDOUT)';
        case 'EHOSTUNREACH': return 'host unreachable (EHOSTUNREACH)';
        case 'ENETUNREACH': return 'network unreachable (ENETUNREACH)';
        case 'ENOTFOUND': return 'unknown host name (ENOTFOUND)';
        default: return err.code || err.message;
    }
}

function createTcpClient({ host, port, loss = 0, onMessage, onStatus }) {
    if (loss > 0) {
        // Loss is repaired by the OS's TCP stack below our code; we cannot drop "a message" without
        // corrupting the byte stream. Impair the network itself (clumsy / tc netem) to test TCP.
        console.warn('[TCP] --loss is ignored in the TCP version (use clumsy / tc netem instead)');
    }

    let socket = null;
    let closeReason = null;       // why the current socket is closing (error code, timeout...)
    let state = 'connecting';     // 'connecting' -> 'connected' (after welcome) -> 'disconnected'
    let sessionId = null;
    let reason = null;
    let local = null;             // our own ip:port, chosen by the OS when the connection is made
    let lastHeardAt = 0;          // last time ANY byte came from the server
    let rttMs = null;
    let closedByUser = false;
    let reconnectTimer = null;

    const counters = { msgsOut: 0, msgsIn: 0, bytesOut: 0, bytesIn: 0 };
    let lastSecond = { ...counters };
    let perSecond = { msgsOut: 0, msgsIn: 0, bytesOut: 0, bytesIn: 0 };

    function status() {
        return { state, sessionId, reason, proto: 'tcp', server: host, port, local };
    }

    function setState(newState, newReason = null) {
        state = newState;
        reason = newReason;
        onStatus(status());
    }

    // Write one message on the socket. write() only copies the bytes into the kernel's send buffer;
    // TCP sends (and if needed retransmits) them afterwards.
    function writeMessage(type, data) {
        const line = encodeLine({ type, data });
        counters.msgsOut++;
        counters.bytesOut += Buffer.byteLength(line);
        socket.write(line);
    }

    function connect() {
        reconnectTimer = null;
        if (closedByUser) return;
        setState('connecting');
        sessionId = null;
        local = null;
        lastHeardAt = Date.now(); // the 5 s timeout also covers a handshake that never completes

        // Starts the 3-way handshake. The OS picks our local port (an "ephemeral" port).
        const s = net.createConnection({ host, port });
        socket = s;
        closeReason = null;
        // Disable Nagle's algorithm: by default TCP delays small writes to group them into one
        // segment, which adds latency to our small, frequent game messages (positions at 20 Hz).
        s.setNoDelay(true);

        const framer = new LineFramer((msg) => {
            counters.msgsIn++;
            if (!msg || typeof msg.type !== 'string') return;

            if (msg.type === 'welcome') {
                // The server accepted us and gave us our session id: from now on we are "connected".
                sessionId = msg.data && msg.data.sessionId;
                console.log(`[TCP] connected: local ${local} -> server ${host}:${port}, session ${sessionId}`);
                setState('connected');
            } else if (msg.type === 'PONG') {
                // The server sent our own timestamp back: now - ts = round-trip time.
                if (msg.data && typeof msg.data.ts === 'number') rttMs = Date.now() - msg.data.ts;
            } else {
                onMessage(msg.type, msg.data);
            }
        });

        // The handshake finished (SYN, SYN-ACK, ACK). We now know which local port the OS gave us.
        s.on('connect', () => {
            local = `${s.localAddress}:${s.localPort}`;
        });

        s.on('data', (chunk) => {
            lastHeardAt = Date.now();
            counters.bytesIn += chunk.length;
            framer.push(chunk); // may contain half a message, or several: the framer handles it
        });

        // 'error' is always followed by 'close', so the state change happens in 'close'.
        s.on('error', (err) => {
            if (!closeReason) closeReason = describeError(err);
        });

        s.on('close', () => {
            if (s !== socket) return;   // an old socket we already replaced
            socket = null;
            if (closedByUser) return;   // close() already reported it
            const why = closeReason || 'connection closed by the server';
            console.log(`[TCP] disconnected: ${why}`);
            setState('disconnected', why);
            // A closed TCP connection cannot be reused: open a brand new one (new handshake,
            // new local port, new session on the server).
            reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        });
    }

    // Heartbeat: once a second, send PING (only after the handshake, socket.connecting is false then).
    const pingTimer = setInterval(() => {
        if (socket && !socket.connecting && !socket.destroyed) writeMessage('PING', { ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);

    // Dead-server check: nothing received for TIMEOUT_MS -> we give up on this connection.
    // destroy() closes the socket locally (we cannot send a FIN to a server we can't reach anyway);
    // 'close' fires next and schedules a reconnection.
    const timeoutTimer = setInterval(() => {
        if (socket && !socket.destroyed && Date.now() - lastHeardAt > TIMEOUT_MS) {
            closeReason = `timeout: nothing received from the server for ${TIMEOUT_MS / 1000} s`;
            socket.destroy();
        }
    }, 500);

    // Messages and bytes per second, for the network HUD.
    const rateTimer = setInterval(() => {
        perSecond = {
            msgsOut: counters.msgsOut - lastSecond.msgsOut,
            msgsIn: counters.msgsIn - lastSecond.msgsIn,
            bytesOut: counters.bytesOut - lastSecond.bytesOut,
            bytesIn: counters.bytesIn - lastSecond.bytesIn,
        };
        lastSecond = { ...counters };
    }, 1000);

    connect();

    return {
        /** Send one game message. Dropped (with a warning) if we are not connected. */
        send(type, data) {
            if (state !== 'connected' || !socket) {
                console.warn(`[TCP] not connected, dropped "${type}"`);
                return;
            }
            writeMessage(type, data);
        },

        /** Clean exit: end() sends a FIN after the pending bytes, so the server sees 'close' at once. */
        close() {
            closedByUser = true;
            clearInterval(pingTimer);
            clearInterval(timeoutTimer);
            clearInterval(rateTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (socket) socket.end();
            setState('disconnected', 'closed by user');
        },

        status,

        stats() {
            return { proto: 'tcp', state, rttMs, ...counters, perSecond };
        },
    };
}

module.exports = { createTcpClient };
