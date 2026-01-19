import { socketService } from "../../services/socket.js"
import { ColorSwapPipeline } from '../shaders/fragShader.js';
import { EventBus } from '../EventBus';
import { Scene } from 'phaser';

export class Game extends Scene {
    constructor() {
        super('Game');
    }
    init(config) {
        this.config = config;
    }
    preload() {

        this.load.atlas(
            'player',
            'assets/walk/texture.png',
            'assets/walk/texture.json'
        );
        this.load.image('idleImage', 'assets/sprites/Base/idle.png');
        this.load.image('skled', 'assets/map/skled.png');
        this.load.image('red', 'assets/map/red.png');
        this.load.tilemapTiledJSON('mapJSON', 'assets/map/map.json');
    }
    /**
     * color is a hex string like "#ff0000"
     * @param sprite
     * @param { string } color
     */
    setColor (sprite, color) {
        console.log(color)
        const rgb = Phaser.Display.Color.HexStringToColor(color);
        const r = rgb.red / 255;
        const g = rgb.green / 255;
        const b = rgb.blue / 255;
        sprite.clearTint();
        // Use unique pipeline name per sprite
        const pipelineName = `ColorSwap_${Date.now()}_${Math.random()}`;
        this.renderer.pipelines.add(pipelineName, new ColorSwapPipeline(this.game));
        sprite.setPipeline(pipelineName);
        sprite.pipeline.set3f('uColor', r, g, b);
        sprite.setBlendMode(Phaser.BlendModes.OVERLAY);

    }

    /**
     *
     * @param {id, x, y, color} playerData
     */
    addPlayer(playerData) {
        const newPlayer = this.physics.add.sprite(playerData.x, playerData.y, 'player', 'Walk0001.png');
        this.physics.add.collider(newPlayer, this.collisionLayer);
        newPlayer.setScale(0.125, 0.125); // 75% smaller
        newPlayer.body.setSize(newPlayer.width * 0.4, newPlayer.height * 0.6);
        newPlayer.body.setOffset(newPlayer.width * 0.3, newPlayer.height * 0.2);
        this.players[playerData.id] = newPlayer;
        this.setColor(newPlayer, playerData.color);
        console.log("Players Modified", this.players);
        return newPlayer;
    }

    create() {
        // Walk animation
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

        // Load the tilemap and tileset
        const map = this.make.tilemap({ key: 'mapJSON' });
        const tileset = map.addTilesetImage('red', 'red');

        const collisionLayer = map.createLayer('collisions', tileset, 0, 0); // collision layer
        this.add.image(0, 0, 'skled').setOrigin(0, 0);

        collisionLayer.setCollisionByExclusion([-1, 0]);
        this.collisionLayer = collisionLayer;

        if (collisionLayer && this.physics.config.debug) {
            collisionLayer.setVisible(true);
            collisionLayer.setAlpha(0.5);
            const debugGraphics = this.add.graphics().setAlpha(0.7);
            collisionLayer.renderDebug(debugGraphics, {
                tileColor: null,
                collidingTileColor: new Phaser.Display.Color(255, 0, 0, 128),
                faceColor: new Phaser.Display.Color(0, 255, 0, 255)
            });
        }


        const socket = socketService.getSocket();
        this.socket = socket


        // this.add.image(512, 384, 'background').setAlpha(0.5);
        // Set up keyboard inputs
        this.wKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        EventBus.emit('current-scene-ready', this);

        this.players = {};
        // TODO coords are not synced with backend so on join initial render renders everyone at one place
        const playerId = localStorage.getItem("playerId");
        console.log("Fetching room data for playerId:", playerId, "socket id:", socket.id);
        fetch(`http://localhost:3001/player/room/${playerId}`)
            .then(response => response.json())
            .then(data => {
                console.log("room joined event received");
                console.log("room joined data:", data);
                if (!this.sys || !this.sys.displayList) return; // Scene not ready or destroyed
                this.room = data.room;
                this.player = this.addPlayer({id: data.player.id, x: data.player.state.x, y: data.player.state.y, color: data.player.color});
                this.playerObj = data.player;
                console.log("Created own player sprite:", this.player, this.players);

                // Set camera zoom and follow player
                this.cameras.main.setZoom(3);
                this.cameras.main.startFollow(this.player, true);


                Object.values(this.room.players).forEach((player) => {
                    if (player.id === this.playerObj.id) return;
                    console.log("Adding existing player:", player);
                    this.addPlayer({id: player.id, x: player.state.x, y: player.state.y, color: player.color});
                });})
            .catch(error => {
                console.error('Error fetching room data:', error);
            });

        const playerJoined = (data) => {
            console.log("player joined", data);
            if (!this.sys || !this.sys.displayList) return; // Scene not ready or destroyed
            this.addPlayer({id: data.player.id, x: data.player.state.x, y: data.player.state.y, color: data.player.color});
        }
        const playerLeft = (data) => {
            console.log("player left", data);
            if (!this.players[data.playerId]) return;
            if (this.sys && this.sys.displayList) {
                this.players[data.playerId].destroy();
            }
            delete this.players[data.playerId];
            console.log("Players Modified", this.players);
        }
        const playerMoved = (data) => {
            const player = this.players[data.id];
            if (!player) return;

            if (data.id !== this.playerObj?.id) {
                player.x = data.x;
                player.y = data.y;
            }

            if (data.d) player.flipX = data.d === 'left';

            if (!player.anims) return;
            if (data.moving) {
                if (!player.anims.isPlaying) player.anims.play('walk');
            } else {
                player.anims.stop();
                player.setTexture('idleImage');
            }
        }
        socket.on('player:joined', playerJoined);
        socket.on('player:left', playerLeft);
        socket.on('player:moved', playerMoved);
    }

    update(time, delta) {
        if (!this.player || !this.player.body) return;

        // Reset velocity each frame
        this.player.body.setVelocity(0, 0);

        const speed = 150;
        let vx = 0;
        let vy = 0;

        if (this.wKey.isDown) { vy = -speed; }
        if (this.sKey.isDown) { vy = speed; }
        if (this.aKey.isDown) { vx = -speed; this.playerObj.state.d = 'left'; }
        if (this.dKey.isDown) { vx = speed; this.playerObj.state.d = 'right'; }

        // Normalize diagonal movement
        if (vx !== 0 && vy !== 0) {
            vx *= 0.707;
            vy *= 0.707;
        }
        // Local Player Movement
        this.player.body.setVelocity(vx, vy);
        if (vx < 0) this.player.flipX = true;
        else if (vx > 0) this.player.flipX = false;
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

        // This ensures collision corrected position is sent
        if (isMoving || this.wasMoving) {
            this.time.delayedCall(0, () => {
                if (!this.player) return;
                this.socket.emit('player:move', {
                    id: this.playerObj.id,
                    x: this.player.x,
                    y: this.player.y,
                    roomId: this.room.id,
                    d: this.playerObj.state.d,
                    moving: isMoving
                });
            });
        }
        this.wasMoving = isMoving;
    }

    shutdown() {
        if (this.socket) {
            this.socket.off('player:joined');
            this.socket.off('player:left');
            this.socket.off('player:moved');
            this.socket.off('player:animation');
        }
    }
}
