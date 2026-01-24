import { BaseGameScene } from './BaseGameScene.js';
/**
 * Main game scene - extends BaseGameScene with game-specific map and rules
 */
export class Game extends BaseGameScene {
    constructor() {
        super('Game');
    }
    init(data) {
        // TODO you can use player.isImposter instead of all that bs
        console.log('Game scene init with data:', data);
        this.imposterProm = data.isImposter
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
    trackNearestPlayer() {

    }
    handleImposter() {
        if (!this.imposter || this.player) return;
        console.log("Setting up imposter", this.player, this.imposter);
        const handleKill = function () {

        }
        this.killBtn = this.add.image(720, 420, 'kill')
            .setScale(0.35)
            .setDepth(1000)
            .setScrollFactor(0)
            .setInteractive()
            .on('pointerdown', handleKill);
        this.ui.add(this.killBtn);


        this.zone = this.add.zone(this.player.x, this.player.y, 100, 100);
        this.player.setInteractive()
        this.zone.body.setCircle(60);
        this.zone.body.setAllowGravity(false);
        this.zone.setVisible(true);
        this.physics.add.overlap(this.zone, Object.values(this.players), (data) => {console.log("Collision", data)}, null, this)

        // console.log("Kill button created");
    }

    preload() {
        this.preloadCommon();
        this.preloadMap();
        this.load.image('kill', 'assets/icons/kill_icon.png');
    }
    create() {
        const prom1 = this.createCommon()
        Promise.all([prom1, this.imposterProm]).then((a) => {
            console.log("Creating imposter elements", prom1, this.imposterProm, a);
            this.imposter = a[1];
            this.handleImposter();
        })
    }
    update(time, delta) {
        this.handleMovement();
        if (this.imposter && this.zone && this.player) this.zone.setPosition(this.player.x, this.player.y)

    }
    shutdown() {
        super.shutdown();
    }
}
