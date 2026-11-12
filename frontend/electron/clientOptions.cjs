// frontend/electron/clientOptions.cjs
// What both client launchers share: command-line options, where the server is, and the per-second
// statistics CSV. Used by
//   web/agent.cjs     the web version (browser UI + local agent that owns the socket), and
//   electron/main.cjs the desktop version (Electron window that owns the socket).
// No networking here: the sockets are in tcpClient.cjs / udpClient.cjs.

const path = require('node:path');
const fs = require('node:fs');
const { DEFAULT_TCP_PORT, DEFAULT_UDP_PORT } = require('../../shared/protocol.cjs');

/** --name value, --name=value, or a bare --flag (= true). The last occurrence wins. */
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

/** frontend/server.json, if present (written by scripts/set-server.ps1 / set-server.sh). */
function readServerConfig() {
    const file = path.resolve(__dirname, '..', 'server.json');
    try {
        const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
        return cfg && typeof cfg === 'object' ? cfg : {};
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[client] ignoring ${file}: ${err.message}`);
        return {};
    }
}

/**
 * Where the game server is. Never hard-coded; the first value found wins:
 *   1. --server <ip> / --port <n>
 *   2. environment variables GAME_SERVER / GAME_PORT
 *   3. frontend/server.json {"server": "...", "tcpPort": 5000, "udpPort": 5001}
 *   4. 127.0.0.1 and the default port (one-PC testing)
 */
function resolveOptions(args) {
    const fileCfg = readServerConfig();
    const proto = String(args.proto || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const server = [args.server, process.env.GAME_SERVER, fileCfg.server]
        .find((v) => typeof v === 'string' && v.trim() !== '')?.trim() || '127.0.0.1';
    const port = Number(args.port) || Number(process.env.GAME_PORT)
        || Number(proto === 'tcp' ? fileCfg.tcpPort : fileCfg.udpPort)
        || (proto === 'tcp' ? DEFAULT_TCP_PORT : DEFAULT_UDP_PORT);
    const loss = proto === 'udp' ? Math.min(Math.max(Number(args.loss) || 0, 0), 0.9) : 0;
    if (proto === 'tcp' && Number(args.loss) > 0) {
        console.warn('[client] --loss only applies to the UDP version (TCP loss is repaired by the OS)');
    }
    return { proto, server, port, loss };
}

// ---------------------------------------------------------------------------------------------
// Statistics CSV: one line per second, for the TCP vs UDP comparison slides.
//   rttMs                   latest PING -> PONG round trip
//   msgsOutPerSec/InPerSec  messages (TCP lines / UDP datagrams) sent and received in the last second
//   msgsOut ... bytesIn     running totals
//   fastLost, lossPct       UDP only: position datagrams that never arrived (gaps in their counter),
//                           and that as a % of all position datagrams expected so far
//   retransmits ...         UDP only: what our reliability layer did
// ---------------------------------------------------------------------------------------------
const CSV_COLUMNS = ['time', 'proto', 'server', 'state', 'rttMs', 'msgsOutPerSec', 'msgsInPerSec',
    'msgsOut', 'msgsIn', 'bytesOut', 'bytesIn', 'fastLost', 'lossPct',
    'retransmits', 'duplicatesIgnored', 'outOfOrderBuffered', 'staleDropped', 'simulatedLoss'];
// Losses, retransmissions, duplicates and reordering exist in TCP too, but the OS handles them
// invisibly, so these columns stay empty for TCP (use Wireshark's TCP analysis to see them).
const UDP_ONLY = new Set(['fastLost', 'lossPct', 'retransmits', 'duplicatesIgnored', 'outOfOrderBuffered',
    'staleDropped', 'simulatedLoss']);

/** @returns {{file: string, write(stats: object): void}} */
function createCsvLogger({ proto, server, port, dir = process.cwd() }) {
    const file = path.join(dir, `netstats-${proto}-${process.pid}.csv`);
    return {
        file,
        write(rawStats) {
            const expected = (rawStats.fastReceived || 0) + (rawStats.fastLost || 0);
            const stats = {
                ...rawStats,
                server: `${server}:${port}`,
                msgsOutPerSec: rawStats.perSecond?.msgsOut,
                msgsInPerSec: rawStats.perSecond?.msgsIn,
                lossPct: expected > 0 ? ((100 * rawStats.fastLost) / expected).toFixed(2) : '0.00',
            };
            const values = CSV_COLUMNS.map((col) => {
                if (col === 'time') return new Date().toISOString();
                if (proto === 'tcp' && UDP_ONLY.has(col)) return '';
                const v = stats[col];
                return v === null || v === undefined ? '' : String(v);
            });
            const header = fs.existsSync(file) ? '' : CSV_COLUMNS.join(',') + '\n';
            fs.appendFile(file, header + values.join(',') + '\n', (err) => {
                if (err) console.warn(`[client] cannot write ${file}: ${err.message}`);
            });
        },
    };
}

module.exports = { parseArgs, resolveOptions, createCsvLogger };
