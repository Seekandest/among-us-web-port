/**
 * @type {{[key: number] : import ('../types/room.type').Room}}
 */
const rooms = {};

class RoomsManager {
  constructor() {
    this.players = {
      /**
       * @param {number} roomId
       * @param {import('../types/player.type').Player} player
       */
      add(roomId, player) {
        if (!rooms[roomId]) return;
        rooms[roomId].players[player.id] = player;
      },
      /**
       * @param {number} roomId
       * @param {import('../types/player.type').Player} player
       */
      remove(roomId, player) {
        if (!rooms[roomId]) return;
        delete rooms[roomId].players[player.id];
      },
      /**
       * @param {number} roomId
       * @param {number} playerId
       * @param {{x:number,y:number,d:string}} state
       */
      updateState(roomId, playerId, state){
        if (!(rooms[roomId] || rooms[roomId].players[playerId])) return;
        rooms[roomId].players[playerId].state = state;
      },
    };
  }

  /**
   *
   * @param {number} roomId
   * @param {import('../types/player.type').Player} host
   */
  createRoom(roomId, host) {
    if (rooms[roomId]) return

    rooms[roomId] = { id: roomId, started: false, imposter: null, host: host, players: {}};
  }
  /**
   *
   * @param {number} roomId
   */
  startGame(roomId) {
    if (!rooms[roomId]) return;
    rooms[roomId].started = true;
    const players = Object.values(rooms[roomId].players);;
    if (!players || players.length === 0) {
      rooms[roomId].imposter = null;
      return;
    }
    const idx = Math.floor(Math.random() * players.length);
    rooms[roomId].imposter = players[idx].id;

  }
}

module.exports = new RoomsManager();
