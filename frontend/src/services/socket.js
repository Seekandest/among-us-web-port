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

socket.on("disconnect", () => {
    console.log("Disconnected from server");
});

socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
});

// socket.on("player:moved", (data) => {
//     console.log("Player moved:", data);
// });


export const socketService = {
    connect: () => {
        if (!socket.connected) {
            socket.connect();
        }
    },

    disconnect: () => {
        if (socket.connected) {
            socket.disconnect();
        }
    },

    getSocket: () => socket,
};

export default socketService;
