// backend/src/managers/accounts.manager.js
// Accounts for registration and login. The password never leaves this file in clear text:
// it is stored as a scrypt hash in users.json. The player id is created HERE, on the server.
// A client cannot choose it, and cannot take over an existing name without the password.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// crypto.scrypt is deliberately slow (tens of ms) to make password guessing expensive. The async
// version runs it on libuv's thread pool, so a login does not freeze the game server: heartbeats,
// UDP retransmissions and positions of the other players keep flowing while a password is checked.
const scryptAsync = promisify(scrypt);

const KEY_LEN = 32;
const FILE = process.env.ACCOUNTS_FILE || path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../data/users.json',
);

/** @type {Record<string, {id: string, name: string, salt: string, hash: string}>} */
let accounts = load();

function load() {
    try {
        const raw = fs.readFileSync(FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        if (err.code !== 'ENOENT') console.error('[accounts] could not read users.json:', err.message);
        return {};
    }
}

function save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2));
    fs.renameSync(tmp, FILE);
}

/** scrypt(password, per-user random salt). Only this hash and the salt are stored, never the password. */
async function hashPassword(password, salt) {
    return (await scryptAsync(password, salt, KEY_LEN)).toString('hex');
}

async function passwordMatches(password, account) {
    const expected = Buffer.from(account.hash, 'hex');
    const actual = await scryptAsync(password, Buffer.from(account.salt, 'hex'), expected.length);
    // Constant-time comparison: the time taken does not reveal how many bytes matched.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function newPlayerId() {
    return `p-${randomBytes(8).toString('hex')}`;
}

export const Accounts = {
    /**
     * First time this name is seen: create the account and issue a player id.
     * Name already known: the password must match, and the SAME id is returned.
     * @returns {Promise<{ok: true, id: string, name: string, created: boolean} | {ok: false, message: string}>}
     */
    async loginOrRegister(name, password) {
        const key = name.toLowerCase();
        if (!accounts[key]) {
            const salt = randomBytes(16);
            const hash = await hashPassword(password, salt);
            // Two clients may have registered the same new name while we were hashing:
            // the first one wins, the second one is checked like a normal login below.
            if (!accounts[key]) {
                const account = { id: newPlayerId(), name, salt: salt.toString('hex'), hash };
                accounts[key] = account;
                save();
                console.log(`[accounts] registered "${account.name}" as ${account.id}`);
                return { ok: true, id: account.id, name: account.name, created: true };
            }
        }
        const existing = accounts[key];
        if (!(await passwordMatches(password, existing))) {
            console.log(`[accounts] wrong password for "${existing.name}"`);
            return { ok: false, message: `Wrong password for "${existing.name}". This name is already registered.` };
        }
        console.log(`[accounts] "${existing.name}" logged in (${existing.id})`);
        return { ok: true, id: existing.id, name: existing.name, created: false };
    },
};
