import { Scene } from 'phaser';
import net from '../../services/net.js';
import { EventBus } from '../EventBus';
import { createPlayer } from '../utils/playerFactory.js';

// How often we send our position (see handleMovement):
const MOVE_SEND_INTERVAL_MS = 50;    // 20 per second while moving
const IDLE_SEND_INTERVAL_MS = 500;   // 2 per second while standing still (keeps the server's copy fresh)
// Smoothing of the OTHER players' sprites between two position updates:
const SMOOTHING = 0.3;               // each frame, move 30% of the remaining distance to the target
const SNAP_DISTANCE = 200;           // further than this: jump directly (teleport, spawn...)

/**
 * Base class for shared logic of player management, movement, and socket events
 */
export class BaseGameScene extends Scene {
    constructor(key) {
        super(key);
    }

    init(data) {
        this.config = data;
        this.roomId = data?.roomId || null;
    }

    /**
     * Override in child classes, will provide scene specific map configuration
     * @returns {{ mapKey: string, mapJSON: string, tilesetName: string, tilesetKey: string, backgroundKey: string, backgroundImage: string }}
     */
    getMapConfig() {
        throw new Error('getMapConfig() must be implemented by child class');
    }

    /**
     * Common assets
     */
    preloadCommon() {
        this.load.atlas(
            'player',
            'assets/walk/texture.png',
            'assets/walk/texture.json'
        );
        this.load.image('idleImage', 'assets/sprites/Base/idle.png');
    }

    /**
     * Load map specific assets based on getMapConfig()
     */
    preloadMap() {
        const config = this.getMapConfig();
        // TODO make it more dynamic to handle multiple tilesets
        this.load.image(config.tilesetKey, `assets/map/${config.tilesetKey}.png`);
        this.load.image(config.backgroundKey, `assets/map/${config.backgroundImage}`);
        this.load.tilemapTiledJSON(config.mapKey, `assets/map/${config.mapJSON}`);
    }

    createWalkAnimation() {
        if (this.anims.exists('walk')) return;

        this.anims.create({
            key: 'walk',
            frames: [
                { key: 'player', frame: 'Walk0001.png' },
                { key: 'player', frame: 'Walk0002.png' },
                { key: 'player', frame: 'Walk0003.png' },
                { key: 'player', frame: 'Walk0004.png' },
                { key: 'player', frame: 'Walk0005.png' },
                { key: 'player', frame: 'Walk0006.png' },
                { key: 'player', frame: 'Walk0007.png' },
                { key: 'player', frame: 'Walk0008.png' },
                { key: 'player', frame: 'Walk0009.png' },
                { key: 'player', frame: 'Walk0010.png' },
                { key: 'player', frame: 'Walk0011.png' },
                { key: 'player', frame: 'Walk0012.png' }
            ],
            frameRate: 12,
            repeat: -1
        });
    }

    /**
     * Setup tilemap and collision layer
     */
    setupMap() {
        const config = this.getMapConfig();

        const map = this.make.tilemap({ key: config.mapKey });
        const tileset = map.addTilesetImage(config.tilesetName, config.tilesetKey);
        const collisionLayer = map.createLayer('collisions', tileset, 0, 0);


        this.background = this.add.image(0, 0, config.backgroundKey).setOrigin(0, 0).setName('background');
        this.worldContainer.add(this.background);

        if (collisionLayer) {
            if (this.scene.key === 'WaitingLobby') {
                const scaleX = 1232 / (map.widthInPixels);
                const scaleY = 1008 / (map.heightInPixels);
                collisionLayer.setScale(scaleX, scaleY);
            }

            collisionLayer.setVisible(false);
            collisionLayer.setCollisionByExclusion([-1, 0]);
            this.collisionLayer = collisionLayer;
            this.worldContainer.add(collisionLayer);

            if (this.physics.config.debug) {
                collisionLayer.setVisible(true);
                collisionLayer.setAlpha(0.5);
                const debugGraphics = this.add.graphics().setAlpha(0.7);
                collisionLayer.renderDebug(debugGraphics, {
                    tileColor: null,
                    collidingTileColor: new Phaser.Display.Color(255, 0, 0, 128),
                    faceColor: new Phaser.Display.Color(0, 255, 0, 255)
                });
            }
        }

        return { map, tileset, collisionLayer };
    }

    /**
     * Setup keyboard inputs for movement
     */
    setupInput() {
        // TODO review input handling
        this.zKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
        this.qKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.mKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    }

    /**
     * Add a player sprite to the scene
     * @param {{ id: string, x: number, y: number, color: string }} playerData
     */
    addPlayer(playerData) {
        const newPlayer = createPlayer(this, playerData, {
            addCollision: true,
            collisionLayer: this.collisionLayer
        });
        newPlayer.id = playerData.id;
        newPlayer.alive = true;
        // Where the network says this player is; the sprite glides there (smoothRemotePlayers).
        newPlayer.targetX = playerData.x;
        newPlayer.targetY = playerData.y;

        // Scale up sprites for lobby scene to match smaller map size
        if (this.scene.key === 'WaitingLobby') {
            newPlayer.setScale(0.3);
        }

        this.players[playerData.id] = newPlayer;

        // Save spawn position
        if (!this.spawnPositions[playerData.id]) {
            this.spawnPositions[playerData.id] = { x: playerData.x, y: playerData.y };
        }

        return newPlayer;
    }

