import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";
import { makeAllTextures } from "@/games/shared/textures";

// ---- Flap Bird config ------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const BIRD_X = 120;
const BIRD_W = 40;
const BIRD_H = 30;
const GRAVITY = 1400; // px/s^2
const FLAP_V = -360; // instantaneous flap velocity
const PIPE_W = 70;
const GAP_H = 170; // vertical gap between the pipe pair
const PIPE_SPEED = 200; // px/s world scroll
const PIPE_INTERVAL = 1.6; // seconds between spawns
const GROUND_Y = 750;
const CAP_H = 26;
const CAP_W = 86;
const BEST_KEY = "clagames.flappy.best";

interface PipePair {
  topBody: Phaser.GameObjects.Image;
  topCap: Phaser.GameObjects.Image;
  botCap: Phaser.GameObjects.Image;
  botBody: Phaser.GameObjects.Image;
  x: number;
  gapY: number;
  scored: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Flap Bird — a one-tap flappy clone tuned for mobile.
 * Tap anywhere (or press Space/Up) to flap. Thread the pipe gaps to score.
 * Physics is integrated manually for predictable, framerate-independent play.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class FlappyScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private state: GameState = "ready";
  private score = 0;
  private best = 0;
  private bird!: Phaser.GameObjects.Image;
  private birdY = GAME_H / 2;
  private vy = 0;
  private bobT = 0;
  private pipes: PipePair[] = [];
  private pool: PipePair[] = [];
  private stars: Phaser.GameObjects.Image[] = [];
  private ground!: Phaser.GameObjects.TileSprite;
  private buildings!: Phaser.GameObjects.TileSprite;
  private spawnTimer = 0;
  private title?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "Flappy" });
  }

  create(): void {
    this.bridge = activeBridge!;
    makeAllTextures(this);
    this.makeBirdTexture();
    this.makePipeTextures();
    this.best = this.loadBest();
    this.cameras.main.setBackgroundColor(THEME.bg);

    // Night-sky gradient.
    const sky = this.add.graphics();
    sky.fillGradientStyle(
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      1,
    );
    sky.fillRect(0, 0, GAME_W, GAME_H);

    // Bokeh stars (far parallax).
    for (let i = 0; i < 14; i++) {
      const s = this.add
        .image(
          Phaser.Math.Between(0, GAME_W),
          Phaser.Math.Between(40, 520),
          "bokeh",
        )
        .setAlpha(0.5)
        .setScale(Phaser.Math.FloatBetween(0.4, 1));
      this.stars.push(s);
    }

    // Distant buildings (mid parallax).
    this.buildings = this.add
      .tileSprite(0, GROUND_Y - 120, GAME_W, 160, "building")
      .setOrigin(0, 0)
      .setAlpha(0.55)
      .setTileScale(1, 1.2);

    // Ground band.
    this.ground = this.add
      .tileSprite(0, GROUND_Y, GAME_W, GAME_H - GROUND_Y, "ground")
      .setOrigin(0, 0)
      .setDepth(2);
    // Neon line on the ground edge.
    this.add
      .rectangle(0, GROUND_Y, GAME_W, 3, 0x5eead4)
      .setOrigin(0, 0)
      .setAlpha(0.8)
      .setDepth(3);

    // Bird.
    this.bird = this.add.image(BIRD_X, this.birdY, "bird").setDepth(10);

    // Title + hint.
    this.title = this.add
      .text(GAME_W / 2, 150, "FLAP BIRD", {
        fontFamily: FONT_FAMILY,
        fontSize: "40px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    this.hint = this.add
      .text(GAME_W / 2, GAME_H / 2 + 80, "Tap to flap", {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // Input — works for mouse and touch (pointerdown) + keyboard.
    this.input.on("pointerdown", this.onFlap, this);
    this.input.keyboard?.on("keydown-SPACE", () => this.onFlap());
    this.input.keyboard?.on("keydown-UP", () => this.onFlap());

    // React -> Phaser controls. Remove them on shutdown so a recreated game
    // (e.g. React StrictMode dev double-mount) doesn't leak handlers.
    // Guard with isActive() in case a start event races with shutdown
    // (the scene's this.add/this.tweens become null after destroy).
    const startIfActive = () => {
      if (this.sys.isActive()) this.startRound();
    };
    const offStart = this.bridge.on(GameEvents.Start, startIfActive);
    const offRestart = this.bridge.on(GameEvents.Restart, startIfActive);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offStart();
      offRestart();
    });

    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
  }

  // ---- Textures (generated at runtime — no image assets) -------------

  private makeBirdTexture(): void {
    const tw = 48;
    const th = 36;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const bx = 4;
    const by = 3;
    const bw = 36;
    const bh = 30;
    // soft shadow
    g.fillStyle(0x000000, 0.22);
    g.fillRoundedRect(bx + 2, by + 3, bw, bh, 9);
    // body
    g.fillStyle(0xfbbf24, 1);
    g.fillRoundedRect(bx, by, bw, bh, 9);
    // belly
    g.fillStyle(0xfde68a, 1);
    g.fillRoundedRect(bx + 3, by + bh * 0.5, bw - 6, bh * 0.45, 7);
    // wing
    g.fillStyle(0xf59e0b, 1);
    g.fillEllipse(bx + bw * 0.4, by + bh * 0.6, 16, 11);
    g.fillStyle(0xd97706, 0.6);
    g.fillEllipse(bx + bw * 0.4, by + bh * 0.62, 12, 7);
    // eye
    g.fillStyle(0xffffff, 1);
    g.fillCircle(bx + bw * 0.78, by + bh * 0.3, 5.5);
    g.fillStyle(0x0b1020, 1);
    g.fillCircle(bx + bw * 0.83, by + bh * 0.3, 2.8);
    // beak
    g.fillStyle(0xf97316, 1);
    g.fillTriangle(
      bx + bw - 2,
      by + bh * 0.42,
      bx + bw - 2,
      by + bh * 0.68,
      bx + bw + 5,
      by + bh * 0.55,
    );
    g.fillStyle(0xea580c, 1);
    g.fillTriangle(
      bx + bw - 2,
      by + bh * 0.55,
      bx + bw + 5,
      by + bh * 0.55,
      bx + bw - 2,
      by + bh * 0.68,
    );
    g.generateTexture("bird", tw, th);
    g.destroy();
  }

  private makePipeTextures(): void {
    // Pipe body — solid red with side highlight + shadow.
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(Phaser.Display.Color.GetColor(0xf8, 0x71, 0x71), 1);
    g.fillRect(0, 0, PIPE_W, 64);
    g.fillStyle(0xfca5a5, 1);
    g.fillRect(4, 0, 9, 64);
    g.fillStyle(0xdc2626, 1);
    g.fillRect(PIPE_W - 11, 0, 9, 64);
    g.generateTexture("pipe-body", PIPE_W, 64);
    g.destroy();

    // Pipe cap — wider lip with a bright top edge.
    const g2 = this.make.graphics({ x: 0, y: 0 }, false);
    g2.fillStyle(0xdc2626, 1);
    g2.fillRoundedRect(0, 0, CAP_W, CAP_H, 5);
    g2.fillStyle(0xf87171, 1);
    g2.fillRoundedRect(0, 0, CAP_W, CAP_H - 3, 5);
    g2.fillStyle(0xfecaca, 1);
    g2.fillRect(0, 0, CAP_W, 4);
    g2.generateTexture("pipe-cap", CAP_W, CAP_H);
    g2.destroy();
  }

  // ---- Input ---------------------------------------------------------

  private onFlap = (_pointer?: Phaser.Input.Pointer): void => {
    if (this.state === "ready" || this.state === "over") {
      // Let the React overlay drive start/restart; a canvas tap also kicks a
      // fresh round for instant feel.
      this.bridge.emit(GameEvents.Start);
      return;
    }
    if (this.state !== "playing") return;
    this.vy = FLAP_V;
    this.tweens.add({
      targets: this.bird,
      scaleY: 0.82,
      scaleX: 1.12,
      duration: 80,
      yoyo: true,
    });
  };

  // ---- Loop ----------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000; // clamp big frame gaps
    if (this.state !== "playing") {
      // Idle drift so the scene looks alive on the "ready" screen.
      this.ground.tilePositionX += PIPE_SPEED * 0.25 * dt;
      this.buildings.tilePositionX += PIPE_SPEED * 0.04 * dt;
      if (this.state === "ready") {
        this.bobT += dt;
        this.bird.y = this.birdY + Math.sin(this.bobT * 6) * 4;
      }
      return;
    }

    // Physics: gravity + integrate.
    this.vy += GRAVITY * dt;
    this.birdY += this.vy * dt;
    this.bird.y = this.birdY;
    this.bird.setAngle(Phaser.Math.Clamp(this.vy / 12, -25, 75));

    // World scroll.
    this.ground.tilePositionX += PIPE_SPEED * dt;
    this.buildings.tilePositionX += PIPE_SPEED * 0.18 * dt;
    for (const s of this.stars) {
      s.x -= PIPE_SPEED * 0.05 * dt;
      if (s.x < -40) s.x = GAME_W + 40;
    }

    // Spawn pipes.
    this.spawnTimer += dt;
    if (this.spawnTimer >= PIPE_INTERVAL) {
      this.spawnTimer -= PIPE_INTERVAL;
      this.spawnPipe();
    }

    // Move pipes + score when the bird passes the pipe center.
    for (const p of this.pipes) {
      p.x -= PIPE_SPEED * dt;
      p.topBody.x = p.x;
      p.topCap.x = p.x;
      p.botCap.x = p.x;
      p.botBody.x = p.x;
      if (!p.scored && p.x < BIRD_X) {
        p.scored = true;
        this.score++;
        this.emitScore();
      }
    }
    // Recycle off-screen.
    for (let i = this.pipes.length - 1; i >= 0; i--) {
      const p = this.pipes[i];
      if (p.x < -CAP_W) {
        p.topBody.setVisible(false);
        p.topCap.setVisible(false);
        p.botCap.setVisible(false);
        p.botBody.setVisible(false);
        this.pipes.splice(i, 1);
        this.pool.push(p);
      }
    }

    // Collision: ceiling / ground.
    if (this.birdY < 0 || this.birdY > GROUND_Y) {
      this.gameOver();
      return;
    }
    // Collision: pipes (forgiving AABB).
    const bBox: Box = {
      x: BIRD_X - BIRD_W * 0.35,
      y: this.birdY - BIRD_H * 0.4,
      w: BIRD_W * 0.7,
      h: BIRD_H * 0.8,
    };
    for (const p of this.pipes) {
      const gapTop = p.gapY - GAP_H / 2;
      const gapBot = p.gapY + GAP_H / 2;
      const px = p.x - PIPE_W / 2;
      if (bBox.x + bBox.w > px && bBox.x < px + PIPE_W) {
        if (bBox.y < gapTop || bBox.y + bBox.h > gapBot) {
          this.gameOver();
          return;
        }
      }
    }
  }

  // ---- Pipes ---------------------------------------------------------

  private spawnPipe(): void {
    const gapY = Phaser.Math.Between(160, 590);
    let p = this.pool.pop();
    if (!p) {
      p = {
        topBody: this.add.image(0, 0, "pipe-body").setDepth(5),
        topCap: this.add.image(0, 0, "pipe-cap").setDepth(5).setFlipY(true),
        botCap: this.add.image(0, 0, "pipe-cap").setDepth(5),
        botBody: this.add.image(0, 0, "pipe-body").setDepth(5),
        x: 0,
        gapY: 0,
        scored: false,
      };
    }
    this.configurePipe(p, GAME_W + CAP_W, gapY);
    this.pipes.push(p);
  }

  private configurePipe(p: PipePair, x: number, gapY: number): void {
    p.x = x;
    p.gapY = gapY;
    p.scored = false;
    const gapTop = gapY - GAP_H / 2;
    const gapBot = gapY + GAP_H / 2;
    const topBodyH = Math.max(8, gapTop - CAP_H);
    const botBodyH = Math.max(8, GROUND_Y - gapBot - CAP_H);
    p.topBody
      .setPosition(x, topBodyH / 2)
      .setDisplaySize(PIPE_W, topBodyH)
      .setVisible(true);
    p.topCap
      .setPosition(x, gapTop - CAP_H / 2)
      .setDisplaySize(CAP_W, CAP_H)
      .setVisible(true);
    p.botCap
      .setPosition(x, gapBot + CAP_H / 2)
      .setDisplaySize(CAP_W, CAP_H)
      .setVisible(true);
    p.botBody
      .setPosition(x, gapBot + CAP_H + botBodyH / 2)
      .setDisplaySize(PIPE_W, botBodyH)
      .setVisible(true);
  }

  // ---- Lifecycle -----------------------------------------------------

  private startRound(): void {
    // Reset pipes back to the pool.
    for (const p of this.pipes) {
      p.topBody.setVisible(false);
      p.topCap.setVisible(false);
      p.botCap.setVisible(false);
      p.botBody.setVisible(false);
      this.pool.push(p);
    }
    this.pipes = [];

    this.tweens.killTweensOf(this.bird);
    this.birdY = GAME_H / 2;
    this.vy = FLAP_V;
    this.bird.setY(this.birdY).setAngle(0).setScale(1);
    this.score = 0;
    this.spawnTimer = 0;
    this.state = "playing";
    this.title?.setAlpha(0.25);
    this.hint?.setAlpha(0);
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private gameOver(): void {
    this.state = "over";
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Crashed",
    });
    this.tweens.add({ targets: this.bird, angle: 90, duration: 300 });
  }

  // ---- persistence / events -----------------------------------------

  private emitScore(): void {
    this.bridge.emit(GameEvents.Score, { score: this.score, best: this.best });
  }
  private loadBest(): number {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(BEST_KEY) || 0);
  }
  private saveBest(): void {
    if (typeof window === "undefined") return;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
  }
}
