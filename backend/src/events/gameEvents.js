export const registerGameEvents = (io, socket) => {
    /**
     * @param {{player: import('../types/room.type.js').Player, roomId: string}} data
     */
    const playerJoin = (data) => {
        console.log("Player join received:", data);
        // NEED TO SEND THE FULL PLAYER OBJECT
        socket.to(data.roomId).emit("player:joined", data);
    }
    /**
     * @param {{playerId: string, roomId: string}} data
     */
    const playerLeave = (data) => {
        console.log("Player leave received:", data);
        socket.to(data.roomId).emit("player:left", {playerId: data.playerId});
    }

    /**
     * @param {{playerId: string, roomId: string, state: {x: number, y: number, d: string}}} data
     */
    const playerMove = (data) => {
        // will setup later, using just coords for now
        // data: {playerId: string, roomId: string, state: {x: number, y: number, d: string}}
        // Update player state in PlayersManager
        console.log("Player move received:", data);
        socket.to(data.roomId).emit("player:moved", data);
    }

    socket.on("player:join", playerJoin);
    socket.on("player:leave", playerLeave);
    socket.on("player:move", playerMove);
    // socket.on("game:start", gameStart);
    // socket.on("game:end", gameEnd);

}
