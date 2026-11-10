// backend/src/events/gameEvents.js
// In-game messages: start, movement, kill, meeting, vote, and the end of the game.
//
// Every handler has the signature (ctx, sessionId, data):
//   ctx       - helpers from main.js (sendTo, sendToRoom, playerIdOf, ...). No socket access here.
//   sessionId - WHICH CLIENT sent the message, decided by the transport (TCP socket / UDP ip:port).
//   data      - the payload. Untrusted: it came over the network, so every field is checked.
//
// The server is AUTHORITATIVE: a client only sends requests ("I want to kill X"). The server checks
// the rules using its own state (positions, roles, timers) and then tells everyone what happened.
// The player's identity always comes from the session, never from an id inside the payload,
// so a client cannot act on behalf of another player.

import { RoomsManager } from '../managers/rooms.manager.js';
import { PlayersManager } from '../managers/players.manager.js';

export const MIN_PLAYERS_TO_START = 2;     // 3 for the real demo; 2 is handy for testing
const KILL_RANGE_PX = 100;
const KILL_COOLDOWN_MS = 10_000;
const MEETING_DURATION_MS = 30_000;

const POINTS = {
    KILL: 1,            // imposter, per kill
    CORRECT_VOTE: 1,    // crewmate who voted for the imposter
    IMPOSTER_WIN: 3,    // to the imposter
    CREW_WIN: 2,        // to every crewmate (alive or dead)
};

/** Private message to one player only (validation errors, "kill on cooldown", ...). */
function notify(ctx, sessionId, message) {
    ctx.sendTo(sessionId, 'game:notif', { message });
}

/** The player behind this session and the room they are in, or null + a notification. */
function playerAndRoom(ctx, sessionId) {
    const player = PlayersManager.getPlayer(ctx.playerIdOf(sessionId));
    if (!player) {
        notify(ctx, sessionId, 'Register first');
        return null;
    }
    const room = player.roomId ? RoomsManager.fetchRoom(player.roomId) : null;
    if (!room || !room.players[player.id]) {
        notify(ctx, sessionId, 'You are not in a room');
        return null;
    }
    return { player, room };
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------------------------
// Game end (shared with roomEvents.js: a player leaving can also end the game)
// ---------------------------------------------------------------------------------------------

/** Ends the game if a side has won. @returns {boolean} true if the game ended */
export function checkAndEndGame(ctx, roomId) {
    const imposterWon = RoomsManager.checkWin(roomId);
    if (imposterWon === null) return false;
    endGame(ctx, roomId, imposterWon);
    return true;
}

function endGame(ctx, roomId, imposterWon) {
    const room = RoomsManager.fetchRoom(roomId);
    if (!room) return;

    const imposterId = room.imposter;
    // The imposter may already have left the room; PlayersManager still knows their name here.
    const imposterName = PlayersManager.getPlayer(imposterId)?.name || 'unknown';

    for (const p of Object.values(room.players)) {
        const isImposter = p.id === imposterId;
        if (imposterWon && isImposter) room.scores[p.id] += POINTS.IMPOSTER_WIN;
        if (!imposterWon && !isImposter) room.scores[p.id] += POINTS.CREW_WIN;
    }

    const ranking = Object.values(room.players)
        .map(p => ({ id: p.id, name: p.name, color: p.color, points: room.scores[p.id] || 0 }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    console.log(`[game] room ${roomId}: ${imposterWon ? 'IMPOSTER' : 'CREW'} wins (imposter = ${imposterName})`);
    ctx.sendToRoom(roomId, 'game:ended', {
        roomId,
        isImposter: imposterWon,   // true = the imposter won (name kept from the original client code)
        imposterId,
        imposterName,
        ranking,
    });

    RoomsManager.resetRoom(roomId);  // back to the waiting room, scores kept for the next game
    ctx.broadcastRooms();            // the lobby list shows the room as "not started" again
}

/** Closes the active meeting (all voted, or timer expired), announces the result, checks for a win. */
export function finishMeeting(ctx, roomId) {
    const results = RoomsManager.meetings.end(roomId); // null if no meeting is active
    if (!results) return;
    console.log(`[game] room ${roomId}: meeting ended, ejected = ${results.ejectedId || 'nobody'}`);
    ctx.sendToRoom(roomId, 'meeting:ended', { results });
    checkAndEndGame(ctx, roomId);
}

/** Called by roomEvents.js after a player was removed from a started game. */
export function afterPlayerLeftGame(ctx, roomId) {
    if (checkAndEndGame(ctx, roomId)) return;
    // If the player who left was the last one still to vote, the meeting can end now.
    const room = RoomsManager.fetchRoom(roomId);
    const meeting = room?.currentMeeting;
    if (meeting?.isActive) {
        const alive = Object.values(room.players).filter(p => p.isAlive);
        if (alive.every(p => meeting.votes[p.id] !== undefined)) finishMeeting(ctx, roomId);
    }
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

/** game:start {} - host only. Each player privately learns whether they are the imposter. */
function gameStart(ctx, sessionId) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;

    if (room.host.id !== player.id) return notify(ctx, sessionId, 'Only the host can start the game');
    if (room.started) return notify(ctx, sessionId, 'The game has already started');
    const count = Object.keys(room.players).length;
    if (count < MIN_PLAYERS_TO_START) {
        return notify(ctx, sessionId, `Need at least ${MIN_PLAYERS_TO_START} players to start`);
    }

    RoomsManager.startGame(room.id);
    console.log(`[game] room ${room.id}: game #${room.gameNumber} started with ${count} players`);

    // The role is sent PRIVATELY: each player receives their own message, so nobody can see
    // in their traffic (or in Wireshark) who the imposter is, only whether THEY are.
    for (const p of Object.values(room.players)) {
        ctx.sendToPlayer(p.id, 'game:started', { roomId: room.id, isImposter: p.id === room.imposter });
    }
    ctx.broadcastRooms();
}

/** player:move {x, y, d, moving} - sent ~20 times per second while moving. */
function playerMove(ctx, sessionId, data) {
    const player = PlayersManager.getPlayer(ctx.playerIdOf(sessionId));
    if (!player || !player.roomId) return; // silently: moves are frequent, no notification spam
    if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y)) return;

    const state = {
        x: data.x,
        y: data.y,
        d: data.d === 'right' ? 'right' : 'left',
        moving: data.moving === true,
    };
    // The room keeps a reference to the same player object, so this updates both.
    PlayersManager.updatePlayerState(player.id, state);

    // Relay to the OTHER players only: the sender already knows where it is.
    // In the UDP version this goes out as an unreliable FAST packet (see protocol UNRELIABLE_TYPES).
    ctx.sendToRoom(player.roomId, 'player:moved', { id: player.id, roomId: player.roomId, ...state }, player.id);
}

/** player:kill {playerId} - playerId is the VICTIM. The killer is whoever owns this session. */
function playerKill(ctx, sessionId, data) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player: killer, room } = found;
    const victim = room.players[data.playerId];

    if (!room.started) return notify(ctx, sessionId, 'The game has not started');
    if (room.imposter !== killer.id) return notify(ctx, sessionId, 'Only the imposter can kill');
    if (!killer.isAlive) return notify(ctx, sessionId, 'You are dead');
    if (!victim || victim.id === killer.id || !victim.isAlive) return notify(ctx, sessionId, 'Invalid target');
    if (room.currentMeeting?.isActive) return notify(ctx, sessionId, 'No kills during a meeting');

    const waitMs = KILL_COOLDOWN_MS - (Date.now() - room.lastKillAt);
    if (waitMs > 0) return notify(ctx, sessionId, `Kill on cooldown (${Math.ceil(waitMs / 1000)} s)`);

    // Distance is computed from the SERVER's copy of the positions, not from coordinates the
    // killer could invent in the payload.
    const dist = Math.hypot(killer.state.x - victim.state.x, killer.state.y - victim.state.y);
    if (dist > KILL_RANGE_PX) return notify(ctx, sessionId, 'Too far away');

    victim.isAlive = false;
    room.lastKillAt = Date.now();
    room.scores[killer.id] += POINTS.KILL;
    // The killer jumps onto the body (the client does the same on screen).
    PlayersManager.updatePlayerState(killer.id, { x: victim.state.x, y: victim.state.y });

    console.log(`[game] room ${room.id}: ${killer.name} killed ${victim.name}`);
    ctx.sendToRoom(room.id, 'player:killed', {
        playerId: victim.id,
        killerId: killer.id,
        x: victim.state.x,
        y: victim.state.y,
        color: victim.color,   // the dead body has the VICTIM's color
    });
    checkAndEndGame(ctx, room.id);
}

