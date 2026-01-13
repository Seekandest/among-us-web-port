import {PlayersManager} from "../managers/players.manager.js";
import {RoomsManager} from "../managers/rooms.manager.js";

export const registerRoomEvents = (io, socket) => {
    /**
     * @param {{id: string, name: string, color: string}} data
     */
    const playerRegister = (data) => {
        console.log("Player register received:", data);
        PlayersManager.createPlayer(data.id, data.name, data.color);
    }
    /**
     * @param {{hostId : string, roomId}} data
     */
    const roomCreate = (data) => {
        console.log("Room create received:", data);
        const player = PlayersManager.getPlayer(data.hostId);
        if (player) {
            RoomsManager.createRoom(data.roomId, player);
        }
        socket.emit("room:created", {roomId: data.roomId});
    }
    /**
     * @param {{playerId : string, roomId: string}} data
     */
    const roomJoin = (data) => {
        console.log("Room join received:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            RoomsManager.players.add(data.roomId, player);
            socket.join(data.roomId)
            socket.emit("room:joined", {roomId: data.roomId});
        }
    }
    socket.on("player:register", playerRegister);
    socket.on("room:create", roomCreate);
    socket.on("room:join", roomJoin);
}
