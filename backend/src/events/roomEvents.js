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
    const playerUnregister = (data) => {
        console.log("Player unregister received:", data);
        PlayersManager.deletePlayer(data.playerId);
        socket.emit('player:unregistered');
    }
    /**
     * @param {{hostId : string, roomId}} data
     */
    const roomCreate = (data) => {
        console.log("Room create received:", data);
        const player = PlayersManager.getPlayer(data.hostId);
        if (!player) {
            console.error("Player not found for room creation:", data.hostId);
            return;
        }
        const room = RoomsManager.createRoom(data.roomId, player);
        io.emit("room:created", {roomId: data.roomId, room: room});
        roomJoin({playerId: data.hostId, roomId: data.roomId});
    }
    /**
     * @param {{playerId : string, roomId: string}} data
     */
    const roomJoin = (data) => {
        console.log("Room join received:", data);
        let player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            player = RoomsManager.players.add(data.roomId, player);
            console.log("Player after setting roomId and adding to room:", player, data.roomId);
            const room = RoomsManager.fetchRoom(data.roomId);
            socket.join(data.roomId)
            socket.emit("room:joined", {roomId: data.roomId, room, player});
            socket.to(data.roomId).emit("player:joined", {player, roomId: data.roomId});
        }
    }
    const roomLeave = (data) => {
        console.log("Room leave received:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            const roomId = player.roomId;
            const {deleted} = RoomsManager.players.remove(roomId, player);
            io.to(roomId).emit("player:left", {playerId: player.id});
            PlayersManager.setRoomId(player.id, null);
            socket.leave(roomId);
            if (deleted) {
                io.emit("room:deleted", {roomId});
            }
        }
    }
    const gameStart = (data) => {
        console.log("Game start received:", data);
        const room = RoomsManager.startGame(data.roomId);
        if (!room) {
            console.error("Room not found or could not start game:", data.roomId);
            return;1
        }
        io.to(data.roomId).emit("game:started", data );

    }
    const sendMessage = (data) => {
        console.log("Send message received:", data);
        io.to(data.roomId).emit("room:message", {playerId: data.playerId, message: data.message});
    }
    const disconnect = (data) => {
        console.log("Player disconnected:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            const roomId = player.roomId;
            const {deleted} = RoomsManager.players.remove(roomId, player);
            socket.to(roomId).emit("player:left", {playerId: player.id});
            PlayersManager.deletePlayer(player.id);
            if (deleted) {
                io.emit("room:deleted", {roomId});
            }
        }
    }
    socket.on("log", (data) => {
        console.log(data)
    });
    socket.on("player:register", playerRegister);
    socket.on("player:unregister", playerUnregister);
    socket.on("room:create", roomCreate);
    socket.on("room:join", roomJoin);
    socket.on("room:leave", roomLeave);
    socket.on("game:start", gameStart);
    socket.on("room:send:message", sendMessage);
    socket.on("disconnect", disconnect);
    // TODO cleanup old imposter sending logic
}
