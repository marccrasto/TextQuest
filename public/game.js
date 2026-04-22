const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const scoreEl = document.getElementById('scoreValue');
const multiplierEl = document.getElementById('multiplierValue');
const currentObjectiveEl = document.getElementById('currentObjective');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreEl = document.getElementById('finalScore');
const startButton = document.getElementById('startButton');
const restartButton = document.getElementById('restartButton');

// Game State
let isPlaying = false;
let score = 0;
let speed = 10;
let gameTime = 0;
let lanes = [-1, 0, 1];
const LANE_WIDTH = 120;
const HORIZON_Y = 200;

// RPG Data
let rpgData = null;
let vocabulary = [];
let quests = [];
let currentQuestIndex = 0;

// Player
const player = {
    lane: 1, // 0, 1, 2 (index of lanes array)
    y: 0,
    z: 0,
    width: 40,
    height: 80,
    isJumping: false,
    jumpVelocity: 0,
    color: '#7c5dff',
    targetX: 0,
    x: 0
};

// Objects
let obstacles = [];
let particles = [];

// Camera/Perspective
const CAMERA_HEIGHT = 150;
const FOCAL_LENGTH = 300;

function init() {
    resize();
    window.addEventListener('resize', resize);
    loadRPGData();

    startButton.addEventListener('click', startGame);
    restartButton.addEventListener('click', startGame);

    document.addEventListener('keydown', handleInput);

    // Initial render
    draw();
}

function loadRPGData() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const forceSample = urlParams.get('forceSample');
        const stored = !forceSample ? localStorage.getItem('textquest_structure') : null;

        if (stored) {
            rpgData = JSON.parse(stored);
            vocabulary = rpgData.vocabulary || [];

            // Flatten quests
            rpgData.levels?.forEach(level => {
                if (level.quests) quests.push(...level.quests);
            });

            if (quests.length > 0) {
                currentObjectiveEl.textContent = `Quest: ${quests[0].title}`;
            } else {
                currentObjectiveEl.textContent = "Survive and Collect Knowledge!";
            }
        } else {
            currentObjectiveEl.textContent = "No RPG data found. Using sample mode.";
            vocabulary = [
                { term: "Mitochondria", type: "item" },
                { term: "Nucleus", type: "item" },
                { term: "Ribosome", type: "item" }
            ];
        }
    } catch (e) {
        console.error("Failed to load RPG data", e);
    }
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function startGame() {
    isPlaying = true;
    score = 0;
    speed = 2;
    gameTime = 0;
    obstacles = [];
    particles = [];

    player.lane = 1;
    player.y = 0;
    player.jumpVelocity = 0;
    player.isJumping = false;

    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    requestAnimationFrame(gameLoop);
}

function handleInput(e) {
    if (!isPlaying) return;

    if (e.key === 'ArrowLeft') {
        if (player.lane > 0) player.lane--;
    } else if (e.key === 'ArrowRight') {
        if (player.lane < 2) player.lane++;
    } else if (e.key === 'ArrowUp' && !player.isJumping) {
        player.isJumping = true;
        player.jumpVelocity = 15;
    }
}

function spawnObstacle() {
    const z = 2000; // Spawn distance
    const laneIndex = Math.floor(Math.random() * 3);
    const type = Math.random() > 0.3 ? 'obstacle' : 'collectible';

    let content = '';
    let color = '#f97373'; // Red for obstacle

    if (type === 'collectible') {
        color = '#31c2ff'; // Blue for knowledge
        if (vocabulary.length > 0) {
            const term = vocabulary[Math.floor(Math.random() * vocabulary.length)];
            content = term.term;
        } else {
            content = "Knowledge";
        }
    } else {
        content = "Misconception";
    }

    obstacles.push({
        x: (laneIndex - 1) * LANE_WIDTH, // -120, 0, 120
        y: 0,
        z: z,
        width: 60,
        height: 60,
        type: type,
        color: color,
        content: content,
        lane: laneIndex
    });
}