    /**
     * Remove a player sprite from the scene
     * @param {string} playerId
     */
    removePlayer(playerId) {
        if (!this.players[playerId]) return;
        if (this.sys && this.sys.displayList) {
            this.players[playerId].destroy();
        }
        delete this.players[playerId];
        console.log("Players Modified", this.players);
    }

    /**
     * Move a sprite instantly (teleport) AND make it its new smoothing target,
     * otherwise smoothRemotePlayers would slide it back to the old target.
     */
    setSpritePosition(sprite, x, y) {
        if (!sprite) return;
        if (sprite.body) sprite.body.reset(x, y);
        sprite.x = x;
        sprite.y = y;
        sprite.targetX = x;
        sprite.targetY = y;
    }

    /**
     * Positions arrive ~20 times per second (and in UDP some are lost), but the screen draws
     * 60 frames per second. Instead of jumping on each update, remote sprites glide toward the
     * last position received.
     */
    smoothRemotePlayers() {
        if (!this.players) return;
        for (const sprite of Object.values(this.players)) {
            if (sprite === this.player || !sprite.active || sprite.targetX === undefined) continue;
            const dx = sprite.targetX - sprite.x;
            const dy = sprite.targetY - sprite.y;
            if (Math.abs(dx) > SNAP_DISTANCE || Math.abs(dy) > SNAP_DISTANCE) {
                sprite.x = sprite.targetX;
                sprite.y = sprite.targetY;
            } else {
                sprite.x += dx * SMOOTHING;
                sprite.y += dy * SMOOTHING;
            }
        }
    }

    /**
     * Ask the server for the room and set up the players (replaces the old HTTP GET /player/room/:id).
     */
    async fetchAndSetupPlayers() {
        let data;
        try {
            data = await net.request('room:get', {}, 'room:state');
        } catch (err) {
            console.error("Could not get the room from the server:", err);
            return;
        }

        console.log("room joined data:", data);

        if (!this.sys || !this.sys.displayList) return;
        if (!data?.room || !data?.player) {
            console.error("Invalid room payload:", data);
            return;
        }

        this.room = data.room;
        this.player = this.addPlayer({
            id: data.player.id,
            x: data.player.state.x,
            y: data.player.state.y,
            color: data.player.color
        });
        this.playerObj = data.player;
        console.log("Created own player sprite:", this.player, this.players);

        // Set camera zoom based on scene type
        const zoom = this.scene.key === 'WaitingLobby' ? 1 : 3;

        this.cameras.main.setZoom(zoom);
        this.cameras.main.startFollow(this.player, true);
        this.cameras.main.ignore(this.ui);

        // Add existing players in the room
        Object.values(this.room.players).forEach((player) => {
            if (player.id === this.playerObj.id) return;
            console.log("Adding existing player:", player);
            this.addPlayer({
                id: player.id,
                x: player.state.x,
                y: player.state.y,
                color: player.color
            });
        });
    }

    /**
     * Listen to the server's player events (through services/net.js)
     */
    setupNetListeners() {
        // Prevent registering the same handlers multiple times
        if (this._netListenersAdded) return;

        // named handlers so they can be removed later
        this._onPlayerJoined = (data) => {
            console.log("player joined", data);
            if (!this.sys || !this.sys.displayList) return;
            this.addPlayer({
                id: data.player.id,
                x: data.player.state.x,
                y: data.player.state.y,
                color: data.player.color
            });
        };

        this._onPlayerLeft = (data) => {
            console.log("player left", data);
            this.removePlayer(data.playerId);
        };

        // Another player's position. Our own position comes back only when the server
        // rejected a move (too fast, or outside the map): snap to the position it kept.
        this._onPlayerMoved = (data) => {
            if (data.id === this.playerObj?.id) {
                if (data.corrected && this.player) this.setSpritePosition(this.player, data.x, data.y);
                return;
            }
            if (!this.players) return;
            const player = this.players[data.id];
            if (!player || !player.alive || !player.active) return;

            // Don't jump there: store it as the target, smoothRemotePlayers() glides toward it.
            player.targetX = data.x;
            player.targetY = data.y;

            if (data.d) player.flipX = data.d === 'left';

            if (!player.anims) return;
            if (data.moving) {
                if (!player.anims.isPlaying) player.anims.play('walk');
            } else if (player.anims.isPlaying) {
                player.anims.stop();
                player.setTexture('idleImage');
            }
        };

        net.on('player:joined', this._onPlayerJoined);
        net.on('player:left', this._onPlayerLeft);
        net.on('player:moved', this._onPlayerMoved);

        this._netListenersAdded = true;
    }

