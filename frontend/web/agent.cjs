// frontend/web/agent.cjs
// WEB version of the client: the game runs in a normal browser tab, and this small local Node
// program owns the real network socket.
//
// Why a local program at all? A web page is not allowed to open raw TCP or UDP sockets: browsers only
// offer HTTP, WebSocket and WebRTC, which would hide the transport we are graded on (and the UDP
// version must use no TCP at all). So, on each player's computer:
//
//   +------------------------------- one PC -------------------------------------+
//   |  Browser tab: React + Phaser game (frontend/dist)                            |
//   |        |  HTTP on 127.0.0.1 only (loopback: never leaves this computer)       |
//   |        v                                                                     |
//   |  This agent (Node.js)                                                        |
//   |        tcpClient.cjs  ->  net.Socket   ---- TCP 5000 ---->  game server        |
//   |   or   udpClient.cjs  ->  dgram.Socket ---- UDP 5001 ---->  game server        |
//   +------------------------------------------------------------------------------+
//
// Between computers there is ONLY our raw TCP (TCP version) or raw UDP (UDP version) traffic, exactly
// like the desktop (Electron) version: the agent uses the very same tcpClient.cjs / udpClient.cjs.
// The loopback hop to the browser is local IPC that happens to use HTTP; Wireshark on the network
// interface never sees it.
//
// Browser <-> agent (loopback, built-in 'http' module, no library):
//   GET  /                the game UI, read from frontend/dist
//   GET  /net/events      Server-Sent Events: the agent pushes "msg", "status" and "stats" events
//   POST /net/send        the page sends game messages: JSON array of {type, data}, in order
//   GET  /net/info        current connection status (JSON)
//
// Usage (the last occurrence of a flag wins):
//   node web/agent.cjs --proto tcp|udp [--server <ip>] [--port <n>] [--loss 0.1]
//                      [--web-port 8080] [--no-open] [--keep-alive]
// Closing the game tab ends the agent after 5 s (= leaving the game), unless --keep-alive is given.
// The server address follows the same rules as the desktop client (clientOptions.cjs):
// --server, else GAME_SERVER, else frontend/server.json, else 127.0.0.1.
// If --web-port is busy (another client on the same PC), the next free port is used: 8081, 8082...

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createTcpClient } = require('../electron/tcpClient.cjs');
const { createUdpClient } = require('../electron/udpClient.cjs');
const { parseArgs, resolveOptions, createCsvLogger } = require('../electron/clientOptions.cjs');

const args = parseArgs(process.argv.slice(2));
const { proto: PROTO, server: SERVER, port: PORT, loss: LOSS } = resolveOptions(args);
const FIRST_WEB_PORT = Number(args['web-port']) || Number(process.env.WEB_PORT) || 8080;
const OPEN_BROWSER = !args['no-open'];
const DIST = path.resolve(__dirname, '..', 'dist');
const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
};

// ---------------------------------------------------------------------------------------------
// 1. The real network client (same modules as the desktop version).
// ---------------------------------------------------------------------------------------------
/** Browser tabs currently listening on /net/events. */
const tabs = new Set();
let webPort = null;
let lastTabTimer = null;
const TAB_CLOSE_GRACE_MS = 5000;

/** Push one Server-Sent Event to every open tab. */
function toTabs(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of tabs) res.write(frame);
}

function titleOf(status) {
    return `${PROTO.toUpperCase()} -> ${SERVER}:${PORT} - ${status.state}${status.reason ? ` (${status.reason})` : ''}`;
}

const create = PROTO === 'tcp' ? createTcpClient : createUdpClient;
const client = create({
    host: SERVER,
    port: PORT,
    loss: LOSS,
    // A complete game message arrived from the server -> hand it to the page.
    onMessage: (type, data) => toTabs('msg', { type, data }),
    // connecting / connected / disconnected -> page + console.
    onStatus: (status) => {
        console.log(`[agent] ${titleOf(status)}`);
        toTabs('status', status);
    },
});

// Statistics every second: to the page (network HUD) and to the CSV file (comparison slides).
const csv = createCsvLogger({ proto: PROTO, server: SERVER, port: PORT });
setInterval(() => {
    const stats = client.stats();
    toTabs('stats', { ...stats, server: SERVER, port: PORT });
    csv.write(stats);
}, 1000);

// ---------------------------------------------------------------------------------------------
// 2. The local web server (127.0.0.1 only).
// ---------------------------------------------------------------------------------------------

/**
 * Only answer pages loaded from this agent. Binding to 127.0.0.1 already keeps other computers out;
 * checking Host/Origin also stops a random website open in the same browser from driving the game
 * through this port (DNS rebinding / cross-site POST).
 */