function update() {
    gameTime++;
    speed += 0.0005; // Slowly increase speed

    // Spawn logic
    if (gameTime % Math.floor(600 / speed) === 0) {
        spawnObstacle();
    }

    // Player physics
    if (player.isJumping) {
        player.y += player.jumpVelocity;
        player.jumpVelocity -= 0.8; // Gravity
        if (player.y <= 0) {
            player.y = 0;
            player.isJumping = false;
        }
    }

    // Smooth lane transition
    const targetX = (player.lane - 1) * LANE_WIDTH;
    player.x += (targetX - player.x) * 0.2;

    // Update obstacles
    for (let i = obstacles.length - 1; i >= 0; i--) {
        let obs = obstacles[i];
        obs.z -= speed * 10;

        // Collision detection
        // Simple Z-depth check + Lane check
        if (obs.z < 100 && obs.z > -100) {
            // Check lane
            // We use player.lane (integer) for precise collision, 
            // but visual player.x is smoothed.
            // For gameplay feel, integer lane check is often better for this type of game.
            if (obs.lane === player.lane) {
                // Check Y (jump over)
                // Obstacle height is 60. Player Y must be > 60 to clear it?
                // Let's say obstacle is on ground.
                if (player.y < 60) {
                    if (obs.type === 'obstacle') {
                        gameOver();
                    } else {
                        // Collect
                        score += 100;
                        createParticles(player.x, player.y, obs.color);
                        obstacles.splice(i, 1);
                        continue;
                    }
                }
            }
        }

        if (obs.z < -200) {
            obstacles.splice(i, 1);
            if (obs.type === 'obstacle') score += 10;
        }
    }

    // Update particles
    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    });

    scoreEl.textContent = Math.floor(score);
}

function createParticles(x, y, color) {
    for (let i = 0; i < 10; i++) {
        particles.push({
            x: x, // This is 3D world X
            y: y + 40, // Center of player
            z: 0,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 30,
            color: color
        });
    }
}

function project(x, y, z) {
    const scale = FOCAL_LENGTH / (FOCAL_LENGTH + z);
    const x2d = (canvas.width / 2) + (x * scale);
    const y2d = (canvas.height / 2) + (CAMERA_HEIGHT * scale) - (y * scale);
    return { x: x2d, y: y2d, scale: scale };
}

function draw() {
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Horizon
    const horizonY = (canvas.height / 2) + (CAMERA_HEIGHT * (FOCAL_LENGTH / (FOCAL_LENGTH + 2000))); // Approx
    // Actually, horizon is where Z = infinity. Scale approaches 0.
    // y2d = cy + camH * 0 = cy.
    // Wait, if Z is infinite, scale is 0.
    // y2d = cy.
    // So horizon is at center Y?
    // Let's adjust CAMERA_HEIGHT to look down.

    // Draw Floor Grid
    ctx.strokeStyle = 'rgba(124, 93, 255, 0.2)';
    ctx.lineWidth = 1;

    // Draw Lanes
    for (let i = -1; i <= 2; i++) { // Lines between lanes
        const xWorld = (i - 0.5) * LANE_WIDTH; // Boundaries
        // Draw line from Z=0 to Z=2000
        const p1 = project(xWorld, 0, 0);
        const p2 = project(xWorld, 0, 2000);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }

    // Draw Objects (Sort by Z far to near)
    obstacles.sort((a, b) => b.z - a.z);

    obstacles.forEach(obs => {
        const p = project(obs.x, obs.y, obs.z);
        const w = obs.width * p.scale;
        const h = obs.height * p.scale;

        ctx.fillStyle = obs.color;
        ctx.fillRect(p.x - w / 2, p.y - h, w, h);

        // Text
        if (p.scale > 0.5) {
            ctx.fillStyle = '#fff';
            ctx.font = `${Math.max(10, 12 * p.scale)}px 'Space Grotesk'`;
            ctx.textAlign = 'center';
            ctx.fillText(obs.content, p.x, p.y - h - 10);
        }
    });

    // Draw Player
    const p = project(player.x, player.y, player.z);
    const pw = player.width * p.scale;
    const ph = player.height * p.scale;

    ctx.fillStyle = player.color;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, pw / 2, pw / 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = player.color;
    ctx.fillRect(p.x - pw / 2, p.y - ph, pw, ph);

    // Particles
    particles.forEach(part => {
        // Simple 2D particles for now, or project them?
        // Let's project them
        const pp = project(part.x, part.y, part.z);
        ctx.fillStyle = part.color;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 3 * pp.scale, 0, Math.PI * 2);
        ctx.fill();
    });
}

function gameLoop() {
    if (!isPlaying) return;
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function gameOver() {
    isPlaying = false;
    finalScoreEl.textContent = Math.floor(score);
    gameOverScreen.classList.remove('hidden');
}

init();
