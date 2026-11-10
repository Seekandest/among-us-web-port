// frontend/electron/preload.cjs
// The ONLY bridge between the web page and the network code.
//
// The page runs with contextIsolation + sandbox: it has no require(), no 'net', no 'dgram'.
// This preload script runs before the page and exposes a tiny API as window.gameNet. Each call
// becomes an Electron IPC message to the main process (electron/main.cjs), which owns the real
// TCP or UDP socket. IPC is communication INSIDE the computer, between two processes of the same
// app; it never appears on the network.
//
//   page:  window.gameNet.send('room:join', {roomId})
//     -> IPC 'net:send'  -> main.cjs -> tcpClient / udpClient -> socket -> server
//   server -> socket -> main.cjs -> IPC 'net:message' -> page: onMessage(type, data)

const { contextBridge, ipcRenderer } = require('electron');

/** Listen to an IPC channel from the main process; returns a function that stops listening. */
function subscribe(channel, onPayload) {
    const handler = (_event, payload) => onPayload(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('gameNet', {
    /** Send one game message to the server. */
    send: (type, data) => ipcRenderer.send('net:send', { type, data }),

    /** Every game message from the server: callback(type, data). */
    onMessage: (callback) => subscribe('net:message', (m) => callback(m.type, m.data)),

    /** Connection changes: callback({state, sessionId, reason, proto, server, port, local}). */
    onStatus: (callback) => subscribe('net:status', callback),

    /** Network statistics, once per second (RTT, messages/bytes, retransmissions...). */
    onStats: (callback) => subscribe('net:stats', callback),

    /** Current connection status (a Promise). Used when the page loads or reloads. */
    info: () => ipcRenderer.invoke('net:info'),
});
