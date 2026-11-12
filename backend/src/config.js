// backend/src/config.js
// Movement rules the server enforces, in ONE place so they are easy to tune.
// The server is authoritative: a client position that breaks these rules is corrected, and the
// corrected position is sent back to that client (player:moved with corrected: true).
//
// Keep MAX_SPEED in line with the client's walking speed in
// frontend/src/game/scenes/BaseGameScene.js (handleMovement: 350 in the lobby, 100 in a game),
// otherwise honest players get corrected.

export const MOVEMENT = {
    // Maximum walking speed, in pixels per second.
    MAX_SPEED: {
        lobby: 350,   // waiting room (WaitingLobby scene)
        game: 100,    // during a game (Game scene)
    },
    SPEED_TOLERANCE: 1.15,   // 15 % slack for frame timing and network jitter
    SLACK_PX: 2,             // rounding only
    // A client may "save up" this much unused movement time, so a burst of delayed packets
    // (normal on a real network) still lands. Bigger = more lenient.
    BANK_CAP_MS: 400,
    // Movement allowed for the very first update after a spawn or a kill.
    FIRST_MOVE_MS: 80,
};

// Map bounds in pixels. Tile maps: lobby.json is 154x126 tiles, map.json is 126x70, 8 px per tile.
// Positions are clamped to [minX, maxX] x [minY, maxY]. One tile (8 px) of margin on each side,
// because the sprite's center can legitimately sit on the border.
const EDGE = 8;
export const MAP_BOUNDS = {
    lobby: { minX: -EDGE, minY: -EDGE, maxX: 154 * 8 + EDGE, maxY: 126 * 8 + EDGE },   // 1232 x 1008 map
    game: { minX: -EDGE, minY: -EDGE, maxX: 126 * 8 + EDGE, maxY: 70 * 8 + EDGE },     // 1008 x 560 map
};
