import net from "../../services/net.js";

// Vents: the imposter can hide in a vent, travel to a linked vent, and come out.
//
// The SERVER decides everything (role, alive, distance from ITS copy of our position, links,
// cooldown, meetings). This file only draws the vents, offers the buttons/keys, sends requests
// (vent:enter / vent:move / vent:exit) and shows what the server answers:
//   vent:entered {playerId, ventId}            to the whole room   -> hide that player
//   vent:moved   {playerId, fromVentId, toVentId}  to the venting player only
//   vent:exited  {playerId, ventId, x, y}      to the whole room   -> show that player at (x, y)
// The vent list comes from the server in game:started (scene.vents): nothing is hard-coded here.
// Hiding is done by rendering (like the fog of war): sprite.inVent marks a hidden sprite, and
// utils/vision.js keeps it hidden.

const VENT_SCALE = 0.12;            // Vent0001.png is 129x192 px -> about 15x23 px on the map
const VENT_FRAMES = 7;              // Vent0001.png ... Vent0007.png (open / close animation)

/** Preload the 7 vent frames (call from the scene's preload()). */
export function preloadVents(scene) {
    for (let i = 1; i <= VENT_FRAMES; i++) {
        scene.load.image(`vent${i}`, `assets/sprites/Base/Vent000${i}.png`);
    }
}

/**
 * Draw the vents and register the network handlers. Call once in create(), after createCommon()
 * has created worldContainer / background (they exist before its first await).
 */
export function setupVents(scene) {
    scene.ventSprites = {};
    scene.inVent = null;                         // our own vent id while hidden, else null

    if (!scene.anims.exists('ventAnim')) {
        scene.anims.create({
            key: 'ventAnim',
            frames: Array.from({ length: VENT_FRAMES }, (_, i) => ({ key: `vent${i + 1}` })),
            frameRate: 14,
            repeat: 0,
        });
    }

    for (const v of scene.vents || []) {
        const sprite = scene.add.sprite(v.x, v.y, 'vent1').setScale(VENT_SCALE);
        sprite.on('animationcomplete', () => sprite.setTexture('vent1'));   // back to "closed"
        // In the world container (NOT directly in the scene): the fixed UI camera ignores it, so the
        // vent is drawn once, and it sits just above the map background, under the players.
        const index = scene.background ? scene.worldContainer.getIndex(scene.background) + 1 : 0;
        scene.worldContainer.addAt(sprite, index);
        scene.ventSprites[v.id] = sprite;
    }

    scene.onVentEntered = (data) => {
        const sprite = spriteOf(scene, data.playerId);
        playVent(scene, data.ventId);
        if (!sprite) return;
        sprite.inVent = data.ventId;
        sprite.setVisible(false);
        if (sprite.anims) sprite.anims.stop();
        if (data.playerId === scene.playerObj?.id) {
            scene.inVent = data.ventId;
            const v = ventById(scene, data.ventId);
            if (v) scene.setSpritePosition(sprite, v.x, v.y);   // camera stays on the vent
            showArrows(scene);
        }
    };

    // Only we receive this (the others must not learn where we went). The new position is in the
    // message itself: it is reliable in the UDP version (the extra correction message is not).
    scene.onVentMoved = (data) => {
        if (data.playerId !== scene.playerObj?.id) return;
        scene.inVent = data.toVentId;
        if (scene.player) {
            scene.player.inVent = data.toVentId;
            const v = ventById(scene, data.toVentId);
            const x = Number.isFinite(data.x) ? data.x : v?.x;
            const y = Number.isFinite(data.y) ? data.y : v?.y;
            if (Number.isFinite(x) && Number.isFinite(y)) scene.setSpritePosition(scene.player, x, y);
        }
        showArrows(scene);
    };

    scene.onVentExited = (data) => {
        const sprite = spriteOf(scene, data.playerId);
        playVent(scene, data.ventId);
        if (!sprite || !sprite.active) return;
        sprite.inVent = null;
        scene.setSpritePosition(sprite, data.x, data.y);
        // Our own sprite reappears; a remote one is shown by the fog of war if it is in our vision radius.
        if (data.playerId === scene.playerObj?.id) {
            scene.inVent = null;
            sprite.setVisible(true);
            hideArrows(scene);
        }
    };

    net.on('vent:entered', scene.onVentEntered);
    net.on('vent:moved', scene.onVentMoved);
    net.on('vent:exited', scene.onVentExited);

    // Keys (Phaser key objects belong to the scene and are removed with it: no listener leak).
    scene.ventKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V);
    scene.ventLeftKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    scene.ventRightKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    scene.ventArrows = [];
}

