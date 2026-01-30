import { Server } from "socket.io";
import express from "express";
import apiRouter from "./routes/api.js";
import cors from "cors";
import { registerRoomEvents } from "./events/roomEvents.js";
import { registerGameEvents } from "./events/gameEvents.js";
import 'dotenv/config';

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.FRONTEND_URL || '*';

const app = express();

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use('/', apiRouter);

// HTTP server
import http from "http";
const server = http.createServer(app);

// Socket.IO server
const io = new Server(server, {
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

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
