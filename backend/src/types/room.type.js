/**
 * @typedef {{id: string, name: string, roomId: string | null, state: {x: number, y: number, d: string}, color: string, isImposter: boolean, isAlive: boolean}} Player
 */

/**
 * @typedef {{ id: string, started: boolean, imposter: string | null, host: Player, players: {[key: string]: Player}}} Room
 */

export {}