    /**
     * Remove our network listeners
     */
    cleanupNetListeners() {
        if (!this._netListenersAdded) return;
        // Remove only the handlers we added
        if (this._onPlayerJoined) net.off('player:joined', this._onPlayerJoined);
        if (this._onPlayerLeft) net.off('player:left', this._onPlayerLeft);
        if (this._onPlayerMoved) net.off('player:moved', this._onPlayerMoved);

        // clear refs
        this._onPlayerJoined = null;
        this._onPlayerLeft = null;
        this._onPlayerMoved = null;
        this._netListenersAdded = false;
    }

    /**
     * Common create logic for all game scenes
     */
    async createCommon() {
        // Phaser never calls a shutdown() method by itself: it emits 'shutdown' (scene stopped or
        // replaced) and 'destroy' (game destroyed). Without this, our network listeners would stay
        // registered and keep updating sprites of a dead scene.
        this._cleanedUp = false;
        this.lastMoveSentAt = undefined;
        this.wasMoving = false;
        this.events.once('shutdown', () => this.cleanup());
        this.events.once('destroy', () => this.cleanup());

        this.ui = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);
        this.worldContainer = this.add.container(0, 0).setDepth(0);
        this.players = {};
        this.spawnPositions = {};
        // Track spawn positions for each player
        const uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        uiCam.setScroll(0, 0);
        uiCam.setZoom(1);
        uiCam.ignore(this.worldContainer);

        this.cameras.main.ignore(this.ui);

        this.createWalkAnimation();
        this.setupMap();
        this.setupInput();
        this.setupNetListeners();
        await this.fetchAndSetupPlayers();
        console.log("Finished Setting Up Players: ", this.player);
        EventBus.emit('current-scene-ready', this);
    }

    /**
     * Handle player movement (call in update)
     */
    handleMovement() {
        this.smoothRemotePlayers();
        if (!this.player || !this.player.body) return;

        // Disable movement during meeting
        if (this.meetingActive) {
            this.player.body.setVelocity(0, 0);
            if (this.player.anims.isPlaying) {
                this.player.anims.stop();
                this.player.setTexture('idleImage');
            }
            if (this.wasMoving) this.sendPosition(false); // tell the others we stopped
            return;
        }

        // Reset velocity each frame
        this.player.body.setVelocity(0, 0);

        const speed = this.scene.key === 'WaitingLobby' ? 350 : 100;
        let vx = 0;
        let vy = 0;

        if (this.zKey.isDown) { vy = -speed; }
        if (this.sKey.isDown) { vy = speed; }
        if (this.qKey.isDown) { vx = -speed; this.playerObj.state.d = 'left'; }
        if (this.dKey.isDown) { vx = speed; this.playerObj.state.d = 'right'; }

        // Normalize diagonal movement
        if (vx !== 0 && vy !== 0) {
            vx *= 0.707;
            vy *= 0.707;
        }

        // Local Player Movement
        if (this.player.alive) {
            this.player.body.setVelocity(vx, vy);
            if (vx < 0) this.player.flipX = true;
            else if (vx > 0) this.player.flipX = false;
        }


        const isMoving = vx !== 0 || vy !== 0;
        if (isMoving) {
            if (!this.player.anims.isPlaying) {
                this.player.anims.play('walk');
            }
        } else {
            if (this.player.anims.isPlaying) {
                this.player.anims.stop();
                this.player.setTexture('idleImage');
            }
        }

        // Send our position to the server, at a controlled rate instead of every frame (60/s):
        //   - immediately when we start or stop moving (so the others see it at once),
        //   - every 50 ms (20/s) while moving,
        //   - every 500 ms while standing still (the server uses our position for kill range).
        // In the UDP version these are unreliable FAST datagrams: a lost one is simply replaced
        // by the next one 50 ms later.
        const startedOrStopped = isMoving !== this.wasMoving;
        const interval = isMoving ? MOVE_SEND_INTERVAL_MS : IDLE_SEND_INTERVAL_MS;
        const due = this.lastMoveSentAt === undefined || this.time.now - this.lastMoveSentAt >= interval;
        if (startedOrStopped || due) this.sendPosition(isMoving);
    }

    /**
     * One player:move message. No id / roomId inside: the server knows who we are from our
     * connection (TCP socket / UDP address), and refuses to let us move someone else.
     */
    sendPosition(isMoving) {
        if (!this.room || !this.player || !this.playerObj) return;
        net.emit('player:move', {
            x: Math.round(this.player.x),
            y: Math.round(this.player.y),
            d: this.playerObj.state.d,
            moving: isMoving
        });
        this.lastMoveSentAt = this.time.now;
        this.wasMoving = isMoving;
    }

    /**
     * Idempotent cleanup, run on the scene's 'shutdown' and 'destroy' events.
     * Subclasses extend it (and call super.cleanup()).
     */
    cleanup() {
        if (this._cleanedUp) return;
        this._cleanedUp = true;
        this.cleanupNetListeners();
    }
}
