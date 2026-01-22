import { io } from "socket.io-client";

const SOCKET_URL = "http://192.168.1.12:3000";

// Create socket connection
const socket = io(SOCKET_URL, {
    autoConnect: false,
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

