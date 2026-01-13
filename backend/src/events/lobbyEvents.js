import {PlayersManager} from "../managers/players.manager.js";
import {RoomsManager} from "../managers/rooms.manager.js";

export const registerLobbyEvents = (io, socket) => {
    /**
     * @param {{id: string, name: string, roomId: string, color: string}} data
     */
    const playerRegister = (data) => {
        console.log("Player register received:", data);
        PlayersManager.createPlayer(data.id, data.name, data.roomId, data.color);
    }
    /**
     * @param {{hostId : string, roomId}} data
     */
    const lobbyCreate = (data) => {
        console.log("Lobby create received:", data);
        const player = PlayersManager.getPlayer(data.hostId);
        if (player) {
            RoomsManager.createRoom(data.roomId, player);
        }
        socket.emit("lobby:created", {roomId: data.roomId});
    }
    /**
     * @param {{playerId : string, roomId: string}} data
     */
    const lobbyJoin = (data) => {
        console.log("Lobby join received:", data);
        const player = PlayersManager.getPlayer(data.playerId);
        if (player) {
            RoomsManager.players.add(data.roomId, player);
            socket.emit("lobby:joined", {roomId: data.roomId});
        }
    }
    socket.on("player:register", playerRegister);
    socket.on("lobby:create", lobbyCreate);
    socket.on("lobby:join", lobbyJoin);
}
