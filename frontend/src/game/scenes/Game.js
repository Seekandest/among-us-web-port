import { socketService } from "../../services/socket.js"
import { ColorSwapPipeline } from '../shaders/fragShader.js';
import { EventBus } from '../EventBus';
import { Scene } from 'phaser';

export class Game extends Scene {
    constructor() {
        super('Game');
    }
    preload() {
        this.load.atlas(
            'player',
            'assets/walk/texture.png',
            'assets/walk/texture.json'
        );
        this.load.image('idleImage', 'assets/sprites/Base/idle.png');
    }
    create() {
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
        const socket = socketService.getSocket();
        this.socket = socket


        this.cameras.main.setBackgroundColor(0x00ff00);
        // this.add.image(512, 384, 'background').setAlpha(0.5);
        // Set up keyboard inputs
        this.wKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.speed = 6;
        EventBus.emit('current-scene-ready', this);

        this.players = {};

        // Create player sprite
        // this.player = this.add.sprite(512, 384, 'player', 'Walk0001.png');
        // this.player.setScale(0.5, 0.5);
        // this.player.clearTint();
        // // Apply custom shader pipeline
        // this.renderer.pipelines.add('ColorSwap', new ColorSwapPipeline(this.game));
        // this.player.setPipeline('ColorSwap');
        // this.player.pipeline.set3f('uColor', 1.0, 0.0, 0.0);
        // this.player.setBlendMode(Phaser.BlendModes.OVERLAY);
        // this.players["1"] = this.player;

        const playerId = localStorage.getItem("playerId");
        console.log("Fetching room data for playerId:", playerId, "socket id:", socket.id);
        const data = fetch(`http://localhost:3001/player/room/${playerId}`)
            .then(response => response.json())
            .then(data => {
                console.log("room joined event received");
                console.log("room joined data:", data);
                this.room = data.room;
                console.log("Joined room:", data);
                this.player = this.add.sprite(data.player.state.x, data.player.state.y, 'player', 'Walk0001.png');
                this.playerObj = data.player;
                this.player.setScale(0.5, 0.5);
                this.players[data.player.id] = this.player;
                console.log("Created own player sprite:", this.player);
                console.log("Room players:", this.room.players);
                // Create sprites for existing players in the room

                Object.values(this.room.players).forEach((player) => {
                    if (player.id === this.playerObj.id) return; // Skip own player
                    console.log("Adding existing player:", player);
                    const otherPlayer = this.add.sprite(player.state.x, player.state.y, 'player', 'Walk0001.png');
                    otherPlayer.setScale(0.5, 0.5);
                    this.players[player.id] = otherPlayer;
                });})
            .catch(error => {
                console.error('Error fetching room data:', error);
            });


        socket.on('player:joined', (data) => {
            console.log("player joined", data);
            const newPlayer = this.add.sprite(data.player.state.x, data.player.state.y, 'player', 'Walk0001.png');
            newPlayer.setScale(0.5, 0.5);
            this.players[data.player.id] = newPlayer;
        });
        socket.on('player:moved', (data) => {
            console.log("player moved", data);
            if (!this.players[data.id]) return
            this.players[data.id].x = data.x;
            this.players[data.id].y = data.y;
        });
        socket.on('player:animation', (data) => {
            console.log("player animation", data, this.players);
            if (!this.players[data.id]) return
            const p = this.players[data.id];
            if (data.moving) {

                console.log(p)
                if (!p.anims.isPlaying) {
                    p.anims.play('walk');
                }
            } else {
                p.anims.stop();
                p.setTexture('idleImage');
            }
        });

    }

    update(time, delta) {
        if (!this.player) return;
        if (this.wKey.isDown) {this.player.y -= this.speed;}
        if (this.aKey.isDown) {this.player.x -= this.speed;}
        if (this.sKey.isDown) {this.player.y += this.speed;}
        if (this.dKey.isDown) {this.player.x += this.speed;}

        if (!this.wKey.isDown && !this.aKey.isDown && !this.sKey.isDown && !this.dKey.isDown) {
            if (this.player.anims.isPlaying) {
                this.socket.emit('player:animation', {id: this.playerObj.id, roomId: this.room.id, moving: false});
            }
        } else {
            this.socket.emit('player:move', {id: this.playerObj.id, x: this.player.x, y: this.player.y, roomId: this.room.id, d: this.playerObj.state.d});
            if (!this.player.anims.isPlaying) {
                console.log("Stopping walk");
                this.socket.emit('player:animation', {id: this.playerObj.id, roomId: this.room.id, moving: true});
            }
        }
    }
}
