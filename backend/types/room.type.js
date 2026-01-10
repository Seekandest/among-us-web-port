/**
 * @typedef {{id: number, name: string, roomId: number, state: {x: number, y: number, d: string}, color: string}, isImposter: boolean, isAlive: boolean} Player
 */

/**
 * @typedef {{ id: number, started: boolean, imposter: number | null, host: Player, players: {[key: number]: Player}}} Room
 */

export {}
