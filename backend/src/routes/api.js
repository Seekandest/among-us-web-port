import express from "express";
import { RoomsManager } from "../managers/rooms.manager.js";
import { PlayersManager } from "../managers/players.manager.js";
const router = express.Router();

router.get("/status", (req, res) => {res.send("OK");});
router.get("/rooms", (req, res) => {res.json(RoomsManager.fetchRooms());});
router.get("/player/room/:playerId", (req, res) => {
    const playerId = req.params.playerId;
    const player = PlayersManager.getPlayer(playerId);
    if (!player) {
        console.log("Player not found:", playerId);
        res.status(404).json({error: "Player not found"});
        return;
    }
    const room = RoomsManager.fetchRoom(player.roomId);
    if (!room) {
        console.log("Room not found for player:", playerId, player);
        res.status(404).json({error: "Room not found"});
        return;
    }
    console.log("Fetched room for player:", playerId, room, player);
    res.json({room, player});
});

export default router;
