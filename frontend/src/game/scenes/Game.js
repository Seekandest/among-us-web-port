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
        this.add.image(512, 384, 'background').setAlpha(0.5);
        // Set up keyboard inputs
        this.wKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.speed = 6;
        EventBus.emit('current-scene-ready', this);

        this.players = {};

        // Create player sprite
        this.player = this.add.sprite(512, 384, 'player', 'Walk0001.png');
        this.player.setScale(0.5, 0.5);
        this.player.clearTint();
        // Apply custom shader pipeline
        this.renderer.pipelines.add('ColorSwap', new ColorSwapPipeline(this.game));
        this.player.setPipeline('ColorSwap');
        this.player.pipeline.set3f('uColor', 1.0, 0.0, 0.0);
        this.player.setBlendMode(Phaser.BlendModes.OVERLAY);
        this.players["1"] = this.player;

        socket.on('player:moved', (data) => {
            console.log("player moved", data);
            if (!this.players[data.id]) return
            this.players[data.id].x = data.x;
            this.players[data.id].y = data.y;
        });


    }

    update(time, delta) {
        if (this.wKey.isDown) {this.player.y += this.speed;}
        if (this.aKey.isDown) {this.player.x -= this.speed;}
        if (this.sKey.isDown) {this.player.y -= this.speed;}
        if (this.dKey.isDown) {this.player.x += this.speed;}

        if (!this.wKey.isDown && !this.aKey.isDown && !this.sKey.isDown && !this.dKey.isDown) {
            this.player.anims.stop();
            this.player.setTexture('idleImage');
        } else {
            this.socket.emit('player:move', {id: "1", x: this.player.x, y: this.player.y});
            if (!this.player.anims.isPlaying) {
                this.player.anims.play('walk');
            }
        }
    }
}
