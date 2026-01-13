import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import { registerRoomEvents } from "./events/roomEvents.js";
import { registerGameEvents } from "./events/gameEvents.js";
import { RoomsManager } from "./managers/rooms.manager.js";

const app = express();
app.use(cors({ origin: "http://localhost:8080" }));
const io = new Server({
    cors: {
        origin: "http://localhost:8080",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    registerRoomEvents(io, socket);
    registerGameEvents(io, socket);
    socket.on("disconnect", () => {console.log("Client disconnected:", socket.id);});
});

app.get("/status", (req, res) => {res.send("OK");});
app.get("/rooms", (req, res) => {res.json(RoomsManager.fetchRooms());});

io.listen(3000);
console.log("Socket.io server running on port 3000");
app.listen(3001, () => {console.log("Express server running on port 3001");});
