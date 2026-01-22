import { BaseGameScene } from './BaseGameScene.js';
/**
 * Main game scene - extends BaseGameScene with game-specific map and rules
 */
export class Game extends BaseGameScene {
    constructor() {
        super('Game');
    }
    init(data) {
        console.log('Game scene init with data:', data);
    }
    /**
     * Game-specific map configuration
     */
    getMapConfig() {
        return {
            mapKey: 'gameMapJSON',
            mapJSON: 'map.json',
            tilesetName: 'red',
            tilesetKey: 'red',
            backgroundKey: 'skled',
            backgroundImage: 'skled.png'
        };
    }

    preload() {
        this.preloadCommon();
        this.preloadMap();
        this.load.image('kill', 'assets/icons/kill_icon.png');
    }
    create() {
        this.createCommon();
        // Game specific setup (eg, impostor mechanics, tasks)
    }
    update(time, delta) {
        this.handleMovement();
        // Game specific logic
    }
    shutdown() {
        super.shutdown();
        // cleanup can go here
    }
}
