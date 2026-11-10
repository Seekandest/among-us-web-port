import { BaseGameScene } from './BaseGameScene.js';
import { GrayPipeline, VisionRadiusPipeline } from "../shaders/fragShader.js";
import net from '../../services/net.js';
import { setPlayerColor } from "../utils/playerFactory.js";
import {EventBus} from "../EventBus.js";
import { handleImposter, handleImposterMovement } from "../utils/imposter.js";
import { setupVisionSystem, disableVisionSystem, updateVisionSystem, enableVisionSystem} from "../utils/vision.js";

export class Game extends BaseGameScene {

    // ====== CONFIGURATION AND INITIALIZATION ======
    constructor() {
        super('Game');
    }

    /**
     * Initialize scene with data from previous scene
     * @param {Object} data - Scene initialization data
     * @param {boolean} data.isImposter - Whether the local player is the imposter
     */
    init(data) {
        // TODO: Refactor to use player.isImposter instead of promise pattern
        console.log('Game scene init with data:', data);
        this.imposterProm = data.isImposter;
    }

    /**
     * Game-specific map configuration
     * @returns {Object} Map configuration object
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

    setupMeetingZone() {
        this.meetingZone = this.physics.add.sprite(530, 100);
        if (this.meetingZone.body) {
            this.meetingZone.body.setCircle(50);
            this.meetingZone.body.setAllowGravity(false);
            this.meetingZone.visible = false;
        }
        this.meetingBtn = this.add.image(220, 410, 'meeting')
            .setScale(0.7)
            .setDepth(1000)
            .setScrollFactor(0)
            .setInteractive()
            .on('pointerdown', () => {
                this.startMeeting();
            });
        this.ui.add(this.meetingBtn);
    }

    // ====== PHASER LIFECYCLE METHODS ======
    /**
     * Preload game assets
     */
    preload() {
        this.preloadCommon();
        this.preloadMap();
        this.load.image('kill', 'assets/icons/kill_icon.png');
        this.load.atlas('death', 'assets/death/texture.png', 'assets/death/texture.json');
        this.load.image('deadBody', 'assets/sprites/Base/Dead0042.png');
        this.load.image('meeting', '/assets/icons/useIcon.png');
    }

    /**
     * Create scene objects and initialize game state
     */
    create() {
        // stored promise for imposter role assignment
        const prom1 = this.createCommon();
        this.input.on('pointerdown', (pointer) => {
            console.log(
                'screen:', pointer.x, pointer.y,
                'world:', pointer.worldX, pointer.worldY
            );
        });

        this.game.renderer.pipelines.add('GrayScale', new GrayPipeline(this.game));
        this.game.renderer.pipelines.add('VisionRadius', new VisionRadiusPipeline(this.game));

        this.closest = { player: null, distance: 60 };

        this.VISION_RADIUS = 100;
        this.visionEnabled = true;
        this.mapObjects = [];

        this.createAnimations();
        this.handleGameEvents();

        // Wait for both player setup and imposter role assignment before initializing imposter mechanics
        Promise.all([prom1, this.imposterProm]).then((results) => {
            console.log("Creating imposter elements", prom1, this.imposterProm, results);
            this.imposter = results[1];
            handleImposter(this);
            setupVisionSystem(this);
            this.setupMeetingZone();
            this.isInMeetingZone = false;
        });
    }

    /**
     * Update game state every frame
     * @param {number} time - Total elapsed time in milliseconds
     * @param {number} delta - Time elapsed since last frame in milliseconds
     */
    update(time, delta) {
        if (!this.player) return;

        this.handleMovement();
        handleImposterMovement(this);

        // Update vision system
        if (this.visionEnabled && this.player) {
            updateVisionSystem(this);
        }

        if (this.physics.overlap(this.player, this.meetingZone)) {
            if (!this.isInMeetingZone) {
                this.isInMeetingZone = true;
                this.meetingBtn.visible = true;
            }
        } else if (this.isInMeetingZone) {
            this.isInMeetingZone = false;
            this.meetingBtn.visible = false;
        }
    }

    /**
     * Clean up network listeners. Runs once on the scene's 'shutdown' / 'destroy' events
     * (registered in BaseGameScene.createCommon).
     */
    cleanup() {
        if (this.onPlayerKilled) {
            net.off('player:killed', this.onPlayerKilled);
            this.onPlayerKilled = null;
        }
        if (this.onMeetingStarted) {
            net.off('meeting:started', this.onMeetingStarted);
            this.onMeetingStarted = null;
        }
        if (this.onMeetingEnded) {
            net.off('meeting:ended', this.onMeetingEnded);
            this.onMeetingEnded = null;
        }
        if (this.onGameEnd) {
            net.off('game:ended', this.onGameEnd);   // was 'game:end' by mistake: the handler was never removed
            this.onGameEnd = null;
        }
        super.cleanup();
    }

