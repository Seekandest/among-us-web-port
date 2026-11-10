import {BaseGameScene} from './BaseGameScene.js';
import {EventBus} from '../EventBus.js';

/**
 * Waiting lobby scene - extends BaseGameScene with lobby-specific map and rules
 */
export class WaitingLobby extends BaseGameScene {
    constructor() {
        super('WaitingLobby');
        // No idea how this fixed it
        this.handleStartGame = this.handleStartGame.bind(this);
    }
    init(data) {
        console.log("Lobby Scene started with ", data)
    }
    /**
     * Handle start game event from React (after the server's private game:started message)
     */
    handleStartGame(data) {
        console.log('handleStartGame called with data:', data, this.scene);
        if (this.scene && this.scene.isActive('WaitingLobby')) {
            console.log('Starting game with data:', data);
            // The role came in our own game:started message as a plain boolean (no HTTP request).
            // Game.js still expects a Promise, so wrap it.
            data.isImposter = Promise.resolve(data.isImposter);
            this.scene.start('Game', data);
        }
    }
    /**
     * Lobby-specific map configuration
     */
    getMapConfig() {
        return {
            mapKey: 'lobbyMapJSON',
            mapJSON: 'lobby.json',
            tilesetName: 'red',
            tilesetKey: 'red',
            backgroundKey: 'lobby',
            backgroundImage: 'Lobby.png'
        };
    }
    preload() {
        this.preloadCommon();
        this.preloadMap();
    }
    create() {
        this.createCommon();

        // Remove existing listeners first to avoid duplicates
        EventBus.removeAllListeners('start-game');
        // Listen for game start event from React
        EventBus.on('start-game', this.handleStartGame, this);
    }
    update(time, delta) {
        this.handleMovement();
    }
    /** Called once on 'shutdown' / 'destroy' (registered in BaseGameScene.createCommon). */
    cleanup() {
        super.cleanup();
        EventBus.off('start-game', this.handleStartGame, this);
    }
}
