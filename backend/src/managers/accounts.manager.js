// backend/src/managers/accounts.manager.js
// Accounts for registration and login. The password never leaves this file in clear text:
// it is stored as a scrypt hash in users.json. The player id is created HERE, on the server.
// A client cannot choose it, and cannot take over an existing name without the password.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function hashPassword(password, salt) {
    return scryptSync(password, salt, KEY_LEN).toString('hex');
}

function passwordMatches(password, account) {
    const expected = Buffer.from(account.hash, 'hex');
    const actual = scryptSync(password, Buffer.from(account.salt, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function newPlayerId() {
    return `p-${randomBytes(8).toString('hex')}`;
}

export const Accounts = {
    /**
     * First time this name is seen: create the account and issue a player id.
     * Name already known: the password must match, and the SAME id is returned.
     * @returns {{ok: true, id: string, name: string, created: boolean} | {ok: false, message: string}}
     */
    loginOrRegister(name, password) {
        const key = name.toLowerCase();
        const existing = accounts[key];
        if (!existing) {
            const salt = randomBytes(16);
            const account = {
                id: newPlayerId(),
                name,
                salt: salt.toString('hex'),
                hash: hashPassword(password, salt),
            };
            accounts[key] = account;
            save();
            console.log(`[accounts] registered "${account.name}" as ${account.id}`);
            return { ok: true, id: account.id, name: account.name, created: true };
        }
        if (!passwordMatches(password, existing)) {
            return { ok: false, message: 'Wrong password' };
        }
        console.log(`[accounts] "${existing.name}" logged in (${existing.id})`);
        return { ok: true, id: existing.id, name: existing.name, created: false };
    },
};
