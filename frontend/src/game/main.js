import Phaser from 'phaser';

// Expose Phaser globally for plugins that expect it (e.g., phaser3-rex-plugins)
window.Phaser = Phaser;

import ColorReplacePipelinePlugin from 'phaser3-rex-plugins/plugins/colorreplacepipeline-plugin.js';
import {Game} from './scenes/Game';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config = {
    type: Phaser.AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#028af8',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: [
        Game
    ],
    plugins: {
        global: [{
            key: 'rexColorReplacePipeline',
            plugin: ColorReplacePipelinePlugin,
            start: true
        }]
    }
};

const StartGame = (parent) => {

    return new Phaser.Game({...config, parent});

}

export default StartGame;