/** Imposter only: the VENT button (next to the kill button). Call after handleImposter(). */
export function setupVentButton(scene) {
    if (!scene.imposter) return;
    scene.ventBtn = scene.add.image(690, 410, 'vent1')
        .setScale(0.45)
        .setDepth(1000)
        .setScrollFactor(0)
        .setInteractive()
        .on('pointerdown', () => toggleVent(scene));
    scene.ventBtnLabel = scene.add.text(690, 470, 'VENT (V)', {
        fontFamily: 'Arial', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    scene.ui.add([scene.ventBtn, scene.ventBtnLabel]);
    setVentButtonVisible(scene, false);
}

/** Every frame (Game.update): button visibility, keys, and hiding the kill button while hidden. */
export function updateVents(scene) {
    if (!scene.imposter || !scene.ventBtn || !scene.player) return;

    const canAct = scene.player.alive && !scene.meetingActive;
    if (scene.inVent) {
        setVentButtonVisible(scene, canAct);       // the button now means "exit"
        if (scene.killBtn) scene.killBtn.visible = false;
        if (scene.meetingBtn) scene.meetingBtn.visible = false;
    } else {
        setVentButtonVisible(scene, canAct && Boolean(nearestVent(scene)));
        if (scene.killBtn) scene.killBtn.visible = true;
    }

    if (!canAct) return;
    if (Phaser.Input.Keyboard.JustDown(scene.ventKey)) toggleVent(scene);
    if (scene.inVent) {
        const links = ventById(scene, scene.inVent)?.links || [];
        if (links.length && Phaser.Input.Keyboard.JustDown(scene.ventLeftKey)) moveTo(links[0]);
        if (links.length && Phaser.Input.Keyboard.JustDown(scene.ventRightKey)) moveTo(links[links.length - 1]);
    }
}

/** Remove the network handlers (called from Game.cleanup, on 'shutdown' / 'destroy'). */
export function cleanupVents(scene) {
    if (scene.onVentEntered) net.off('vent:entered', scene.onVentEntered);
    if (scene.onVentMoved) net.off('vent:moved', scene.onVentMoved);
    if (scene.onVentExited) net.off('vent:exited', scene.onVentExited);
    scene.onVentEntered = scene.onVentMoved = scene.onVentExited = null;
}

// ---- helpers ------------------------------------------------------------------------------------

function ventById(scene, id) {
    return (scene.vents || []).find((v) => v.id === id) || null;
}

function spriteOf(scene, playerId) {
    return playerId === scene.playerObj?.id ? scene.player : scene.players?.[playerId];
}

/** The closest vent within the server's range (sent in game:started), or null. */
function nearestVent(scene) {
    const range = scene.ventRangePx || 40;
    let best = null;
    for (const v of scene.vents || []) {
        const d = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, v.x, v.y);
        if (d <= range && (!best || d < best.d)) best = { v, d };
    }
    return best ? best.v : null;
}

/** V key / VENT button: enter the nearest vent, or come out of the current one. Only a request. */
function toggleVent(scene) {
    if (scene.inVent) {
        net.emit('vent:exit', {});
    } else {
        const v = nearestVent(scene);
        if (v) net.emit('vent:enter', { ventId: v.id });
    }
}

function moveTo(ventId) {
    net.emit('vent:move', { toVentId: ventId });
}

function playVent(scene, ventId) {
    const sprite = scene.ventSprites?.[ventId];
    if (sprite && sprite.anims) sprite.play('ventAnim');
}

function setVentButtonVisible(scene, visible) {
    if (scene.ventBtn) scene.ventBtn.visible = visible;
    if (scene.ventBtnLabel) {
        scene.ventBtnLabel.visible = visible;
        scene.ventBtnLabel.setText(scene.inVent ? 'EXIT (V)' : 'VENT (V)');
    }
}

/**
 * While hidden: one arrow per linked vent, around the screen center (where the camera keeps us),
 * pointing in the direction of that vent. Click an arrow (or Left / Right) to travel.
 */
function showArrows(scene) {
    hideArrows(scene);
    const here = ventById(scene, scene.inVent);
    if (!here) return;
    const cx = scene.scale.width / 2;
    const cy = scene.scale.height / 2;
    for (const id of here.links) {
        const to = ventById(scene, id);
        if (!to) continue;
        const angle = Math.atan2(to.y - here.y, to.x - here.x);
        const arrow = scene.add.text(cx + Math.cos(angle) * 110, cy + Math.sin(angle) * 110, '➤', {
            fontFamily: 'Arial', fontSize: '44px', color: '#ff4d4d', stroke: '#000000', strokeThickness: 5,
        }).setOrigin(0.5).setRotation(angle).setScrollFactor(0).setDepth(1000)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => moveTo(id));
        scene.ui.add(arrow);
        scene.ventArrows.push(arrow);
    }
}

function hideArrows(scene) {
    for (const a of scene.ventArrows || []) a.destroy();
    scene.ventArrows = [];
}
