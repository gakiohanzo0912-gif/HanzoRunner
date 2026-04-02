const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

ctx.imageSmoothingEnabled = true;

const STORAGE_KEY = "shiba-runner-hi-score";
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GROUND_Y = 438;
const GRAVITY = 2100;
const JUMP_VELOCITY = -835;
const BASE_SPEED = 340;

const assetPaths = {
  shibaRun1: "./assets/run1.png",
  shibaRun2: "./assets/run2.png",
  shibaJump: "./assets/jump1.png",
  cloud: "./assets/cloud.svg",
  coin: "./assets/coin.svg",
  spike: "./assets/spike.svg",
  log: "./assets/log.svg",
  pipe: "./assets/pipe.svg",
  heart: "./assets/heart.svg",
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function createStars(count) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * WIDTH,
    y: Math.random() * (HEIGHT * 0.55),
    size: Math.random() > 0.85 ? 3 : 2,
    alpha: rand(0.25, 0.95),
  }));
}

function createClouds() {
  return [
    { x: 120, y: 130, speed: 10, scale: 1.05 },
    { x: 520, y: 220, speed: 16, scale: 0.92 },
    { x: 760, y: 100, speed: 12, scale: 0.8 },
  ];
}

async function boot() {
  const entries = Object.entries(assetPaths);
  const loaded = await Promise.all(entries.map(([, path]) => loadImage(path)));
  const assets = Object.fromEntries(entries.map(([key], index) => [key, loaded[index]]));
  startGame(assets);
}

