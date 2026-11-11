// tools/smoke-client.cjs
// End-to-end test of the REAL server with the REAL client transports (frontend/electron/*Client.cjs).
// No UI: 3 headless clients play a full game, then we break the network on purpose.
//
//   node tools/smoke-client.cjs --proto tcp
//   node tools/smoke-client.cjs --proto udp
//   node tools/smoke-client.cjs --proto udp --loss 0.2     (20% loss on the server AND on every client)
//
// What is tested:
//   1. a client started BEFORE the server keeps retrying, then connects (TCP: ECONNREFUSED, UDP: HELLO loop)
//   2. register / create / join x2 / start / moves at 20 Hz / kill (cooldown, range) / meeting / votes /
//      game:ended with ranking / play again
//   3. CRASH: a client process is killed (SIGKILL). TCP: the OS closes the socket (FIN/RST), seen at once.
//      UDP: nothing is sent, seen by the 5 s heartbeat timeout.
//   4. CABLE PULL: a relay between one client and the server silently drops everything (no FIN, no RST,
//      no BYE). Both sides must notice through the heartbeat alone (~5 s), then reconnect when the
//      "cable" is plugged back.
//   5. CLEAN QUIT: close() sends FIN (TCP) or BYE (UDP), seen at once by the server.

const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const { spawn, fork } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { createTcpClient } = require(path.join(ROOT, 'frontend/electron/tcpClient.cjs'));
const { createUdpClient } = require(path.join(ROOT, 'frontend/electron/udpClient.cjs'));

// ---- arguments (last occurrence wins) ----
const args = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (!a.startsWith('--')) continue;
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else { args[a.slice(2)] = next; i++; }
}
const PROTO = args.proto === 'udp' ? 'udp' : 'tcp';
const LOSS = Number(args.loss) || 0;
const PORT = Number(args.port) || (PROTO === 'tcp' ? 5200 : 5201);
const createClient = PROTO === 'tcp' ? createTcpClient : createUdpClient;
const SPAWN = { x: 560, y: 150 };
// The UDP handshake needs HELLO and WELCOME to both survive (0.8^4 = 41% per try at 20% loss on each
// side), one try per second, so give it more time when loss is simulated.
const CONNECT_TIMEOUT = LOSS > 0 ? 20000 : 6000;

// =================================================================================================
// CHILD MODE: one client in its own process, so the parent can kill it like a crash.
// =================================================================================================
if (args.child) {
    const client = createClient({
        host: '127.0.0.1', port: PORT, loss: LOSS,
        onMessage: (type, data) => process.send({ kind: 'msg', type, data }),
        onStatus: (status) => process.send({ kind: 'status', status }),
    });
    process.on('message', (m) => { if (m.send) client.send(m.send[0], m.send[1]); });
    process.on('disconnect', () => process.exit(0));
    return;
}

// =================================================================================================
// Helpers
// =================================================================================================
let passed = 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t = () => ((Date.now() - START) / 1000).toFixed(1).padStart(5);
const START = Date.now();
function log(...m) { console.log(`[${t()}s]`, ...m); }
function ok(cond, what, detail = '') {
    if (!cond) throw new Error(`FAIL: ${what} ${detail}`);
    passed++;
    log(`  ok  ${what}${detail ? '  (' + detail + ')' : ''}`);
}