    // ANIMATION SETUP
    /**
     * Create death animation for killed players
     */
    createAnimations() {
        this.anims.create({
            key: 'deathAnim',
            frames: this.anims.generateFrameNames('death', {
                prefix: 'Dead',
                start: 0,
                end: 42,
                zeroPad: 4
            }),
            frameRate: 20,
            repeat: 0
        });
    }

    // EVENT HANDLERS
    /**
     * Register network handlers (services/net.js) for multiplayer game events
     */
    handleGameEvents() {
        // The server validated the kill (role, distance, cooldown) before broadcasting it.
        this.onPlayerKilled = (data) => {
            console.log("Player killed event received:", data);

            // Normalize player IDs to strings for comparison
            const targetId = String(data.playerId);
            const localId = this.playerObj?.id ?? this.player?.id;

            const killedPlayer = (targetId === String(localId)) ? this.player : this.players[targetId];

            // Move the killer sprite onto the body, on every client (including the killer's own).
            const killerId = data.killerId ? String(data.killerId) : null;
            if (killerId) {
                const killerSprite = (killerId === String(localId)) ? this.player : this.players[killerId];
                if (killerSprite && killerSprite !== killedPlayer) {
                    this.setSpritePosition(killerSprite, data.x, data.y);
                }
            }

            if (killedPlayer) {
                killedPlayer.alive = false;
                if (killedPlayer.destroy) killedPlayer.destroy();
            }
            // The body gets the VICTIM's color, sent by the server (data.color).

            const deathAnim = this.add.sprite(data.x, data.y, 'death', 'Dead0001.png')
                .setScale(0.125)
                .setDepth(600);
            setPlayerColor(this, deathAnim, data.color);
            deathAnim.anims.play('deathAnim');
            deathAnim.on('animationcomplete', () => {
                this.add.sprite(deathAnim.x, deathAnim.y, 'deadBody')
                    .setScale(0.125)
                    .setDepth(500);
                deathAnim.destroy();
            });
        };

        this.onMeetingStarted = (data) => {
            console.log("Meeting started event received:", data);
            this.meetingActive = true;
            this.physics.pause(); // Pause physics
            disableVisionSystem(this);
            // The server sends the ALIVE players (keyed by id) and the meeting length.
            const players = Array.isArray(data.players)
                ? Object.fromEntries(data.players.map(p => [p.id, p]))
                : (data.players || {});
            // Recieved by react
            EventBus.emit('meeting:started', {
                roomId: this.room?.id,
                callerId: data.callerId,
                players,
                durationMs: data.durationMs
            });
        };

        this.onMeetingEnded = (data) => {
            console.log("Meeting ended event received:", data);
            this.meetingActive = false;
            this.physics.resume();
            enableVisionSystem(this);
            this.teleportPlayersToSpawn();

            const ejectedId = data.results?.ejectedId;
            if (ejectedId) {
                const name = this.room?.players?.[ejectedId]?.name || 'A player';
                if (ejectedId === this.playerObj?.id) {
                    // We were voted out: we stay on the map as a ghost.
                    if (this.player) {
                        this.player.alive = false;
                        this.player.setAlpha(0.4);
                    }
                } else {
                    this.removePlayer(ejectedId);
                }
                window.showToast?.(`${name} was ejected`, 'info', 3000);
            } else {
                window.showToast?.('Nobody was ejected', 'info', 3000);
            }

            // Recieved by react
            EventBus.emit('meeting:ended', {
                results: data.results
            });
        };
        this.onGameEnd = (data) => {
            console.log("game end event received:", data);
            EventBus.emit("game:ended", data);
            if (this.scene && typeof this.scene.isActive === 'function' && this.scene.isActive('Game')) {
                this.scene.stop('Game');
            }
        };

        net.on('player:killed', this.onPlayerKilled);
        net.on('meeting:started', this.onMeetingStarted);
        net.on('meeting:ended', this.onMeetingEnded);
        net.on('game:ended', this.onGameEnd);
    }

    // MEETING MECHANICS
    /**
     * Ask the server for an emergency meeting (meeting button)
     */
    startMeeting() {
        if (!this.playerObj || !this.room) return;

        console.log('Starting meeting...');
        // The server knows who calls it (our session) and checks the rules (alive, once per game...).
        net.emit('meeting:start', {});
    }

    /**
     * Teleport all players back to their spawn positions
     */
    teleportPlayersToSpawn() {
        // Teleport local player
        if (this.player && this.player.active && this.spawnPositions[this.playerObj.id]) {
            const spawn = this.spawnPositions[this.playerObj.id];
            this.setSpritePosition(this.player, spawn.x, spawn.y);
        }

        // Teleport remote players (setSpritePosition also moves their smoothing target)
        Object.keys(this.players).forEach(playerId => {
            const player = this.players[playerId];
            if (player && player.active && this.spawnPositions[playerId] && player !== this.player) {
                const spawn = this.spawnPositions[playerId];
                this.setSpritePosition(player, spawn.x, spawn.y);
            }
        });
    }
}
