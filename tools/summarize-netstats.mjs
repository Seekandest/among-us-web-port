#!/usr/bin/env node
// tools/summarize-netstats.mjs
// Summarizes the per-second CSV files written by each client (frontend/netstats-<proto>-<pid>.csv)
// into one line per file, for the TCP vs UDP comparison slides.
//
//   node tools/summarize-netstats.mjs frontend/netstats-*.csv
//   node tools/summarize-netstats.mjs runs/wan-udp/*.csv --csv > summary.csv
//
// Per file: protocol, server, duration, RTT (avg / p95 / max), jitter (mean change between two
// consecutive RTT samples), messages per second in/out, and for UDP: position datagrams lost (%),
// retransmissions, duplicates, reordered packets.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const files = args.filter((a) => a !== '--csv');
if (!files.length) {
    console.error('usage: node tools/summarize-netstats.mjs <netstats-*.csv> [...] [--csv]');
    process.exit(2);
}

function parse(file) {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const header = lines.shift().split(',');
    return lines.map((line) => {
        const cells = line.split(',');
        return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
}

const num = (v) => (v === '' || v === undefined ? null : Number(v));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (xs, p) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (v, d = 1) => (v === null || Number.isNaN(v) ? '-' : v.toFixed(d));

const rows = [];
for (const file of files) {
    let data;
    try {
        data = parse(file).filter((r) => r.state === 'connected');
    } catch (err) {
        console.error(`${file}: ${err.message}`);
        continue;
    }
    if (!data.length) {
        console.error(`${file}: no connected rows`);
        continue;
    }
    const first = data[0];
    const last = data[data.length - 1];
    const rtts = data.map((r) => num(r.rttMs)).filter((v) => v !== null);
    const jitter = avg(rtts.slice(1).map((v, i) => Math.abs(v - rtts[i])));
    const outPerSec = avg(data.map((r) => num(r.msgsOutPerSec)).filter((v) => v !== null));
    const inPerSec = avg(data.map((r) => num(r.msgsInPerSec)).filter((v) => v !== null));
    const udp = first.proto === 'udp';
    rows.push({
        file: path.basename(file),
        proto: first.proto,
        server: first.server || '',
        seconds: Math.round((Date.parse(last.time) - Date.parse(first.time)) / 1000),
        rttAvg: avg(rtts),
        rttP95: pct(rtts, 95),
        rttMax: rtts.length ? Math.max(...rtts) : null,
        jitter,
        outPerSec,
        inPerSec,
        lossPct: udp ? num(last.lossPct) : null,
        fastLost: udp ? num(last.fastLost) : null,
        retransmits: udp ? num(last.retransmits) : null,
        duplicates: udp ? num(last.duplicatesIgnored) : null,
        reordered: udp ? num(last.outOfOrderBuffered) : null,
    });
}

if (asCsv) {
    const cols = Object.keys(rows[0] || {});
    console.log(cols.join(','));
    for (const r of rows) console.log(cols.map((c) => (typeof r[c] === 'number' ? fmt(r[c], 2) : r[c] ?? '')).join(','));
} else {
    for (const r of rows) {
        console.log(`${r.file}  ${r.proto.toUpperCase()} -> ${r.server}  ${r.seconds} s`);
        console.log(`  RTT avg ${fmt(r.rttAvg)} ms, p95 ${fmt(r.rttP95)} ms, max ${fmt(r.rttMax)} ms, jitter ${fmt(r.jitter)} ms`);
        console.log(`  messages/s out ${fmt(r.outPerSec)}, in ${fmt(r.inPerSec)}`);
        if (r.proto === 'udp') {
            console.log(`  UDP: positions lost ${fmt(r.lossPct, 2)} % (${r.fastLost}), retransmits ${r.retransmits}, ` +
                `duplicates ${r.duplicates}, reordered ${r.reordered}`);
        } else {
            console.log('  TCP: losses and retransmissions are repaired inside the OS (see Wireshark: tcp.analysis.retransmission)');
        }
    }
}