/** Common wrapper: inbox of received messages + promises that wait for a type or a status. */
function wrap(name) {
    const c = { name, inbox: [], waiters: [], statuses: [], pos: { ...SPAWN, d: 'left', moving: false } };
    c.deliver = (type, data) => {
        const i = c.waiters.findIndex(w => w.type === type && w.where(data));
        if (i !== -1) return c.waiters.splice(i, 1)[0].resolve(data);
        c.inbox.push({ type, data });
    };
    c.onStatus = (s) => {
        c.lastStatus = s;
        c.statuses.push(s);
        const i = c.waiters.findIndex(w => w.type === '#status' && w.where(s));
        if (i !== -1) c.waiters.splice(i, 1)[0].resolve(s);
    };
    c.wait = (type, { timeout = 8000, where = () => true } = {}) => {
        const i = c.inbox.findIndex(m => m.type === type && where(m.data));
        if (i !== -1) return Promise.resolve(c.inbox.splice(i, 1)[0].data);
        return new Promise((resolve, reject) => {
            const w = { type, where, resolve };
            c.waiters.push(w);
            setTimeout(() => {
                const k = c.waiters.indexOf(w);
                if (k !== -1) { c.waiters.splice(k, 1); reject(new Error(`${name}: no "${type}" after ${timeout} ms`)); }
            }, timeout);
        });
    };
    c.waitStatus = (state, opts = {}) => {
        if (c.lastStatus && c.lastStatus.state === state && !opts.fresh) return Promise.resolve(c.lastStatus);
        return c.wait('#status', { ...opts, where: s => s.state === state && (!opts.where || opts.where(s)) });
    };
    /** Forget old messages of this type, do the action, wait for the answer. */
    c.expect = (type, action, opts) => {
        c.inbox = c.inbox.filter(m => m.type !== type);
        const p = c.wait(type, opts);
        action();
        return p;
    };
    return c;
}

function makeClient(name, port = PORT) {
    const c = wrap(name);
    const client = createClient({ host: '127.0.0.1', port, loss: LOSS, onMessage: c.deliver, onStatus: c.onStatus });
    c.send = client.send;
    c.close = client.close;
    c.stats = client.stats;
    return c;
}

function makeChildClient(name) {
    const c = wrap(name);
    const child = fork(__filename, ['--child', '--proto', PROTO, '--port', String(PORT), '--loss', String(LOSS)],
        { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    child.on('message', (m) => (m.kind === 'msg' ? c.deliver(m.type, m.data) : c.onStatus(m.status)));
    c.send = (type, data) => child.send({ send: [type, data] });
    c.crash = () => child.kill('SIGKILL');
    c.close = () => child.kill();
    c.stats = () => ({});
    return c;
}

function startServer() {
    const accountsFile = path.join(os.tmpdir(), `among-us-accounts-${PORT}.json`);
    try { fs.unlinkSync(accountsFile); } catch { /* none yet */ }
    const child = spawn(process.execPath,
        [path.join(ROOT, 'backend/src/main.js'), '--proto', PROTO, '--port', String(PORT), '--loss', String(LOSS)],
        { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ACCOUNTS_FILE: accountsFile } });
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.output = () => output;
    return new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            if (output.includes('listening on')) { clearInterval(timer); resolve(child); }
        }, 50);
        child.on('exit', (code) => { clearInterval(timer); reject(new Error('server exited ' + code + '\n' + output)); });
    });
}

/**
 * A "network cable" between one client and the server. blackhole(true) = cable pulled:
 * every byte / datagram is silently dropped, nothing is closed, nothing tells either side.
 */
function startRelay() {
    let black = false;
    return new Promise((resolve) => {
        if (PROTO === 'tcp') {
            const sockets = new Set();
            const server = net.createServer((client) => {
                const upstream = net.connect(PORT, '127.0.0.1');
                sockets.add(client); sockets.add(upstream);
                client.on('data', d => { if (!black) upstream.write(d); });
                upstream.on('data', d => { if (!black) client.write(d); });
                // While the cable is pulled, a close on one side cannot reach the other side either.
                const closeOther = (other) => () => { if (!black) other.destroy(); };
                client.on('close', closeOther(upstream));
                upstream.on('close', closeOther(client));
                client.on('error', () => {});
                upstream.on('error', () => {});
            });
            server.listen(0, '127.0.0.1', () => resolve({
                port: server.address().port,
                blackhole: (v) => { black = v; },
                close: () => { server.close(); sockets.forEach(s => s.destroy()); },
            }));
        } else {
            const front = dgram.createSocket('udp4');   // the client talks to this one
            const back = dgram.createSocket('udp4');    // this one talks to the server
            let clientAddr = null;
            front.on('message', (m, r) => { clientAddr = r; if (!black) back.send(m, PORT, '127.0.0.1'); });
            back.on('message', (m) => { if (!black && clientAddr) front.send(m, clientAddr.port, clientAddr.address); });
            back.bind(0, () => front.bind(0, '127.0.0.1', () => resolve({
                port: front.address().port,
                blackhole: (v) => { black = v; },
                close: () => { front.close(); back.close(); },
            })));
        }
    });
}