/** meeting:start {} - emergency meeting, once per player per game. */
function meetingStart(ctx, sessionId) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;

    if (!room.started) return notify(ctx, sessionId, 'The game has not started');
    if (!player.isAlive) return notify(ctx, sessionId, 'Dead players cannot call a meeting');
    if (room.currentMeeting?.isActive) return notify(ctx, sessionId, 'A meeting is already running');
    if (room.emergencyUsed[player.id]) return notify(ctx, sessionId, 'You already called a meeting this game');

    room.emergencyUsed[player.id] = true;
    // The server owns the timer: the meeting ends when everyone voted or after 30 s, whatever
    // the clients say (a client's "meeting:end" is ignored).
    RoomsManager.meetings.create(room.id, player.id, MEETING_DURATION_MS, () => finishMeeting(ctx, room.id));

    const players = {};
    for (const p of Object.values(room.players)) {
        if (p.isAlive) players[p.id] = { id: p.id, name: p.name, color: p.color, isAlive: true };
    }
    console.log(`[game] room ${room.id}: meeting called by ${player.name}`);
    ctx.sendToRoom(room.id, 'meeting:started', { callerId: player.id, durationMs: MEETING_DURATION_MS, players });
}

/** meeting:vote {votedForId} - a player id, or 'skip'. */
function meetingVote(ctx, sessionId, data) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;
    const meeting = room.currentMeeting;
    const target = data.votedForId;

    if (!meeting?.isActive) return notify(ctx, sessionId, 'No meeting is running');
    if (!player.isAlive) return notify(ctx, sessionId, 'Dead players cannot vote');
    if (meeting.votes[player.id] !== undefined) return notify(ctx, sessionId, 'You already voted');
    if (target !== 'skip' && !room.players[target]?.isAlive) return notify(ctx, sessionId, 'Invalid vote');

    const allVoted = RoomsManager.meetings.vote(room.id, player.id, target);
    if (target === room.imposter && player.id !== room.imposter) room.scores[player.id] += POINTS.CORRECT_VOTE;

    // Tell everyone THAT this player voted, not WHO they voted for (revealed in meeting:ended).
    ctx.sendToRoom(room.id, 'meeting:voted', { callerId: player.id });
    if (allVoted) finishMeeting(ctx, room.id);
}

/** meeting:end - ignored on purpose: only the server decides when a meeting ends. */
function meetingEndIgnored() {}

export const gameHandlers = {
    'game:start': gameStart,
    'player:move': playerMove,
    'player:kill': playerKill,
    'meeting:start': meetingStart,
    'meeting:vote': meetingVote,
    'meeting:end': meetingEndIgnored,
};
