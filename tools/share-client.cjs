// tools/share-client.cjs
// Download page for the other PCs: http://<this PC's IP>:8000
// It hands out release/AmongUsArena-win64.zip (made by tools/package-client.cjs).
//
//   node tools/share-client.cjs [--port 8000]
//
// NOT part of the game: plain HTTP, only to copy the game files before playing. The game itself
// still talks raw TCP (port 5000) or UDP (port 5001). Stop this (Ctrl+C) before Wireshark captures.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ZIP = path.join(__dirname, '..', 'release', 'AmongUsArena-win64.zip');
const i = process.argv.indexOf('--port');
const PORT = Number(i !== -1 && process.argv[i + 1]) || 8000;

if (!fs.existsSync(ZIP)) {
    console.error('No release/AmongUsArena-win64.zip yet: run "node tools/package-client.cjs" first.');
    process.exit(1);
}

const ips = Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map(a => a.address);
const sizeMb = (fs.statSync(ZIP).size / 1048576).toFixed(0);

const page = () => `<!doctype html><html><head><meta charset="utf-8"><title>Among Us Arena</title>
<style>body{font:16px/1.6 Segoe UI,sans-serif;background:#0b1430;color:#e8ecf5;display:grid;place-items:center;min-height:100vh;margin:0}
.c{max-width:560px;background:#131d3f;padding:30px;border-radius:14px}a.b{display:block;text-align:center;background:#e94560;color:#fff;
padding:14px;border-radius:10px;font-size:19px;text-decoration:none;margin:18px 0}code{background:#070d22;padding:2px 6px;border-radius:4px}</style></head>
<body><div class="c"><h1>Among Us Arena</h1>
<a class="b" href="/download">Download the game for Windows (${sizeMb} MB)</a>
<ol><li>Unzip <code>AmongUsArena-win64.zip</code> (right-click &gt; Extract All).</li>
<li>Double-click <code>AmongUsArena.exe</code> (if Windows warns: More info &gt; Run anyway).</li>
<li>Choose <b>TCP</b> or <b>UDP</b> (same as the server), keep the pre-filled server address, Connect.</li></ol>
<p>Server address: ${ips.map(ip => `<code>${ip}</code>`).join(' ')}<br>Game ports: TCP 5000, UDP 5001.</p></div></body></html>`;

http.createServer((req, res) => {
    if (req.url === '/download') {
        console.log(`[share] download by ${req.socket.remoteAddress}`);
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': fs.statSync(ZIP).size,
            'Content-Disposition': 'attachment; filename="AmongUsArena-win64.zip"',
        });
        fs.createReadStream(ZIP).pipe(res);
    } else if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page());
    } else {
        res.writeHead(404).end();
    }
}).listen(PORT, '0.0.0.0', () => {
    console.log('Download page for the other PCs (open it in their browser):');
    for (const ip of ips) console.log(`   http://${ip}:${PORT}`);
});