// Walk one step at a time. A single jump would be rejected: the server allows
// about 100 px/s in a game (115 px/s with tolerance), and these steps are 4 px.
function stepToward(c, x, y) {
    const dx = x - c.pos.x;
    const dy = y - c.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 4) {
        c.pos.x = x;
        c.pos.y = y;
        return true;
    }
    const nx = Math.round(c.pos.x + (dx / dist) * 4);
    const ny = Math.round(c.pos.y + (dy / dist) * 4);
    if (Math.hypot(x - nx, y - ny) >= dist) {
        c.pos.x = x;
        c.pos.y = y;
        return true;
    }
    c.pos.x = nx;
    c.pos.y = ny;
    c.pos.d = dx < 0 ? 'left' : 'right';
    return false;
}

async function walkTo(c, x, y) {
    c.pos.moving = true;
    let guard = 0;
    while (!stepToward(c, x, y)) {
        if (++guard > 500) throw new Error(`${c.name} did not reach ${x},${y}`);
        await sleep(60);
    }
    c.pos.moving = false;
    await sleep(150);
}

// Every client sends its position at 20 Hz, like the real game while moving.
function startMovers(clients) {
    const timer = setInterval(() => {
        for (const c of clients) if (!c.stopped) c.send('player:move', c.pos);
    }, 50);
    return () => clearInterval(timer);
}

