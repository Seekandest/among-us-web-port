// frontend/electron/main.cjs
// Electron MAIN process: the desktop shell around the React + Phaser game.
//
// Why Electron at all? A web page (even a local one) is not allowed to open raw TCP or UDP sockets;
// browsers only offer HTTP / WebSocket / WebRTC, which would hide the transport we are graded on.
// Electron's main process is a full Node.js program, so it can use 'net' (TCP) and 'dgram' (UDP).
//
//   +--------------------- one PC ----------------------+
//   |  Renderer (the React + Phaser page, no Node)       |
//   |        |  window.gameNet  (preload.cjs)            |
//   |        |  Electron IPC: inside the computer,       |
//   |        v  NOT a network socket                     |
//   |  Main process (this file)                          |
//   |        tcpClient.cjs  ->  net.Socket   --TCP-->  --+--> game server :5000
//   |   or   udpClient.cjs  ->  dgram.Socket --UDP-->  --+--> game server :5001
//   +----------------------------------------------------+
// So in Wireshark the ONLY game traffic leaving the PC is our TCP segments (TCP version) or our UDP
// datagrams (UDP version). The page itself is read from disk (frontend/dist), not downloaded.
//
// Usage (the last occurrence of a flag wins, so "npm run tcp -- --server 192.168.1.20" works):
//   electron electron/main.cjs --proto tcp|udp --server <ip> --port <n> [--loss 0.1] [--dev]

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const electron = require('electron');

// ---------------------------------------------------------------------------------------------
// When ELECTRON_RUN_AS_NODE=1 is set (VS Code sets it for the processes it starts), the Electron
// binary behaves like plain Node and require('electron') is just the path of the binary. Start
// ourselves again as a real Electron app, without that variable. (Not network related.)
// ---------------------------------------------------------------------------------------------
if (typeof electron === 'string') {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = require('node:child_process').spawn(electron, process.argv.slice(1), { stdio: 'inherit', env });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
}

const { app, BrowserWindow, ipcMain, protocol, net: electronNet } = electron;
const { createTcpClient } = require('./tcpClient.cjs');
const { createUdpClient } = require('./udpClient.cjs');
const { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT } = require('../../shared/protocol.cjs');

// ---------------------------------------------------------------------------------------------
// 1. Command-line arguments (last occurrence wins). Accepts "--port 5000" and "--port=5000".
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq !== -1) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { args[a.slice(2)] = true; continue; }
        args[a.slice(2)] = next;
        i++;
    }
    return args;
}

const args = parseArgs(process.argv.slice(1));
const PROTO = String(args.proto || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
const SERVER = typeof args.server === 'string' ? args.server : '127.0.0.1';
const PORT = Number(args.port) || (PROTO === 'tcp' ? DEFAULT_TCP_PORT : DEFAULT_UDP_PORT);
const LOSS = PROTO === 'udp' ? Math.min(Math.max(Number(args.loss) || 0, 0), 0.9) : 0;
const DEV = args.dev === true || args.dev === 'true';
if (PROTO === 'tcp' && Number(args.loss) > 0) {
    console.warn('[client] --loss only applies to the UDP version (TCP loss is repaired by the OS)');
}

const DIST = path.resolve(__dirname, '..', 'dist');
const CSV_FILE = path.join(process.cwd(), `netstats-${PROTO}-${process.pid}.csv`);

// Each window gets its own Chromium profile folder, so 3 clients can run on the same PC
// (otherwise the 2nd instance would fight over the profile lock / share sessionStorage).
app.setPath('userData', path.join(app.getPath('temp'), `among-us-client-${process.pid}`));

// ---------------------------------------------------------------------------------------------
// 2. Serving the UI from disk.
// The built page uses absolute paths like "/assets/logo.png". With loadFile (file://) those would
// point to the root of the hard drive, so we register our own "app://" scheme instead.
// THIS IS NOT NETWORKING: app://game/assets/logo.png is answered by reading
// frontend/dist/assets/logo.png from the local disk. Nothing leaves the computer.
// ---------------------------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function serveFromDist(request) {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.join(DIST, relative);
    // Refuse anything that would escape the dist folder (e.g. app://game/../../secret.txt).
    const inside = path.relative(DIST, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
        return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        const hint = fs.existsSync(path.join(DIST, 'index.html'))
            ? `Not found: ${relative}`
            : 'The UI is not built yet. Run "npm run build" in the frontend folder, then start again.';
        return new Response(hint, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    // electronNet.fetch with a file:// URL = read a local file (same as the browser loading a file).
    return electronNet.fetch(pathToFileURL(file).toString());
}

// ---------------------------------------------------------------------------------------------
// 3. Window, network client, IPC bridge.
// ---------------------------------------------------------------------------------------------
let win = null;
let client = null;
let quitting = false;

function titleFor(status) {
    const arrow = `${PROTO.toUpperCase()} → ${SERVER}:${PORT}`;
    const loss = LOSS > 0 ? ` (loss ${Math.round(LOSS * 100)}%)` : '';
    return `Among Us Arena — ${arrow}${loss} — ${status.state}`;
}

/** Send to the page, if it is there (the page may be reloading or the window closing). */
function toRenderer(channel, payload) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
    win = new BrowserWindow({
        width: 1100,
        height: 850,
        backgroundColor: '#000000',
        title: titleFor({ state: 'connecting' }),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,   // the page cannot touch Node or Electron internals...
            nodeIntegration: false,   // ...and has no require(): its ONLY door is window.gameNet
            sandbox: true,
            // Keep the game loop running when the window is behind another one (3 clients on one
            // PC): otherwise Chromium slows it down and our position updates (20/s) would stall.
            // The heartbeat is not affected either way: it runs here, in the main process.
            backgroundThrottling: false,
        },
    });
    // Keep OUR title (protocol, server, state) instead of the page's <title>.
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('closed', () => { win = null; });

    if (DEV) win.loadURL('http://localhost:8080'); // --dev only: the Vite dev server on this PC
    else win.loadURL('app://game/index.html');
}

