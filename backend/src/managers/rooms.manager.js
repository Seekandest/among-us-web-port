import {PlayersManager} from "./players.manager.js";

/**
 * @type {{[key: string]: import('../types/room.type.js').GameRoom}}
 */
const rooms = {"1" : {id: "1", started: false, imposter: null, host: {id: "host1", name: "Host One", roomId: "1", state: {x: 0, y: 0, d: 'left'}, color: "red", isImposter: false, isAlive: true}, players: {}}};

export const RoomsManager = {
    players : {
            /**
             * @param {string} roomId
             * @param {import('../types/room.type.js').Player} player
             */
            add(roomId, player) {
                if (!rooms[roomId]) return;

                rooms[roomId].players[player.id] = player;
            },
            /**
             * @param {string} roomId
             * @param {import('../types/room.type.js').Player} player
             */
            remove(roomId, player) {
                if (!rooms[roomId]) return;
                delete rooms[roomId].players[player.id];
            },
            /**
             * @param {string} roomId
             * @param {string} playerId
             * @param {{x:number,y:number,d:string}} state
             */
            updateState(roomId, playerId, state) {
                if (!rooms[roomId] || !rooms[roomId].players[playerId]) return;
                rooms[roomId].players[playerId].state = state;
            },
    },

    /**
     * @param {string} roomId
     * @param {import('../types/room.type.js').Player} host
     */
    createRoom(roomId, host) {
        if (rooms[roomId]) return

        rooms[roomId] = {id: roomId, started: false, imposter: null, host: host, players: {}};
    },

    fetchRooms() {
        console.log("Fetching rooms:", rooms);
        return Object.values(rooms);
    },
    /**
     * @param {string} roomId
     */
    fetchRoom(roomId) {
        return rooms[roomId];
    },
    /**
     * @param {string} roomId
     */
    startGame(roomId) {
        if (!rooms[roomId]) return;
        rooms[roomId].started = true;
        const players = Object.values(rooms[roomId].players);

        if (!players || players.length === 0) {
            rooms[roomId].imposter = null;
            return;
        }
        const idx = Math.floor(Math.random() * players.length);
        rooms[roomId].imposter = players[idx].id;

    }
}
