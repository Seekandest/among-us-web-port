import { Server } from "socket.io";
import { registerLobbyEvents } from "./events/lobbyEvents.js";
import { registerGameEvents } from "./events/gameEvents.js";

const io = new Server({
    cors: {
        origin: "http://localhost:8080",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    registerLobbyEvents(io, socket);
    registerGameEvents(io, socket);
    socket.on("disconnect", () => {console.log("Client disconnected:", socket.id);});
});

io.listen(3000);
console.log("Socket.io server running on port 3000");