function startNetworkClient() {
    const create = PROTO === 'tcp' ? createTcpClient : createUdpClient;
    client = create({
        host: SERVER,
        port: PORT,
        loss: LOSS,
        // A complete game message arrived from the server -> hand it to the page.
        onMessage: (type, data) => toRenderer('net:message', { type, data }),
        // connecting / connected / disconnected -> page + window title + console.
        onStatus: (status) => {
            if (status.state === 'connected') {
                console.log(`[client] ${PROTO.toUpperCase()} connected: local ${status.local} -> remote ${SERVER}:${PORT} (session ${status.sessionId})`);
            } else if (status.state === 'disconnected') {
                console.log(`[client] ${PROTO.toUpperCase()} disconnected: ${status.reason}`);
            }
            if (win && !win.isDestroyed()) win.setTitle(titleFor(status));
            toRenderer('net:status', status);
        },
    });
}

// The page asks to send a message (window.gameNet.send). Only strings as type: it is still input.
ipcMain.on('net:send', (_event, msg) => {
    if (!client || !msg || typeof msg.type !== 'string') return;
    client.send(msg.type, msg.data === undefined ? {} : msg.data);
});

// The page (re)loaded and wants to know the current connection state. The connection lives here,
// in the main process, so it survives a page reload.
ipcMain.handle('net:info', () => (client ? client.status() : null));

// ---------------------------------------------------------------------------------------------
// 4. Statistics every second: to the page (network HUD) and to a CSV file (comparison slides).
// ---------------------------------------------------------------------------------------------
const CSV_COLUMNS = ['time', 'proto', 'state', 'rttMs', 'msgsOut', 'msgsIn', 'bytesOut', 'bytesIn',
    'retransmits', 'duplicatesIgnored', 'outOfOrderBuffered', 'staleDropped', 'simulatedLoss'];
// Retransmissions, duplicates and reordering exist in TCP too, but the OS handles them invisibly,
// so these columns stay empty for TCP (use Wireshark's TCP analysis to see them).
const UDP_ONLY = new Set(['retransmits', 'duplicatesIgnored', 'outOfOrderBuffered', 'staleDropped', 'simulatedLoss']);

function writeCsvLine(stats) {
    const values = CSV_COLUMNS.map((col) => {
        if (col === 'time') return new Date().toISOString();
        if (PROTO === 'tcp' && UDP_ONLY.has(col)) return '';
        const v = stats[col];
        return v === null || v === undefined ? '' : String(v);
    });
    const header = fs.existsSync(CSV_FILE) ? '' : CSV_COLUMNS.join(',') + '\n';
    fs.appendFile(CSV_FILE, header + values.join(',') + '\n', (err) => {
        if (err) console.warn(`[client] cannot write ${CSV_FILE}: ${err.message}`);
    });
}

setInterval(() => {
    if (!client) return;
    const stats = client.stats();
    toRenderer('net:stats', { ...stats, server: SERVER, port: PORT });
    writeCsvLine(stats);
}, 1000);

// ---------------------------------------------------------------------------------------------
// 5. Start and stop.
// ---------------------------------------------------------------------------------------------
app.whenReady().then(() => {
    protocol.handle('app', serveFromDist);
    if (!DEV && !fs.existsSync(path.join(DIST, 'index.html'))) {
        console.error('[client] frontend/dist is missing: run "npm run build" first');
    }
    console.log(`[client] ${PROTO.toUpperCase()} client -> ${SERVER}:${PORT}` +
        (LOSS ? `, simulated loss ${LOSS * 100}%` : '') + `, stats in ${CSV_FILE}`);
    createWindow();
    startNetworkClient();
});

// Closing the window = leaving the game cleanly: TCP sends FIN, UDP sends BYE, so the server sees
// it at once instead of waiting for the 5 s timeout. Wait ~100 ms so those packets actually go out.
function shutdown() {
    if (quitting) return;
    quitting = true;
    if (client) client.close();
    setTimeout(() => app.quit(), 100);
}
app.on('window-all-closed', shutdown);
process.on('SIGINT', shutdown);   // Ctrl+C in the terminal
process.on('SIGTERM', shutdown);
