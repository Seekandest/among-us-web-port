export const registerGameEvents = (io, socket) => {
    socket.on("player:move", (data) => {
        console.log("Player move received:", data);
        // Broadcast the movement to all other connected clients
        // socket.broadcast.emit("player:moved", data);
        socket.emit("player:moved", data);
    });
}
