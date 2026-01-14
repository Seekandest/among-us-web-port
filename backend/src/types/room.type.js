// backend/src/types/room.type.js

/**
 * @typedef {{x:number, y:number, d:string, moving: boolean}} PlayerState
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   roomId: string,
 *   state: PlayerState,
 *   color: string,
 *   isImposter: boolean,
 *   isAlive: boolean
 * }} Player
 */

/**
 * @typedef {{
 *   id: string,
 *   started: boolean,
 *   imposter: (string|null),
 *   host: Player,
 *   players: {[key: string]: Player}
 * }} GameRoom
 */

export {};
