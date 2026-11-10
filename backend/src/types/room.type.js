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
 *   isActive: boolean,
 *   callerId: string,
 *   votes: {[playerId: string]: string}, // playerId -> votedForId
 *   endTime: number
 * }} MeetingState
 */

/**
 * @typedef {{
 *   id: string,
 *   started: boolean,
 *   imposter: (string|null),
 *   host: Player,
 *   players: {[key: string]: Player},
 *   currentMeeting: MeetingState | null,
 *   scores: {[playerId: string]: number},
 *   imposterHistory: string[],
 *   lastKillAt: number,
 *   emergencyUsed: {[playerId: string]: boolean},
 *   gameNumber: number
 * }} GameRoom
 */

export {};
