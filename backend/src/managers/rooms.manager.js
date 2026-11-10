import {PlayersManager} from "./players.manager.js";

export const SPAWN = {x: 560, y: 150};

/**
 * @type {{[key: string]: import('../types/room.type.js').GameRoom}}
 */
const rooms = {};

export const RoomsManager = {
    players: {
        /**
         * @param {string} roomId
         * @param {import('../types/room.type.js').Player} player
         */
        add(roomId, player) {
            const room = rooms[roomId];
            if (!room) return;
            player = PlayersManager.setRoomId(player.id, roomId);
            room.players[player.id] = player;
            if (room.scores[player.id] === undefined) room.scores[player.id] = 0;
            return player;
        },
        /**
         * @returns {{deleted: boolean, hostChanged: boolean}}
         */
        remove(roomId, player) {
            const room = rooms[roomId];
            if (!room) return {deleted: false, hostChanged: false};
            delete room.players[player.id];
            delete room.scores[player.id];
            const remaining = Object.values(room.players);
            if (remaining.length < 1) {
                if (room.currentMeeting?.timer) clearTimeout(room.currentMeeting.timer);
                delete rooms[roomId];
                return {deleted: true, hostChanged: false};
            }
            if (room.host.id === player.id) {
                room.host = remaining[0];
                return {deleted: false, hostChanged: true};
            }
            return {deleted: false, hostChanged: false};
        },
        updateState(roomId, playerId, state) {
            const room = rooms[roomId];
            if (!room || !room.players[playerId]) return;
            room.players[playerId].state = {...room.players[playerId].state, ...state};
        },
    },

    meetings: {
        /** One meeting (and one timer) per room. */
        create(roomId, callerId, durationMs, onTimeout) {
            const room = rooms[roomId];
            room.currentMeeting = {
                isActive: true,
                callerId,
                votes: {},
                endTime: Date.now() + durationMs,
                timer: setTimeout(onTimeout, durationMs),
            };
        },
        /** @returns {boolean} true if every alive player has voted */
        vote(roomId, voterId, votedForId) {
            const room = rooms[roomId];
            if (!room?.currentMeeting?.isActive) return false;
            room.currentMeeting.votes[voterId] = votedForId;
            const alive = Object.values(room.players).filter(p => p.isAlive);
            return alive.every(p => room.currentMeeting.votes[p.id] !== undefined);
        },
        end(roomId) {
            const room = rooms[roomId];
            const meeting = room?.currentMeeting;
            if (!meeting || !meeting.isActive) return null;
            clearTimeout(meeting.timer);
            meeting.isActive = false;

            // Count votes ("skip" counts as a vote for nobody)
            const counts = {};
            for (const votedForId of Object.values(meeting.votes)) {
                if (!votedForId || votedForId === 'skip') continue;
                counts[votedForId] = (counts[votedForId] || 0) + 1;
            }
            let max = 0;
            let leaders = [];
            for (const [id, count] of Object.entries(counts)) {
                if (count > max) { max = count; leaders = [id]; }
                else if (count === max) leaders.push(id);
            }
            const tie = leaders.length !== 1;
            const ejectedId = tie ? null : leaders[0];
            if (ejectedId && room.players[ejectedId]) room.players[ejectedId].isAlive = false;

            meeting.results = {ejectedId, tie, counts, votes: {...meeting.votes}};
            return meeting.results;
        },
    },

    createRoom(roomId, host) {
        if (rooms[roomId]) return;
        rooms[roomId] = {
            id: roomId,
            started: false,
            imposter: null,
            host,
            players: {},
            currentMeeting: null,
            scores: {},            // playerId -> points, kept across the games played in this room
            imposterHistory: [],   // who has already been imposter (to rotate the role fairly)
            lastKillAt: 0,
            emergencyUsed: {},     // playerId -> true once they pressed the meeting button this game
            gameNumber: 0,
        };
        return rooms[roomId];
    },

    fetchRooms() {
        return Object.values(rooms);
    },

    fetchRoom(roomId) {
        return rooms[roomId];
    },

    startGame(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        const players = Object.values(room.players);
        if (players.length === 0) return;

        room.started = true;
        room.gameNumber++;
        room.lastKillAt = Date.now(); // the imposter has to wait one cooldown before the first kill
        room.emergencyUsed = {};
        players.forEach(p => {
            p.isAlive = true;
            PlayersManager.updatePlayerState(p.id, {...SPAWN, d: 'left', moving: false});
        });

        // Rotate the imposter role: pick among players who have not been imposter yet.
        let candidates = players.filter(p => !room.imposterHistory.includes(p.id));
        if (candidates.length === 0) {
            room.imposterHistory = [];
            candidates = players;
        }
        const imposter = candidates[Math.floor(Math.random() * candidates.length)];
        room.imposter = imposter.id;
        room.imposterHistory.push(imposter.id);
        return room;
    },

    /** Back to the waiting room after a game, ready for the next one. Scores are kept. */
    resetRoom(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        if (room.currentMeeting?.timer) clearTimeout(room.currentMeeting.timer);
        room.started = false;
        room.imposter = null;
        room.currentMeeting = null;
        Object.values(room.players).forEach(p => {
            p.isAlive = true;
            PlayersManager.updatePlayerState(p.id, {...SPAWN, d: 'left', moving: false});
        });
    },

    /**
     * @returns {boolean|null} true = imposter wins, false = crew wins, null = game continues
     */
    checkWin(roomId) {
        const room = rooms[roomId];
        if (!room || !room.started || !room.imposter) return null;

        const players = Object.values(room.players);
        const alive = players.filter(p => p.isAlive);
        const aliveImposters = alive.filter(p => p.id === room.imposter).length;
        const aliveCrew = alive.length - aliveImposters;

        if (aliveImposters === 0) return false;   // imposter ejected or left
        if (aliveCrew === 0) return true;         // every crewmate is dead
        // Classic Among Us parity rule, only with 4+ players. With 3 players it would end the game
        // after the very first kill, so with 3 players the imposter must kill both crewmates.
        if (players.length >= 4 && aliveImposters >= aliveCrew) return true;
        return null;
    },
};

/**
 * What clients are allowed to see about a room. NEVER includes who the imposter is
 * (the original project sent the imposter's id to everybody).
 */
export function publicRoom(room) {
    const players = {};
    for (const p of Object.values(room.players)) {
        players[p.id] = {id: p.id, name: p.name, color: p.color, isAlive: p.isAlive, state: p.state};
    }
    return {
        id: room.id,
        started: room.started,
        host: {id: room.host.id, name: room.host.name},
        players,
        scores: {...room.scores},
    };
}