function startGame(assets) {
  const storage = {
    getHiScore() {
      try {
        return Number(window.localStorage.getItem(STORAGE_KEY) || 1000);
      } catch {
        return 1000;
      }
    },
    setHiScore(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(value));
      } catch {
        // Ignore storage failures so the game stays playable.
      }
    },
  };

  const hiScore = storage.getHiScore();

  const state = {
    assets,
    screen: "title",
    score: 0,
    hiScore,
    lives: 3,
    coinCount: 0,
    time: 0,
    speed: BASE_SPEED,
    distance: 0,
    flashTimer: 0,
    gameOverTimer: 0,
    stars: createStars(95),
    clouds: createClouds(),
    player: {
      x: 146,
      y: GROUND_Y - 74,
      width: 110,
      height: 74,
      vx: 0,
      vy: 0,
      onGround: true,
      frame: 0,
      frameTimer: 0,
      invincibleTimer: 0,
    },
    obstacles: [],
    coins: [],
    obstacleTimer: 1.25,
    coinTimer: 1.75,
    groundOffset: 0,
    pendingJump: false,
    lastObstacleKind: "none",
  };

  let lastTime = performance.now();

  function resetRun() {
    state.screen = "running";
    state.score = 0;
    state.lives = 3;
    state.coinCount = 0;
    state.time = 0;
    state.speed = BASE_SPEED;
    state.distance = 0;
    state.flashTimer = 0;
    state.gameOverTimer = 0;
    state.obstacles = [];
    state.coins = [];
    state.obstacleTimer = 1.0;
    state.coinTimer = 1.4;
    state.groundOffset = 0;
    state.pendingJump = false;
    state.lastObstacleKind = "none";
    Object.assign(state.player, {
      x: 146,
      y: GROUND_Y - 74,
      vx: 0,
      vy: 0,
      onGround: true,
      frame: 0,
      frameTimer: 0,
      invincibleTimer: 0,
    });
  }

  function queueJump() {
    if (state.screen === "title") {
      resetRun();
      jump();
      return;
    }

    if (state.screen === "gameover") {
      if (state.gameOverTimer > 0.45) {
        resetRun();
      }
      return;
    }

    if (state.screen === "running") {
      state.pendingJump = true;
    }
  }

  function jump() {
    if (!state.player.onGround) {
      return;
    }
    state.player.vy = JUMP_VELOCITY;
    state.player.onGround = false;
  }

  function spawnObstacle() {
    const choices = [
      {
        kind: "log",
        width: 146,
        height: 54,
        y: GROUND_Y - 54,
        hitbox: { x: 18, y: 12, width: 112, height: 34 },
      },
      {
        kind: "spike",
        width: 118,
        height: 46,
        y: GROUND_Y - 46,
        hitbox: { x: 16, y: 10, width: 84, height: 24 },
      },
      {
        kind: "pipe",
        width: 120,
        height: 148,
        y: GROUND_Y - 128,
        hitbox: { x: 18, y: 14, width: 72, height: 110 },
      },
    ];

    let next = choices[Math.floor(Math.random() * choices.length)];
    if (state.lastObstacleKind === "pipe" && next.kind === "pipe") {
      next = choices[Math.floor(Math.random() * 2)];
    }

    state.lastObstacleKind = next.kind;
    state.obstacles.push({
      ...next,
      x: WIDTH + rand(40, 180),
      hit: false,
    });
  }

  function spawnCoin() {
    const lane = Math.random();
    const y =
      lane > 0.7 ? GROUND_Y - 162 : lane > 0.32 ? GROUND_Y - 122 : GROUND_Y - 94;

    state.coins.push({
      x: WIDTH + rand(100, 220),
      y,
      width: 42,
      height: 42,
      collected: false,
      bob: rand(0, Math.PI * 2),
    });
  }

  function loseLife() {
    if (state.player.invincibleTimer > 0) {
      return;
    }

    state.lives -= 1;
    state.flashTimer = 0.35;
    state.player.invincibleTimer = 1.1;

    if (state.lives <= 0) {
      state.screen = "gameover";
      state.gameOverTimer = 0;
      if (state.score > state.hiScore) {
        state.hiScore = state.score;
        storage.setHiScore(state.hiScore);
      }
    }
  }

  function update(dt) {
    state.time += dt;

    for (const cloud of state.clouds) {
      cloud.x -= cloud.speed * dt;
      if (cloud.x < -180) {
        cloud.x = WIDTH + rand(80, 220);
        cloud.y = rand(72, 232);
        cloud.scale = rand(0.75, 1.15);
      }
    }

    if (state.screen !== "running") {
      if (state.screen === "gameover") {
        state.gameOverTimer += dt;
      }
      return;
    }

    state.speed += dt * 6.5;
    state.distance += state.speed * dt;
    state.score = Math.floor(state.distance * 0.09) + state.coinCount * 35;
    if (state.score > state.hiScore) {
      state.hiScore = state.score;
      storage.setHiScore(state.hiScore);
    }

    state.groundOffset = (state.groundOffset + state.speed * dt) % 96;
    state.flashTimer = Math.max(0, state.flashTimer - dt);
    state.player.invincibleTimer = Math.max(0, state.player.invincibleTimer - dt);

    if (state.pendingJump) {
      jump();
      state.pendingJump = false;
    }

    state.player.vy += GRAVITY * dt;
    state.player.y += state.player.vy * dt;
    if (state.player.y >= GROUND_Y - state.player.height) {
      state.player.y = GROUND_Y - state.player.height;
      state.player.vy = 0;
      state.player.onGround = true;
    }

    state.player.frameTimer += dt;
    if (state.player.frameTimer >= 0.11) {
      state.player.frameTimer = 0;
      state.player.frame = (state.player.frame + 1) % 2;
    }

    state.obstacleTimer -= dt;
    if (state.obstacleTimer <= 0) {
      spawnObstacle();
      state.obstacleTimer = clamp(rand(1.0, 1.65) - (state.speed - BASE_SPEED) / 700, 0.7, 1.55);
    }

    state.coinTimer -= dt;
    if (state.coinTimer <= 0) {
      spawnCoin();
      state.coinTimer = rand(1.2, 2.1);
    }

    for (const obstacle of state.obstacles) {
      obstacle.x -= state.speed * dt;
      const playerHitbox = {
        x: state.player.x + 18,
        y: state.player.y + 10,
        width: state.player.width - 32,
        height: state.player.height - 14,
      };
      const obstacleHitbox = {
        x: obstacle.x + obstacle.hitbox.x,
        y: obstacle.y + obstacle.hitbox.y,
        width: obstacle.hitbox.width,
        height: obstacle.hitbox.height,
      };

      if (!obstacle.hit && intersects(playerHitbox, obstacleHitbox)) {
        obstacle.hit = true;
        loseLife();
      }
    }

    for (const coin of state.coins) {
      coin.x -= state.speed * dt;
      coin.bob += dt * 5.2;

      if (!coin.collected) {
        const playerHitbox = {
          x: state.player.x + 20,
          y: state.player.y + 12,
          width: state.player.width - 38,
          height: state.player.height - 18,
        };
        const coinHitbox = {
          x: coin.x + 5,
          y: coin.y + 4 + Math.sin(coin.bob) * 5,
          width: coin.width - 10,
          height: coin.height - 8,
        };

        if (intersects(playerHitbox, coinHitbox)) {
          coin.collected = true;
          state.coinCount += 1;
        }
      }
    }

    state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -40);
    state.coins = state.coins.filter((coin) => coin.x + coin.width > -30 && !coin.collected);
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, "#08111f");
    sky.addColorStop(0.48, "#03060d");
    sky.addColorStop(1, "#010102");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (const star of state.stars) {
      ctx.fillStyle = `rgba(191, 245, 255, ${star.alpha})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }

    ctx.strokeStyle = "rgba(56, 175, 255, 0.09)";
    ctx.lineWidth = 1;
    for (let x = 52; x < WIDTH; x += 142) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    }

    for (const cloud of state.clouds) {
      const width = 144 * cloud.scale;
      const height = 64 * cloud.scale;
      ctx.drawImage(state.assets.cloud, cloud.x, cloud.y, width, height);
    }
  }

  function drawGround() {
    ctx.fillStyle = "#74e03b";
    ctx.fillRect(0, GROUND_Y - 8, WIDTH, 10);
    ctx.fillStyle = "#37a81d";
    ctx.fillRect(0, GROUND_Y + 2, WIDTH, 20);

    for (let x = -state.groundOffset; x < WIDTH + 96; x += 48) {
      ctx.fillStyle = x % 96 === 0 ? "#d09946" : "#8d5524";
      ctx.fillRect(x, GROUND_Y + 22, 48, 34);
      ctx.fillStyle = "#6e3e18";
      ctx.fillRect(x, GROUND_Y + 24, 24, 14);
      ctx.fillStyle = "#ab6b2d";
      ctx.fillRect(x + 24, GROUND_Y + 24, 24, 14);
      ctx.fillStyle = "#44210b";
      ctx.fillRect(x, GROUND_Y + 44, 48, 12);
    }
  }

  function drawPlayer() {
    const image = !state.player.onGround
      ? state.assets.shibaJump
      : state.player.frame === 0
        ? state.assets.shibaRun1
        : state.assets.shibaRun2;

    if (state.player.invincibleTimer > 0 && Math.floor(state.player.invincibleTimer * 12) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    ctx.drawImage(image, state.player.x, state.player.y, state.player.width, state.player.height);
    ctx.globalAlpha = 1;
  }

  function drawEntities() {
    for (const obstacle of state.obstacles) {
      const sprite =
        obstacle.kind === "log"
          ? state.assets.log
          : obstacle.kind === "spike"
            ? state.assets.spike
            : state.assets.pipe;
      ctx.drawImage(sprite, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    }

    for (const coin of state.coins) {
      const bobY = Math.sin(coin.bob) * 5;
      ctx.drawImage(state.assets.coin, coin.x, coin.y + bobY, coin.width, coin.height);
    }
  }

  function drawHud() {
    ctx.save();
    ctx.font = "bold 30px monospace";
    ctx.textBaseline = "top";

    ctx.fillStyle = "#ffffff";
    ctx.fillText(`SCORE:${String(state.score).padStart(4, "0")}`, 30, 28);

    ctx.fillStyle = "#ffd54a";
    ctx.fillText(`HI:${String(state.hiScore).padStart(5, "0")}`, WIDTH - 270, 28);

    for (let i = 0; i < 3; i += 1) {
      const alpha = i < state.lives ? 1 : 0.22;
      ctx.globalAlpha = alpha;
      ctx.drawImage(state.assets.heart, WIDTH - 182 + i * 56, 74, 44, 40);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawTitleScreen() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.font = "bold 76px monospace";
    const titleGradient = ctx.createLinearGradient(0, 110, 0, 220);
    titleGradient.addColorStop(0, "#ffe67d");
    titleGradient.addColorStop(1, "#ff9900");
    ctx.fillStyle = titleGradient;
    ctx.strokeStyle = "#35210d";
    ctx.lineWidth = 8;
    ctx.strokeText("SHIBA RUNNER", WIDTH / 2, 150);
    ctx.fillText("SHIBA RUNNER", WIDTH / 2, 150);

    ctx.font = "bold 38px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("TAP TO JUMP!", WIDTH / 2, HEIGHT - 74);

    ctx.font = "bold 24px monospace";
    ctx.fillStyle = "#bde7ff";
    ctx.fillText("Space / Click / Tap to Start", WIDTH / 2, HEIGHT - 118);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = "center";
    ctx.font = "bold 52px monospace";
    ctx.fillStyle = "#ffcc4f";
    ctx.fillText("GAME OVER", WIDTH / 2, 180);
    ctx.font = "bold 28px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`SCORE ${state.score}`, WIDTH / 2, 250);
    ctx.fillText(`HI SCORE ${state.hiScore}`, WIDTH / 2, 292);
    ctx.fillStyle = "#bfe7ff";
    ctx.fillText("Tap or press Space to Retry", WIDTH / 2, 368);
    ctx.restore();
  }

  function drawFlash() {
    if (state.flashTimer <= 0) {
      return;
    }

    ctx.fillStyle = `rgba(255, 96, 72, ${state.flashTimer * 0.8})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function draw() {
    drawBackground();
    drawGround();
    drawEntities();
    drawPlayer();
    drawHud();
    drawFlash();

    if (state.screen === "title") {
      drawTitleScreen();
    }

    if (state.screen === "gameover") {
      drawGameOver();
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      event.preventDefault();
      queueJump();
    }
  });

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    queueJump();
  });

  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  ctx.fillStyle = "#05070e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#ffffff";
  ctx.font = "24px monospace";
  ctx.fillText("Failed to load game assets.", 28, 28);
});
