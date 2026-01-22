import { Server } from "socket.io";
import express from "express";
import apiRouter from "./routes/api.js";
import cors from "cors";
import { registerRoomEvents } from "./events/roomEvents.js";
import { registerGameEvents } from "./events/gameEvents.js";

const io = new Server({
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    registerRoomEvents(io, socket);
    registerGameEvents(io, socket);
});

io.listen(3000);
console.log("Socket.io server running on port 3000");

const app = express();
app.use(cors({ origin: "http://localhost:8080" }));
app.use('/', apiRouter);
app.listen(3001, () => {console.log("Express server running on port 3001");});
