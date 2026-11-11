// backend/src/events/roomEvents.js
// Lobby messages: register / unregister, list rooms, create / join / leave a room, and what happens
// when a client disappears (clean exit, crash, or heartbeat timeout).
//
// Same handler signature as gameEvents.js: (ctx, sessionId, data).
// The player's identity is the one BOUND TO THE SESSION at player:register. After that, any
// "playerId" / "hostId" a client puts in its payload is ignored, so a client cannot pretend to be
// somebody else (the original version trusted those fields).

import { RoomsManager, publicRoom } from '../managers/rooms.manager.js';
import { PlayersManager } from '../managers/players.manager.js';
import { Accounts } from '../managers/accounts.manager.js';
import { afterPlayerLeftGame } from './gameEvents.js';

const MAX_PLAYERS_PER_ROOM = 10;
const MAX_NAME_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 64;
const ROOM_ID_PATTERN = /^[A-Za-z0-9]{1,12}$/;

// Same list as the client (frontend/src/pages/Menu.jsx).
const PLAYER_COLORS = [
    '#c51111', '#132ed1', '#117f2d', '#ed54ba', '#ef7d0d', '#f5f557',
    '#3f474e', '#d6e0f0', '#6b2fbc', '#71491e', '#38fedc', '#50ef39',
];

/** What other clients may see about a player (no role, no internal fields). */
function publicPlayer(p) {
    return { id: p.id, name: p.name, color: p.color, isAlive: p.isAlive, state: p.state, roomId: p.roomId };
}

function sendRoomsList(ctx, sessionId) {
    ctx.sendTo(sessionId, 'rooms:list', { rooms: RoomsManager.fetchRooms().map(publicRoom) });
}

function joinError(ctx, sessionId, message) {
    ctx.sendTo(sessionId, 'room:join:error', { message });
}

/** The registered player behind this session, or null. */
function playerOf(ctx, sessionId) {
    return PlayersManager.getPlayer(ctx.playerIdOf(sessionId)) || null;
}

// ---------------------------------------------------------------------------------------------
// Leaving a room (used by room:leave, unregister, re-register, and disconnections)
// ---------------------------------------------------------------------------------------------

/**
 * Removes the player from their room and tells the others.
 * @param {string} reason shown to the other players ("left", "disconnected: timeout ...")
 */
export function removeFromRoom(ctx, player, reason) {
    const roomId = player.roomId;
    if (!roomId) return;
    const room = RoomsManager.fetchRoom(roomId);
    if (!room) {
        PlayersManager.setRoomId(player.id, null);
        return;
    }

    // A vote from a player who is no longer in the room must not count.
    if (room.currentMeeting?.isActive) delete room.currentMeeting.votes[player.id];

    const { deleted, hostChanged } = RoomsManager.players.remove(roomId, player);
    PlayersManager.resetPlayer(player.id);
    PlayersManager.setRoomId(player.id, null);
    console.log(`[room] ${player.name} left room ${roomId} (${reason})`);

    if (!deleted) {
        ctx.sendToRoom(roomId, 'player:left', { playerId: player.id, reason });
        if (hostChanged) ctx.sendToRoom(roomId, 'room:host', { hostId: room.host.id });
        // During a game, a leaver can end it (imposter left = crew wins; last crewmate left =
        // imposter wins) or finish a meeting (they were the last one still to vote).
        if (room.started) afterPlayerLeftGame(ctx, roomId);
    }
    ctx.broadcastRooms();
}

/**
 * Called by main.js when the transport reports a disconnection. Same cleanup whether the client
 * quit cleanly (TCP FIN / UDP BYE), crashed (TCP RST) or went silent (5 s heartbeat timeout).
 */
export function handleSessionGone(ctx, sessionId, reason) {
    const playerId = ctx.unbind(sessionId);
    const player = PlayersManager.getPlayer(playerId);
    if (!player) return;
    removeFromRoom(ctx, player, `disconnected: ${reason}`);
    PlayersManager.deletePlayer(player.id);
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

/**
 * player:register {name, password, color}
 * The client does NOT choose the player id. A new name creates an account and the server
 * issues the id. The same name later is a login: the password must match, or it is refused.
 * Any "id" field in the payload is ignored.
 */
function playerRegister(ctx, sessionId, data) {
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, MAX_NAME_LENGTH) : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!name || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        return ctx.sendTo(sessionId, 'player:register:error', {
            message: `Name and a password of at least ${MIN_PASSWORD_LENGTH} characters are required`,
        });
    }

    const account = Accounts.loginOrRegister(name, password);
    if (!account.ok) {
        return ctx.sendTo(sessionId, 'player:register:error', { message: account.message });
    }
    const id = account.id;

    // This account is already in use on another live connection (two windows, same name).
    // If the old connection is dead but not yet detected, this clears up within the 5 s timeout.
    const owner = ctx.sessionOf(id);
    if (owner && owner !== sessionId && ctx.isConnected(owner)) {
        return ctx.sendTo(sessionId, 'player:register:error', {
            message: 'This player is already connected from another client',
        });
    }

    // This session was someone else before: clean that player up first.
    const previous = playerOf(ctx, sessionId);
    if (previous && previous.id !== id) {
        removeFromRoom(ctx, previous, 'left');
        PlayersManager.deletePlayer(previous.id);
        ctx.unbind(sessionId);
    }

    const existing = PlayersManager.getPlayer(id);
    const color = PLAYER_COLORS.includes(data.color)
        ? data.color
        : (existing?.color || PLAYER_COLORS[0]);
    PlayersManager.createPlayer(id, account.name, color);
    // Registering again means the client is back at the menu: it is no longer in a room.
    const player = PlayersManager.getPlayer(id);
    if (player.roomId) removeFromRoom(ctx, player, 'returned to the menu');

    ctx.bind(sessionId, id);
    console.log(`[room] ${sessionId} registered as "${account.name}" (${id})`);
    ctx.sendTo(sessionId, 'player:registered', { playerId: id, name: account.name, color: player.color });
    sendRoomsList(ctx, sessionId);
}