function isLocalRequest(req) {
    const allowed = new Set([`127.0.0.1:${webPort}`, `localhost:${webPort}`]);
    if (!allowed.has(req.headers.host)) return false;
    const origin = req.headers.origin;
    return !origin || allowed.has(origin.replace(/^https?:\/\//, ''));
}

function serveStatic(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.join(DIST, relative);
    // Refuse anything that would escape the dist folder (e.g. /../../secret.txt).
    const inside = path.relative(DIST, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
            const built = fs.existsSync(path.join(DIST, 'index.html'));
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(built ? `Not found: ${relative}`
                : 'The UI is not built yet. Run "npm run build" in the frontend folder, then start again.');
            return;
        }
        res.writeHead(200, {
            'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'content-length': st.size,
            'cache-control': 'no-cache',
        });
        fs.createReadStream(file).pipe(res);
    });
}

function openEvents(req, res) {
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    // If the agent restarts, the browser reconnects after 1 s by itself.
    res.write('retry: 1000\n\n');
    res.write(`event: status\ndata: ${JSON.stringify(client.status())}\n\n`);
    tabs.add(res);
    clearTimeout(lastTabTimer);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => {
        clearInterval(keepAlive);
        tabs.delete(res);
        // Closing the game tab = leaving the game (like closing the desktop window). Wait a little
        // first: a page reload closes the stream and opens a new one within a second.
        if (tabs.size === 0 && !args['keep-alive']) {
            lastTabTimer = setTimeout(() => {
                console.log(`[agent] game tab closed, leaving the game`);
                shutdown();
            }, TAB_CLOSE_GRACE_MS);
        }
    });
}

function receiveMessages(req, res) {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            res.writeHead(413).end();
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (res.writableEnded) return;
        let messages;
        try {
            messages = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            res.writeHead(400).end('Bad JSON');
            return;
        }
        if (!Array.isArray(messages)) messages = [messages];
        // In the order the page sent them: the transport keeps that order on the wire
        // (TCP stream / our reliable UDP channel).
        for (const msg of messages) {
            if (msg && typeof msg.type === 'string') client.send(msg.type, msg.data === undefined ? {} : msg.data);
        }
        res.writeHead(204).end();
    });
}

const web = http.createServer((req, res) => {
    if (!isLocalRequest(req)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/net/events' && req.method === 'GET') return openEvents(req, res);
    if (pathname === '/net/send' && req.method === 'POST') return receiveMessages(req, res);
    if (pathname === '/net/info' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(client.status()));
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405).end();
});

function openBrowser(url) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
        : process.platform === 'darwin' ? ['open', [url]]
            : ['xdg-open', [url]];
    try {
        spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
    } catch {
        // No browser launcher: the URL is printed anyway.
    }
}

/** Listen on FIRST_WEB_PORT, or the next free one (several clients on one PC). */
function listen(portToTry, attemptsLeft) {
    // One 'error' and one 'listening' handler per attempt, each removing the other: otherwise a
    // failed attempt's handler would also fire when a later attempt succeeds.
    const onError = (err) => {
        web.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) return listen(portToTry + 1, attemptsLeft - 1);
        console.error(`[agent] cannot open the local web port: ${err.message}`);
        process.exit(1);
    };
    const onListening = () => {
        web.off('error', onError);
        webPort = portToTry;
        const url = `http://localhost:${webPort}/`;
        if (!fs.existsSync(path.join(DIST, 'index.html'))) {
            console.error('[agent] frontend/dist is missing: run "npm run build" in the frontend folder first');
        }
        console.log(`[agent] ${PROTO.toUpperCase()} client -> ${SERVER}:${PORT}` +
            (LOSS ? `, simulated loss ${LOSS * 100}%` : '') + `, stats in ${csv.file}`);
        console.log(`[agent] open the game at ${url}  (one tab per agent; Ctrl+C to quit)`);
        if (OPEN_BROWSER) openBrowser(url);
    };
    web.once('error', onError);
    web.once('listening', onListening);
    web.listen(portToTry, '127.0.0.1');
}
listen(FIRST_WEB_PORT, 20);

// ---------------------------------------------------------------------------------------------
// 3. Stop: leaving cleanly sends TCP FIN / UDP BYE, so the server sees it at once.
// ---------------------------------------------------------------------------------------------
let quitting = false;
function shutdown() {
    if (quitting) return;
    quitting = true;
    client.close();
    for (const res of tabs) res.end();
    web.close();
    setTimeout(() => process.exit(0), 150); // let the FIN / BYE leave the computer
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
