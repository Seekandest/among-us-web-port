// src/services/net.js
// The page's ONLY access to the network.
//
// A web page (and this React + Phaser UI is one) cannot open raw TCP or UDP sockets: browsers only
// offer HTTP, WebSocket and WebRTC. So the real socket (electron/tcpClient.cjs or udpClient.cjs) lives
// in a Node.js process on the same computer, and this file only talks to that process:
//
//   - WEB version (npm run tcp / udp): the page is served by the local agent (web/agent.cjs) and talks
//     to it over HTTP on 127.0.0.1 (Server-Sent Events in, POST out). Loopback: never on the network.
//   - DESKTOP version (npm run desktop:tcp / desktop:udp): Electron's preload script provides
//     window.gameNet (electron/preload.cjs), and the page talks to the main process through IPC.
//
// Both give the same small interface (send / onMessage / onStatus / onStats / info), so the rest of
// the game code does not know which one it runs in.
//
//   net.emit('room:join', {roomId})  -> agent or main process -> TCP segment / UDP datagram -> server
//   server -> socket -> agent or main process -> net.on('room:joined', handler)
//
// Because the socket belongs to that process, the connection survives a page reload; on load
// we ask it for the current state with info().
//
// Special local events (never sent by the server):
//   'connect'    (status)  the transport became connected
//   'disconnect' (reason)  the transport lost the server (closed, reset, timeout...)
//   'status'     (status)  any change: {state, sessionId, reason, proto, server, port, local}
//   'stats'      (stats)   once per second: RTT, messages/bytes per second, retransmissions...

/**
 * The web version's bridge: same interface as Electron's window.gameNet, over the local agent
 * (web/agent.cjs) that served this page. Only used when the page is served over http(s), not inside
 * the Electron app.
 */
function createWebBridge() {
    const subscribers = { msg: new Set(), status: new Set(), stats: new Set() };
    const notify = (kind, payload) => subscribers[kind].forEach((fn) => fn(payload));
    const subscribe = (kind) => (fn) => {
        subscribers[kind].add(fn);
        return () => subscribers[kind].delete(fn);
    };

    // Agent -> page: one long-lived Server-Sent Events stream. The browser reconnects by itself.
    const events = new EventSource('/net/events');
    events.addEventListener('msg', (e) => notify('msg', JSON.parse(e.data)));
    events.addEventListener('status', (e) => notify('status', JSON.parse(e.data)));
    events.addEventListener('stats', (e) => notify('stats', JSON.parse(e.data)));
    events.onerror = () => notify('status', {
        state: 'disconnected',
        reason: 'local agent not reachable (is "npm run tcp" / "npm run udp" still running?)',
    });

    // Page -> agent: POST /net/send. Messages must reach the server in the order they were emitted
    // (a kill after a move, a vote after a meeting start...), but parallel HTTP requests can overtake
    // each other. So only one request is in flight at a time, and whatever was emitted meanwhile goes
    // in the next one, as a batch.
    let queue = [];
    let sending = false;
    async function flush() {
        if (sending || queue.length === 0) return;
        sending = true;
        const batch = queue;
        queue = [];
        try {
            const res = await fetch('/net/send', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(batch),
            });
            if (!res.ok) console.warn(`[net] agent refused ${batch.length} message(s): HTTP ${res.status}`);
        } catch (err) {
            console.warn(`[net] local agent not reachable, ${batch.length} message(s) dropped:`, err.message);
        } finally {
            sending = false;
            flush();
        }
    }

    return {
        send(type, data) {
            queue.push({ type, data });
            flush();
        },
        onMessage: (fn) => subscribe('msg')((m) => fn(m.type, m.data)),
        onStatus: subscribe('status'),
        onStats: subscribe('stats'),
        info: () => fetch('/net/info').then((r) => r.json()),
    };
}

const bridge = typeof window === 'undefined' ? undefined
    : window.gameNet                                         // desktop: Electron preload
    || (/^https?:$/.test(window.location.protocol) ? createWebBridge() : undefined); // web: local agent

/** @type {Map<string, Set<Function>>} message type -> handlers */
const listeners = new Map();

function dispatch(type, ...args) {
    const handlers = listeners.get(type);
    if (!handlers) return;
    for (const fn of [...handlers]) {
        try {
            fn(...args);
        } catch (err) {
            console.error(`[net] handler for "${type}" failed:`, err);
        }
    }
}

const net = {
    /** false when there is no local agent / Electron process to talk to */
    available: Boolean(bridge),
    /** true once the transport is connected (TCP: after 'welcome'; UDP: after WELCOME) */
    connected: false,
    /** our session id on the server (e.g. "tcp-3" / "udp-2"), null when not connected */
    id: null,
    /** last status received from the main process */
    info: null,

    on(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
    },

    /** off(type, fn) removes one handler; off(type) removes all handlers of that type. */
    off(type, fn) {
        const handlers = listeners.get(type);
        if (!handlers) return;
        if (!fn) {
            listeners.delete(type);
            return;
        }
        for (const h of handlers) {
            if (h === fn || h._original === fn) handlers.delete(h);
        }
    },

    once(type, fn) {
        const wrapper = (...args) => {
            net.off(type, wrapper);
            fn(...args);
        };
        wrapper._original = fn;
        net.on(type, wrapper);
    },

    /** Send one message to the server. The main process drops it if we are not connected. */
    emit(type, data = {}) {
        if (!bridge) {
            console.warn(`[net] no local agent / Electron process, "${type}" not sent`);
            return;
        }
        bridge.send(type, data);
    },

    /**
     * Send a message and wait for the first reply of type replyType.
     * e.g. const state = await net.request('room:get', {}, 'room:state')
     */
    request(type, data, replyType, timeoutMs = 5000) {
        return new Promise((resolve, reject) => {
            const onReply = (reply) => {
                clearTimeout(timer);
                net.off(replyType, onReply);
                resolve(reply);
            };
            const timer = setTimeout(() => {
                net.off(replyType, onReply);
                reject(new Error(`no "${replyType}" reply to "${type}" after ${timeoutMs} ms`));
            }, timeoutMs);
            net.on(replyType, onReply);
            net.emit(type, data);
        });
    },
};

function applyStatus(status) {
    if (!status) return;
    const wasConnected = net.connected;
    net.info = status;
    net.connected = status.state === 'connected';
    net.id = net.connected ? status.sessionId : null;
    dispatch('status', status);
    if (net.connected && !wasConnected) dispatch('connect', status);
    if (!net.connected && wasConnected) dispatch('disconnect', status.reason || 'connection lost');
}

/** Resolves once we know the current connection state (immediately outside Electron). */
net.ready = bridge
    ? bridge.info().then(applyStatus).catch((err) => console.error('[net] info() failed:', err))
    : Promise.resolve();

if (bridge) {
    bridge.onMessage((type, data) => dispatch(type, data));
    bridge.onStatus(applyStatus);
    bridge.onStats((stats) => dispatch('stats', stats));
}

export default net;