/** player:unregister {} - back to the name screen. */
function playerUnregister(ctx, sessionId) {
    const player = playerOf(ctx, sessionId);
    if (player) {
        removeFromRoom(ctx, player, 'left');
        PlayersManager.deletePlayer(player.id);
    }
    ctx.unbind(sessionId);
    ctx.sendTo(sessionId, 'player:unregistered', {});
}

/** rooms:get {} - the lobby list (also pushed to everyone on every change). */
function roomsGet(ctx, sessionId) {
    sendRoomsList(ctx, sessionId);
}

/** room:create {roomId} - the creator becomes host and joins it. */
function roomCreate(ctx, sessionId, data) {
    const player = playerOf(ctx, sessionId);
    if (!player) return joinError(ctx, sessionId, 'Register first');
    if (typeof data.roomId !== 'string' || !ROOM_ID_PATTERN.test(data.roomId)) {
        return joinError(ctx, sessionId, 'Invalid room code');
    }
    if (RoomsManager.fetchRoom(data.roomId)) return joinError(ctx, sessionId, 'This room code already exists');

    if (player.roomId) removeFromRoom(ctx, player, 'left');
    RoomsManager.createRoom(data.roomId, player);
    console.log(`[room] ${player.name} created room ${data.roomId}`);
    roomJoin(ctx, sessionId, { roomId: data.roomId });
}

/** room:join {roomId} */
function roomJoin(ctx, sessionId, data) {
    const player = playerOf(ctx, sessionId);
    if (!player) return joinError(ctx, sessionId, 'Register first');

    const room = typeof data.roomId === 'string' ? RoomsManager.fetchRoom(data.roomId) : null;
    if (!room) return joinError(ctx, sessionId, 'Room not found');
    if (player.roomId === room.id) return joinError(ctx, sessionId, 'You are already in this room');
    if (room.started) return joinError(ctx, sessionId, 'The game has already started');

    const others = Object.values(room.players).filter(p => p.id !== player.id);
    if (others.length >= MAX_PLAYERS_PER_ROOM) return joinError(ctx, sessionId, 'Room is full');
    if (others.some(p => p.name.toLowerCase() === player.name.toLowerCase())) {
        return joinError(ctx, sessionId, 'Name already taken in this room');
    }

    if (player.roomId) removeFromRoom(ctx, player, 'left');

    // Color already used in this room: give the player the first free one instead of refusing.
    const taken = others.map(p => p.color);
    if (taken.includes(player.color)) {
        player.color = PLAYER_COLORS.find(c => !taken.includes(c)) || player.color;
    }

    RoomsManager.players.add(room.id, player);
    console.log(`[room] ${player.name} joined room ${room.id} (${others.length + 1} players)`);

    ctx.sendTo(sessionId, 'room:joined', { roomId: room.id, room: publicRoom(room), player: publicPlayer(player) });
    ctx.sendToRoom(room.id, 'player:joined', { roomId: room.id, player: publicPlayer(player) }, player.id);
    ctx.broadcastRooms();
}

/** room:leave {} */
function roomLeave(ctx, sessionId) {
    const player = playerOf(ctx, sessionId);
    if (player) removeFromRoom(ctx, player, 'left');
}

/** room:get {} -> room:state {room, player}. Used by the game scenes to load the room. */
function roomGet(ctx, sessionId) {
    const player = playerOf(ctx, sessionId);
    if (!player) return ctx.sendTo(sessionId, 'room:state', { room: null, player: null });
    const room = player.roomId ? RoomsManager.fetchRoom(player.roomId) : null;
    ctx.sendTo(sessionId, 'room:state', { room: room ? publicRoom(room) : null, player: publicPlayer(player) });
}

export const roomHandlers = {
    'player:register': playerRegister,
    'player:unregister': playerUnregister,
    'rooms:get': roomsGet,
    'room:create': roomCreate,
    'room:join': roomJoin,
    'room:leave': roomLeave,
    'room:get': roomGet,
};
