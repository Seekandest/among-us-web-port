const fragShader = `
        precision mediump float;
        uniform sampler2D uMainSampler;
        varying vec2 outTexCoord;
        uniform vec3 uColor;

        void main() {
            vec4 textureColor = texture2D(uMainSampler, outTexCoord);

            // 1. CHECK FOR RED (The Main Body)
            if (textureColor.r > 0.4 && textureColor.g < 0.4 && textureColor.b < 0.4) {
                // Replace with chosen color
                gl_FragColor = vec4(uColor * textureColor.r, textureColor.a);
            }
            // 2. CHECK FOR BLUE (The Shadow/Legs)
            else if (textureColor.b > 0.4 && textureColor.r < 0.4 && textureColor.g < 0.4) {
                // Replace with the SAME chosen color, but Darker (multiply by 0.5)
                vec3 shadowColor = uColor * 0.5;
                gl_FragColor = vec4(shadowColor * textureColor.b, textureColor.a);
            }
            // 3. EVERYTHING ELSE (Visor, Outline)
            else {
                gl_FragColor = textureColor;
            }
        }
    `;
// 2. Register the Pipeline (We give it a name 'ColorSwap')
const ColorSwapPipeline = new Phaser.Class({
    Extends: Phaser.Renderer.WebGL.Pipelines.SinglePipeline,
    initialize: function (game) {
        Phaser.Renderer.WebGL.Pipelines.SinglePipeline.call(this, {
            game: game,
            fragShader: fragShader,
            // SinglePipeline expects an array of uniform names in recent Phaser versions
            uniforms: ['uColor'] // We will control this variable
        });
    }
});
export { ColorSwapPipeline };
