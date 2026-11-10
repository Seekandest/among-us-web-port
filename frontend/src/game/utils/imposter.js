import net from "../../services/net.js";

/**
 * Initialize imposter-specific UI and mechanics
 * Sets up kill button and detection zone for the imposter
 */
export function handleImposter(scene) {
    console.log("Ran handleImposter with", scene.imposter, scene.player);
    if (!scene.imposter || !scene.player) return;

    console.log("Setting up imposter", scene.player, scene.imposter);

    const KILL_ZONE_RADIUS = 60; // pixels

    // Kill button click handler
    const handleKill = () => {
        const victim = scene.closest && scene.closest.player;
        if (!victim) return;

        // Only a REQUEST: "I want to kill this player". The server knows the killer from our
        // connection, and checks role, distance (with its own positions) and cooldown. If it agrees,
        // everybody gets player:killed (and we jump onto the body then); if not, we get a
        // game:notif refusal, shown as a toast by App.jsx.
        console.log('Emitting player:kill', victim.id);
        net.emit('player:kill', { playerId: victim.id });

        // Reset closest player tracking
        scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
    };

    // Create kill button UI
    scene.killBtn = scene.add.image(820, 410, 'kill')
        .setScale(0.7)
        .setDepth(1000)
        .setScrollFactor(0)
        .setInteractive()
        .on('pointerdown', handleKill);
    scene.ui.add(scene.killBtn);
    console.log("Kill button created", scene.killBtn);

    // Create invisible detection zone around imposter
    scene.zone = scene.physics.add.sprite(scene.player.x, scene.player.y, 100, 100);
    if (scene.zone.body) {
        scene.zone.body.setCircle(KILL_ZONE_RADIUS);
        scene.zone.body.setAllowGravity(false);
        scene.zone.visible = false;
    }
}

export function handleImposterMovement(scene) {
    // Update imposter kill zone if player is imposter
    if (scene.imposter && scene.zone && scene.player) {
        scene.zone.setPosition(scene.player.x, scene.player.y);
        handleNearestPlayer(scene);
    }

    // Update kill button visual state based on whether a target is in range
    if (scene.killBtn) {
        if (!scene.closest.player && scene.killBtn.pipeline?.name !== 'GrayScale') {
            scene.killBtn.setPipeline('GrayScale');
        } else if (scene.closest.player && scene.killBtn.pipeline?.name === 'GrayScale') {
            scene.killBtn.resetPipeline();
        }
    }
}

/**
 * Track the nearest player within kill range for the imposter
 * Updates scene.closest with the nearest valid target
 */
export function handleNearestPlayer(scene) {
    const KILL_ZONE_RADIUS = 60; // pixels

    Object.values(scene.players).forEach(p => {
        // Dead or removed players are not targets (the server would refuse the kill anyway).
        if (!p.alive || !p.active) {
            if (p === scene.closest.player) scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
            return;
        }
        const dist = Phaser.Math.Distance.Between(scene.zone.x, scene.zone.y, p.x, p.y);

        // Player moved out of range
        if (dist > KILL_ZONE_RADIUS) {
            if (p === scene.closest.player) {
                scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
                console.log("No closest player");
            }
            return;
        }

        // Found closer player (excluding self)
        if (dist < scene.closest.distance && p !== scene.player) {
            if (scene.closest.player !== p) {
                console.log("New closest player:", scene.closest);
            }
            scene.closest = { player: p, distance: dist };
        }
    });
}
