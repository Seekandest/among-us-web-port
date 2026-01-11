/**
 * @type {{[key: string] : import('../types/room.type.js').Player}}
 */
const players = {};

class PlayersManager {

    /**
     *
     * @param {number} id
     * @param {string} name
     * @param {number} roomId
     * @param {string} color
     */
    createPlayer(id, name, roomId, color) {
        if (!players[id]) {
            players[id] = {
                id: id,
                name: name,
                roomId: roomId,
                state: {x: 0, y: 0, d: 'left'},
                color: color,
            };
        }
    }

    /**
     * @param {number} id
     * */
    deletePlayer(id) {
        delete players[id];
    }

    /**
     * @param {number} id
     * @param {{x: number, y: number, d: string}} state
     */
    updatePlayerState(id, state) {
        if (players[id]) {
            players[id].state = state;
        }
    }

}
