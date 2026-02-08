import { io } from "socket.io-client";
import { getSocketUrl } from '../utils/urls.js';

// Build socket URL from env helpers. This allows deployment configuration via VITE_SOCKET_URL or VITE_HOST.
const SOCKET_URL = getSocketUrl();

// Create socket connection
const socket = io(SOCKET_URL, {
    autoConnect: false,
    withCredentials: true
});

// Connection event handlers
socket.on("connect", () => {
    console.log("Connected to server with id:", socket.id);
});

socket.on("disconnect", (reason) => {
    console.log("Disconnected from server. Reason:", reason);
    // When socket disconnects unexpectedly, notify backend with playerId
    const playerId = sessionStorage.getItem("playerId");
    if (playerId) {
        console.log("Emitting player:disconnect for playerId:", playerId);
        socket.emit("player:disconnect", { playerId });
    }
});

socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
});


export const socketService = {
    connect: () => {
        if (!socket.connected) {
            socket.connect();
        }
    },

    disconnect: (playerId) => {
        if (socket.connected) {
            // Get playerId from parameter or sessionStorage
            const id = playerId || sessionStorage.getItem("playerId");

            // Send disconnect notification to backend
            if (id) {
                socket.emit("player:disconnect", { playerId: id });
                console.log("Emitted player:disconnect for:", id);
            }

            // Disconnect after a small delay to ensure event is sent
            setTimeout(() => {
                socket.disconnect();
            }, 100);
        } else {
            socket.disconnect();
        }
    },

    getSocket: () => socket,
};

export default socketService;
