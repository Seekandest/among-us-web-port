// src/services/net.js
// The page's ONLY access to the network.
//
// A web page (and this React + Phaser UI is one) cannot open raw TCP or UDP sockets: browsers only
// offer HTTP, WebSocket and WebRTC. So the real socket lives in Electron's MAIN process
// (electron/tcpClient.cjs or electron/udpClient.cjs). This file does not do any networking itself:
// it only talks to the main process through window.gameNet (electron/preload.cjs), which is
// Electron IPC, a channel between two processes on the same computer.
//
//   net.emit('room:join', {roomId})  -> IPC -> main process -> TCP segment / UDP datagram -> server
//   server -> socket -> main process -> IPC -> net.on('room:joined', handler)
//
// Because the socket belongs to the main process, the connection survives a page reload; on load
// we ask the main process for the current state with window.gameNet.info().
//
// Special local events (never sent by the server):
//   'connect'    (status)  the transport became connected
//   'disconnect' (reason)  the transport lost the server (closed, reset, timeout...)
//   'status'     (status)  any change: {state, sessionId, reason, proto, server, port, local}
//   'stats'      (stats)   once per second: RTT, messages/bytes per second, retransmissions...

const bridge = typeof window !== 'undefined' ? window.gameNet : undefined;

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
    /** false when the page is opened in a normal browser instead of the Electron app */
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
            console.warn(`[net] not running inside the Electron app, "${type}" not sent`);
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
