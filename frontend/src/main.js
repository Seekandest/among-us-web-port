import Phaser from 'phaser';

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.dot = null;
    this.keys = null;
    this.speed = 240; // pixels per second
  }

  create() {
    const { width, height } = this.scale;

    this.dot = this.add.circle(width / 2, height / 2, 12, 0x00ff00);

    this.keys = this.input.keyboard.addKeys({
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });
  }

  update(_, delta) {
    const dt = delta / 1000;

    let dx = 0;
    let dy = 0;
    let speed = 5;
    if (this.keys.w.isDown || this.keys.up.isDown) dy -= speed;
    if (this.keys.s.isDown || this.keys.down.isDown) dy += speed;
    if (this.keys.a.isDown || this.keys.left.isDown) dx -= speed;
    if (this.keys.d.isDown || this.keys.right.isDown) dx += speed;

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;

      this.dot.x += dx * this.speed * dt;
      this.dot.y += dy * this.speed * dt;
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 800,
  height: 600,
  backgroundColor: '#111827',
  scene: [GameScene],
});
