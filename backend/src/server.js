import { Server } from "socket.io";
import express from "express";
import apiRouter from "./routes/api.js";
import cors from "cors";
import { registerRoomEvents } from "./events/roomEvents.js";
import { registerGameEvents } from "./events/gameEvents.js";
import 'dotenv/config'
const URL = process.env.HOST

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.FRONTEND_URL || URL || '*';

const io = new Server({
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ["GET", "POST"],
        credentials: true
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

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use('/', apiRouter);
app.listen(3001, () => {console.log("Express server running on port 3001");});
