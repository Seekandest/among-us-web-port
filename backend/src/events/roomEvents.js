import {PlayersManager} from "../managers/players.manager.js";
import {RoomsManager} from "../managers/rooms.manager.js";

export const registerRoomEvents = (io, socket) => {
    /**
     * @param {{id: string, name: string, color: string}} data
     */
    const playerRegister = (data) => {
        console.log("Player register received:", data);
        PlayersManager.createPlayer(data.id, data.name, data.color);
        socket.emit('player:registered', {playerId: data.id});
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
        let player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            // TODO setup return values to reduce method calls
            PlayersManager.setRoomId(player.id, data.roomId)
            RoomsManager.players.add(data.roomId, player);
            player = PlayersManager.getPlayer(data.playerId);
            console.log("Player after setting roomId and adding to room:", player, data.roomId);
            const room = RoomsManager.fetchRoom(data.roomId);
            socket.join(data.roomId)
            socket.emit("room:joined", {roomId: data.roomId, room, player});
            socket.to(data.roomId).emit("player:joined", {player, roomId: data.roomId});
        }
    }
    const disconnect = (data) => {
        console.log("Player disconnected:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            const roomId = player.roomId;
            RoomsManager.players.remove(roomId, player);
            socket.to(roomId).emit("player:left", {playerId: player.id});
            PlayersManager.deletePlayer(player.id);
        }
    }
    socket.on("player:register", playerRegister);
    socket.on("room:create", roomCreate);
    socket.on("room:join", roomJoin);
    // TODO add room:leave event
    socket.on("disconnect", disconnect)
}
