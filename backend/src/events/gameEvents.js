export const registerGameEvents = (io, socket) => {
    // see comment below about playerJoin
    // /**
    //  * @param {{player: import('../types/room.type.js').Player, roomId: string}} data
    //  */
    // const playerJoin = (data) => {
    //     console.log("Player join received:", data);
    //     socket.to(data.roomId).emit("player:joined", data);
    // }
    /**
     * @param {{playerId: string, roomId: string}} data
     */
    const playerLeave = (data) => {
        console.log("Player leave received:", data);
        socket.to(data.roomId).emit("player:left", {playerId: data.playerId});
    }

    /**
     * @param {{playerId: string, roomId: string, state: {x: number, y: number, d: string, moving: boolean}}} data
     */
    const playerMove = (data) => {
        // will setup later, using just coords for now
        // data: {playerId: string, roomId: string, state: {x: number, y: number, d: string}}
        // Update player state in PlayersManager
        console.log("Player move received:", data);
        io.to(data.roomId).emit("player:moved", data);
    }

    const animationShift = (data) => {
        io.to(data.roomId).emit("player:animation", data);
    }

    // socket.on("player:join", playerJoin); looks useless for now as room:join already does the job
    socket.on("player:leave", playerLeave);
    socket.on("player:move", playerMove);
    socket.on("player:animation", animationShift);

}
