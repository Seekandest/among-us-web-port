/**
 * @type {{[key: string] : import ('../types/room.type').Room}}
 */
const rooms = {};

class RoomsManager {
  /**
   *
   * @param {number} roomId
   * @param {import('../types/player.type').Player} host
   */
  createRoom(roomId, host) {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        started: false,
        imposter: null,
        host: host,
        players: [],
      };
    }
  }
  /**
   * @param {number} roomId
   * */
  deleteRoom(roomId) {
    delete rooms[roomId];
  }

  /**
   * @param {number} roomId
   * @param {import('../types/player.type').Player} player
   */
  addPlayer(roomId, player) {
    if (rooms[roomId]) {
      rooms[roomId].players.push(player);
    }
  }

  /**
   * @param {number} roomId
   * @param {import('../types/player.type').Player} player
   */
  removePlayer(roomId, player) {
    if (rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(
        (p) => p.id !== player.id
      );
    }
  }
}

module.exports = new RoomsManager();
