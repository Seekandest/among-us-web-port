// tools/package-client.cjs
// Builds a ready-to-run copy of the game CLIENT, so the other PCs need nothing installed
// (no Node.js, no npm, no project folder). Run it on the server PC:
//
//   node tools/package-client.cjs                        server address = this PC's LAN IP (auto)
//   node tools/package-client.cjs --server 100.101.102.103   e.g. this PC's Tailscale address
//
// Output:
//   release/AmongUsArena/              the app folder (AmongUsArena.exe + Electron runtime + our files)
//   release/AmongUsArena-win64.zip     the same folder zipped: this is what tools/share-client.cjs hands out
//
// How: it does what electron-packager does, by hand, with no extra dependency. An Electron app is
// the Electron runtime (frontend/node_modules/electron/dist) plus our files in resources/app/.
// Our files keep the same layout as in the repo (frontend/electron, frontend/dist, shared), so the
// relative require('../../shared/...') paths work unchanged. The server address goes into
// resources/app/frontend/server.json, which pre-fills the start screen (electron/launcher.html).
//
// This is a build tool, not part of the game protocol. It builds for the platform it runs on
// (Windows here: the Electron runtime installed by npm is the Windows one).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const ELECTRON_DIST = path.join(FRONTEND, 'node_modules', 'electron', 'dist');
const RELEASE = path.join(ROOT, 'release');
const APP_NAME = 'AmongUsArena';
const OUT = path.join(RELEASE, APP_NAME);
const ZIP = path.join(RELEASE, `${APP_NAME}-win64.zip`);
const { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT } = require(path.join(ROOT, 'shared', 'protocol.cjs'));

// ---- arguments (last occurrence wins) ----
const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else { args[a.slice(2)] = next; i++; }
}

/** This PC's addresses that other PCs can reach (no loopback, no 169.254 "no DHCP" address). */
function reachableAddresses() {
    const list = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
            const tailscale = a.address.startsWith('100.') || /tailscale/i.test(name);
            // Judge by adapter name: a real Wi-Fi can use 192.168.56.x too (it does on our server PC).
            const virtualBox = /virtualbox|vmware|vethernet|hyper-v|^ethernet 2$/i.test(name) && !/wi-?fi/i.test(name);
            list.push({ name, address: a.address, tailscale, virtualBox });
        }
    }
    // Best first: a real LAN card, then Tailscale, then virtual adapters (not reachable by others).
    const rank = (x) => (x.virtualBox ? 2 : x.tailscale ? 1 : 0);
    return list.sort((a, b) => rank(a) - rank(b));
}

function step(msg) { console.log(`\n> ${msg}`); }

function main() {
    if (process.platform !== 'win32') {
        console.error('This packager builds the Windows client and must run on Windows.');
        process.exit(1);
    }
    if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
        console.error('Electron is not installed: run "npm install" in the frontend folder first.');
        process.exit(1);
    }

    const addresses = reachableAddresses();
    const server = typeof args.server === 'string' ? args.server : addresses[0]?.address;
    if (!server) {
        console.error('Could not find a network address for this PC. Connect to the network, or pass --server <ip>.');
        process.exit(1);
    }

    step('Building the game UI (npm run build)');
    execSync('npm run build', { cwd: FRONTEND, stdio: 'inherit' });

    step(`Copying the Electron runtime to ${path.relative(ROOT, OUT)}`);
    fs.rmSync(RELEASE, { recursive: true, force: true });
    fs.cpSync(ELECTRON_DIST, OUT, { recursive: true });
    fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, `${APP_NAME}.exe`));
    fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true });   // Electron's demo app
    // Keep only the English translations of Chromium's own messages (saves ~40 MB).
    for (const f of fs.readdirSync(path.join(OUT, 'locales'))) {
        if (f !== 'en-US.pak') fs.rmSync(path.join(OUT, 'locales', f));
    }

    step('Copying our files to resources/app (same layout as the repo)');
    const app = path.join(OUT, 'resources', 'app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
        name: 'among-us-arena',
        version: '1.0.0',
        main: 'frontend/electron/main.cjs',
    }, null, 2));
    fs.cpSync(path.join(FRONTEND, 'electron'), path.join(app, 'frontend', 'electron'), { recursive: true });
    fs.cpSync(path.join(FRONTEND, 'dist'), path.join(app, 'frontend', 'dist'), { recursive: true });
    fs.mkdirSync(path.join(app, 'shared'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'shared'))) {
        if (f.endsWith('.cjs')) fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(app, 'shared', f));
    }
    // The server address the start screen proposes (the player can still change it).
    fs.writeFileSync(path.join(app, 'frontend', 'server.json'), JSON.stringify({
        server, tcpPort: DEFAULT_TCP_PORT, udpPort: DEFAULT_UDP_PORT,
    }, null, 2));
    fs.writeFileSync(path.join(OUT, 'HOW-TO-PLAY.txt'), [
        'Among Us Arena - client',
        '',
        `1. Double-click ${APP_NAME}.exe`,
        '   (if Windows says "Windows protected your PC": More info > Run anyway)',
        '2. Choose the TCP version or the UDP version (the server must run the same one).',
        `3. Server address: ${server} (pre-filled), then Connect.`,
        '',
        'Network statistics are written next to the .exe (netstats-tcp-*.csv / netstats-udp-*.csv).',
        '',
    ].join('\r\n'));

    step(`Zipping to ${path.relative(ROOT, ZIP)}`);
    // Windows 10+ ships bsdtar as C:\Windows\System32\tar.exe; "-a" picks the format from ".zip".
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-a', '-c', '-f', ZIP, '-C', RELEASE, APP_NAME], { stdio: 'inherit' });

    const mb = (fs.statSync(ZIP).size / 1024 / 1024).toFixed(0);
    console.log(`\nDone: ${path.relative(ROOT, ZIP)} (${mb} MB), server address inside: ${server}`);
    if (addresses.length > 1 && typeof args.server !== 'string') {
        console.log('Other addresses of this PC (use --server <ip> to pick one):');
        for (const a of addresses) console.log(`   ${a.address.padEnd(16)} ${a.name}${a.virtualBox ? '  (virtual, not reachable by other PCs)' : ''}`);
    }
    console.log('Next: node tools/share-client.cjs   (download page for the other PCs)');
}

main();