// =================================================================================================
// The test
// =================================================================================================
(async () => {
    let server = null;
    let stopMovers = () => {};
    const all = [];
    let relay = null;
    console.log(`\n=== smoke test: ${PROTO.toUpperCase()}, port ${PORT}, simulated loss ${LOSS * 100}% (server + clients) ===\n`);
    try {
        // ---- 1. client before server ------------------------------------------------------------
        log('1. client started before the server');
        const alice = makeClient('Alice');
        all.push(alice);
        if (PROTO === 'tcp') {
            const s = await alice.waitStatus('disconnected', { timeout: 3000 });
            ok(/ECONNREFUSED/.test(s.reason), 'TCP: no server -> disconnected', s.reason);
        } else {
            await sleep(1500);
            ok(alice.lastStatus.state !== 'connected', 'UDP: no server -> still sending HELLO', `state ${alice.lastStatus.state}`);
        }
        server = await startServer();
        log('   server started');
        const sa = await alice.waitStatus('connected', { timeout: CONNECT_TIMEOUT });
        ok(true, 'client connected by itself once the server is up', `session ${sa.sessionId}, local ${sa.local}`);

        const bob = makeClient('Bob');
        const dana = makeChildClient('Dana');   // separate process, killed later
        all.push(bob, dana);
        await bob.waitStatus('connected', { timeout: CONNECT_TIMEOUT });
        await dana.waitStatus('connected', { timeout: CONNECT_TIMEOUT });
        ok(true, '3 clients connected');

        // ---- 2. lobby -------------------------------------------------------------------------
        log('2. lobby');
        let e = await alice.expect('room:join:error', () => alice.send('room:create', { roomId: 'SMOKE1' }));
        ok(e.message === 'Register first', 'create before register refused');

        const passwords = { Alice: 'alice-pass', Bob: 'bob-pass', Dana: 'dana-pass', Eve: 'eve-pass' };
        const register = (c, color) => c.expect('player:registered', () => c.send('player:register', {
            id: 'client-picked', name: c.name, password: passwords[c.name], color,
        }));
        for (const [c, color] of [[alice, '#c51111'], [bob, '#c51111'], [dana, '#132ed1']]) {
            const r = await register(c, color);
            ok(typeof r.playerId === 'string' && r.playerId.startsWith('p-') && r.playerId !== 'client-picked',
                `${c.name} got a server-issued id`, r.playerId);
            c.id = r.playerId;
            c.color = color;
        }
        e = await bob.expect('player:register:error', () => bob.send('player:register', { name: 'Alice', password: 'wrong-pass', color: '#c51111' }));
        ok(e.message === 'Wrong password', 'wrong password refused');
        e = await bob.expect('player:register:error', () => bob.send('player:register', { name: 'Alice', password: passwords.Alice, color: '#c51111' }));
        ok(/already connected/.test(e.message), 'logging in as an already connected player refused');
        const bobAgain = await bob.expect('player:registered', () => bob.send('player:register', { name: 'Bob', password: passwords.Bob, color: '#c51111' }));
        ok(bobAgain.playerId === bob.id, 'right password logs Bob back in with the same server id');

        const joinedA = await alice.expect('room:joined', () => alice.send('room:create', { roomId: 'SMOKE1' }));
        ok(joinedA.room.host.id === alice.id, 'Alice created SMOKE1 and is host');
        const joinedB = await bob.expect('room:joined', () => bob.send('room:join', { roomId: 'SMOKE1' }));
        bob.color = joinedB.player.color;
        ok(bob.color !== '#c51111', 'Bob asked for a taken color and got a free one', bob.color);
        const pj = alice.expect('player:joined', () => {}, { where: d => d.player.id === dana.id });
        await dana.expect('room:joined', () => dana.send('room:join', { roomId: 'SMOKE1' }));
        await pj;
        ok(true, 'Dana joined, host was told (player:joined)');
        const list = await bob.wait('rooms:list', { where: d => d.rooms.some(r => Object.keys(r.players).length === 3) });
        ok(!JSON.stringify(list).includes('imposter'), 'rooms:list pushed to everyone, never contains the imposter');
        const state = await bob.expect('room:state', () => bob.send('room:get', {}));
        ok(state.room.id === 'SMOKE1' && state.player.id === bob.id, 'room:get -> room:state');

        // ---- 3. game 1 ------------------------------------------------------------------------
        log('3. game 1');
        e = await bob.expect('game:notif', () => bob.send('game:start', {}));
        ok(/host/.test(e.message), 'non-host cannot start', e.message);
        const players = [alice, bob, dana];
        players.forEach(c => { c.inbox = c.inbox.filter(m => m.type !== 'game:started'); });
        alice.send('game:start', {});
        const roles = await Promise.all(players.map(c => c.wait('game:started')));
        const startedAt = Date.now();
        ok(roles.filter(r => r.isImposter).length === 1, 'game:started sent privately: exactly one isImposter=true');
        const imp = players[roles.findIndex(r => r.isImposter)];
        const [crewA, crewB] = players.filter(c => c !== imp);
        log(`   imposter = ${imp.name}, crew = ${crewA.name}, ${crewB.name}`);
        stopMovers = startMovers(players);

        await walkTo(crewA, 600, 160);
        const mv = await crewB.wait('player:moved', { where: d => d.id === crewA.id && d.x === 600, timeout: 4000 });
        ok(mv.y === 160, 'positions relayed to the other players at 20 Hz');

        crewB.inbox = crewB.inbox.filter(m => m.type !== 'player:moved');
        crewA.send('player:move', { x: 99999, y: 160, d: 'right', moving: false });
        crewA.send('player:move', { x: crewA.pos.x + 80, y: crewA.pos.y, d: 'right', moving: true });
        await sleep(400);
        const leaked = crewB.inbox.filter(m => m.type === 'player:moved' && m.data.id === crewA.id
            && (m.data.x === 99999 || m.data.x === crewA.pos.x + 80));
        ok(leaked.length === 0, 'server dropped a move outside the map and a move faster than max speed');

        e = await imp.expect('game:notif', () => imp.send('player:kill', { playerId: crewA.id }));
        ok(/cooldown/.test(e.message), 'kill refused during the 10 s cooldown', e.message);
        e = await crewA.expect('game:notif', () => crewA.send('player:kill', { playerId: crewB.id }));
        ok(/imposter/.test(e.message), 'a crewmate cannot kill', e.message);

        await walkTo(imp, 950, 160);   // far from everyone, one legal step at a time
        await sleep(Math.max(0, 10_300 - (Date.now() - startedAt)));
        e = await imp.expect('game:notif', () => imp.send('player:kill', { playerId: crewA.id }));
        ok(/far/.test(e.message), 'kill refused out of range (server uses ITS positions)', e.message);

        await walkTo(imp, 610, 165);     // next to crewA
        const killed = await crewB.expect('player:killed', () => imp.send('player:kill', { playerId: crewA.id }));
        ok(killed.playerId === crewA.id && killed.killerId === imp.id, 'kill accepted in range, broadcast to all');
        ok(killed.color === crewA.color, 'body has the victim\'s color', killed.color);

        e = await crewA.expect('game:notif', () => crewA.send('meeting:start', {}));
        ok(/Dead/.test(e.message), 'a dead player cannot call a meeting');
        const ms = await imp.expect('meeting:started', () => crewB.send('meeting:start', {}));
        ok(ms.callerId === crewB.id && ms.durationMs === 30000 && Object.keys(ms.players).length === 2,
            'meeting:started with the alive players and durationMs');
        e = await crewA.expect('game:notif', () => crewA.send('meeting:vote', { votedForId: imp.id }));
        ok(/Dead/.test(e.message), 'a dead player cannot vote');

        const voted = alice.wait('meeting:voted', { where: d => d.callerId === crewB.id });
        crewB.send('meeting:vote', { votedForId: imp.id });
        ok(!('votedForId' in (await voted)), 'meeting:voted does not reveal the choice');
        const ended = crewA.wait('meeting:ended');
        const gameEnded = crewA.wait('game:ended');
        imp.send('meeting:vote', { votedForId: 'skip' });
        const res = (await ended).results;
        ok(res.ejectedId === imp.id, 'everybody voted -> meeting ends early, imposter ejected');
        const ge = await gameEnded;
        ok(ge.isImposter === false && ge.imposterId === imp.id && ge.imposterName === imp.name, 'game:ended: crew wins');
        const pts = Object.fromEntries(ge.ranking.map(r => [r.id, r.points]));
        ok(pts[crewB.id] === 3 && pts[crewA.id] === 2 && pts[imp.id] === 1 && ge.ranking[0].id === crewB.id,
            'ranking: crewB 3 (win+vote), crewA 2 (win), imposter 1 (kill)',
            ge.ranking.map(r => `${r.name}=${r.points}`).join(', '));

        // ---- 4. play again, then a crash -------------------------------------------------------
        log('4. play again, then Dana\'s process is killed (crash)');
        players.forEach(c => { c.inbox = c.inbox.filter(m => m.type !== 'game:started'); });
        alice.send('game:start', {});
        const roles2 = await Promise.all(players.map(c => c.wait('game:started')));
        const imp2 = players[roles2.findIndex(r => r.isImposter)];
        ok(imp2 !== imp, 'second game: the imposter role rotated', `${imp.name} -> ${imp2.name}`);

        dana.stopped = true;
        const leftP = alice.wait('player:left', { where: d => d.playerId === dana.id, timeout: 12000 });
        const t0 = Date.now();
        dana.crash();
        const left = await leftP;
        const crashSecs = (Date.now() - t0) / 1000;
        if (PROTO === 'tcp') {
            ok(crashSecs < 2, 'TCP: crash seen immediately (the OS closed the socket for the dead process)',
                `${crashSecs.toFixed(1)} s, "${left.reason}"`);
        } else {
            // A dead process sends nothing, so in UDP only silence can reveal it. Two mechanisms can
            // fire, whichever comes first: the 5 s heartbeat timeout, or (if reliable messages were
            // waiting for an ACK) MAX_RETRIES resends without ACK (25 x 100 ms min RTO = ~2.6 s).
            ok(crashSecs >= 2 && crashSecs <= 7 && /timeout|retransmissions/.test(left.reason),
                'UDP: crash seen through silence (heartbeat timeout or retransmission limit)',
                `${crashSecs.toFixed(1)} s, "${left.reason}"`);
        }
        const ge2 = alice.inbox.find(m => m.type === 'game:ended');
        log(`   after the crash: ${ge2 ? 'game ended (' + (ge2.data.isImposter ? 'imposter' : 'crew') + ' wins)' : 'game continues with 2 players'}`);
        stopMovers();

        // ---- 5. cable pull --------------------------------------------------------------------
        log('5. cable pull: Eve goes through a relay that starts dropping everything');
        alice.send('room:leave', {});
        await alice.expect('room:joined', () => alice.send('room:create', { roomId: 'PULL' }));
        relay = await startRelay();
        const eve = makeClient('Eve', relay.port);
        all.push(eve);
        const se = await eve.waitStatus('connected', { timeout: CONNECT_TIMEOUT });
        const eveReg = await eve.expect('player:registered', () => eve.send('player:register', { name: 'Eve', password: passwords.Eve, color: '#117f2d' }));
        eve.id = eveReg.playerId;
        await eve.expect('room:joined', () => eve.send('room:join', { roomId: 'PULL' }));

        const serverSaw = alice.wait('player:left', { where: d => d.playerId === eve.id, timeout: 12000 });
        const eveSaw = eve.waitStatus('disconnected', { fresh: true, timeout: 12000 });
        const t1 = Date.now();
        relay.blackhole(true);
        const [l2, s2] = await Promise.all([serverSaw, eveSaw]);
        const srvSecs = (Date.now() - t1) / 1000;
        ok(srvSecs >= 2 && srvSecs <= 7.5 && /timeout|retransmissions/.test(l2.reason),
            'server detected the pulled cable through silence alone', `${srvSecs.toFixed(1)} s, "${l2.reason}"`);
        ok(/timeout|retransmissions/.test(s2.reason), 'client detected it too, through silence alone', `"${s2.reason}"`);

        relay.blackhole(false);
        const t2 = Date.now();
        const s3 = await eve.waitStatus('connected', { fresh: true, timeout: CONNECT_TIMEOUT });
        ok(s3.sessionId !== se.sessionId, 'cable back: client reconnected by itself with a NEW session',
            `${se.sessionId} -> ${s3.sessionId} after ${((Date.now() - t2) / 1000).toFixed(1)} s`);

        // ---- 6. clean quit --------------------------------------------------------------------
        log('6. clean quit (TCP FIN / UDP BYE)');
        const eveBack = await eve.expect('player:registered', () => eve.send('player:register', { name: 'Eve', password: passwords.Eve, color: '#117f2d' }));
        ok(eveBack.playerId === eve.id, 'after reconnect, the same password returns the same id');
        await eve.expect('room:joined', () => eve.send('room:join', { roomId: 'PULL' }));
        const quitP = alice.wait('player:left', { where: d => d.playerId === eve.id, timeout: 9000 });
        const t3 = Date.now();
        const eveStats = eve.stats();
        eve.close();
        const q = await quitP;
        const quitSecs = (Date.now() - t3) / 1000;
        // With simulated loss on the server, the single BYE datagram itself can be dropped: then the
        // timeout catches it. That is why the server needs BOTH mechanisms.
        ok(quitSecs < (LOSS > 0 ? 7 : 1.5), 'server saw the clean quit', `${quitSecs.toFixed(1)} s, "${q.reason}"`);

        // ---- stats ----------------------------------------------------------------------------
        log('client statistics:');
        for (const c of [alice, bob]) console.log(`   ${c.name}:`, JSON.stringify(c.stats()));
        console.log('   Eve (before quitting):', JSON.stringify(eveStats));

        console.log(`\nALL ${passed} CHECKS PASSED (${PROTO.toUpperCase()}, loss ${LOSS * 100}%)\n`);
        process.exitCode = 0;
    } catch (err) {
        console.error('\n' + err.message);
        if (server) console.error('\n--- server output (last 40 lines) ---\n' + server.output().split('\n').slice(-40).join('\n'));
        process.exitCode = 1;
    } finally {
        stopMovers();
        for (const c of all) { try { c.close(); } catch {} }
        if (relay) relay.close();
        await sleep(200);
        if (server) server.kill();
        setTimeout(() => process.exit(), 300);
    }
})();
