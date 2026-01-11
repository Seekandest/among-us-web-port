import {EventBus} from '../EventBus';
import {Scene} from 'phaser';

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

        this.cameras.main.setBackgroundColor(0x00ff00);
        this.add.image(512, 384, 'background').setAlpha(0.5);
        this.wKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.aKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
        this.dKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
        this.speed = 6; // pixels per second

        EventBus.emit('current-scene-ready', this);
        this.player = this.add.sprite(512, 384, 'player', 'Walk0001.png');
        this.player.setScale(0.5, 0.5);
        this.player.play('walk');
        this.player.setTint()
        this.player.clearTint();

        this.player.setTint(0x0000ff);

    }

    update(time, delta) {
        this.player.setBlendMode(Phaser.BlendModes.OVERLAY);
        if (this.wKey.isDown) {
            this.player.y -= this.speed;
        }
        if (this.aKey.isDown) {
            this.player.x -= this.speed;
        }
        if (this.sKey.isDown) {
            this.player.y += this.speed;
        }
        if (this.dKey.isDown) {
            this.player.x += this.speed;
        }
    }
}
