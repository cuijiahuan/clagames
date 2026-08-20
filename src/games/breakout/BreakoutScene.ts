import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Breakout config ---------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const PADDLE_Y = 750;
const PADDLE_W = 90;
const PADDLE_H = 14;
const BALL_R = 8;
const BALL_SPEED = 360; // px/s — kept constant across bounces
const WALL_MARGIN_X = 20;
const GAP = 4;
const BRICK_COLS = 8;
const BRICK_ROWS = 6;
const BRICK_H = 22;
// brick width ≈ (canvas - 2*margin - total gap) / cols ≈ 50
const BRICK_W = Math.floor(
  (GAME_W - 2 * WALL_MARGIN_X - (BRICK_COLS - 1) * GAP) / BRICK_COLS,
);
const WALL_TOTAL_W = BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * GAP;
const WALL_X = (GAME_W - WALL_TOTAL_W) / 2;
const WALL_Y = 140;
const START_LIVES = 3;
const BEST_KEY = "clagames.breakout.best";
// paddle edge hit → 60° off vertical
const MAX_BOUNCE_ANGLE = (60 * Math.PI) / 180;

interface Brick {
  sprite: Phaser.GameObjects.Image;
  col: number;
  row: number;
  alive: boolean;
}

// ---- color helpers (kept local so the scene needs no image assets) -----
function hexToInt(hex: string): number {
  const h = hex.replace("#", "");
  return (
    (parseInt(h.slice(0, 2), 16) << 16) |
    (parseInt(h.slice(2, 4), 16) << 8) |
    parseInt(h.slice(4, 6), 16)
  );
}
function mixColor(hex: string, target: [number, number, number], t: number): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const nr = Math.round(r + (target[0] - r) * t);
  const ng = Math.round(g + (target[1] - g) * t);
  const nb = Math.round(b + (target[2] - b) * t);
  return (nr << 16) | (ng << 8) | nb;
}
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Brick Buster — a casual breakout.
 * Touch-first: drag the paddle to catch the ball, tap to launch. Break every
 * brick to win. 3 lives — a dropped ball costs one. Best score in localStorage.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class BreakoutScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private score = 0;
  private best = 0;
  private lives = START_LIVES;
  private state: GameState = "ready";
  private paddle?: Phaser.GameObjects.Image;
  private ball?: Phaser.GameObjects.Image;
  private ballVx = 0;
  private ballVy = 0;
  private ballStuck = true;
  private bricks: Brick[] = [];
  private livesText?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "Breakout" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.makeTextures();
    this.best = this.loadBest();

    // Background gradient (matches Match3 / Runner vibe).
    this.cameras.main.setBackgroundColor(THEME.bg);
    const bg = this.add.graphics();
    bg.fillGradientStyle(
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      1,
    );
    bg.fillRect(0, 0, GAME_W, GAME_H);

    // Title + subtitle.
    const title = this.add
      .text(GAME_W / 2, 70, "BRICK BUSTER", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);
    this.add
      .text(GAME_W / 2, 104, "Bounce • Break • Survive", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // Lives HUD (top-left of canvas; FPS HUD sits top-right so no clash).
    this.livesText = this.add
      .text(20, 44, this.livesLabel(), {
        fontFamily: FONT_FAMILY,
        fontSize: "16px",
        color: THEME.accent,
        fontStyle: "bold",
      })
      .setOrigin(0, 0.5);

    this.hint = this.add
      .text(GAME_W / 2, GAME_H - 24, "Drag to move • Tap to launch", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // Brick wall (drawn for the ready-screen preview).
    this.buildWall();

    // Paddle + ball (ball glued to paddle until first launch).
    this.paddle = this.add.image(GAME_W / 2, PADDLE_Y, "paddle").setDepth(10);
    this.ball = this.add
      .image(GAME_W / 2, PADDLE_Y - PADDLE_H / 2 - BALL_R, "ball")
      .setDepth(10);
    this.ballStuck = true;

    // Input: drag paddle, tap to launch.
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerdown", this.onPointerDown, this);

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

    // Tell React we're ready (shows the "Tap to start" overlay).
    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
  }

  // ---- Textures (runtime-generated, zero image assets) ----------------

  private makeTextures(): void {
    // Ball: white circle with a soft glow halo.
    const ballTex = BALL_R * 2 + 4;
    const ballG = this.make.graphics({ x: 0, y: 0 }, false);
    ballG.fillStyle(0xffffff, 0.18);
    ballG.fillCircle(ballTex / 2, ballTex / 2, ballTex / 2);
    ballG.fillStyle(0xffffff, 1);
    ballG.fillCircle(ballTex / 2, ballTex / 2, BALL_R);
    ballG.generateTexture("ball", ballTex, ballTex);
    ballG.destroy();

    // Paddle: rounded capsule in accent color with a top highlight.
    const paddleG = this.make.graphics({ x: 0, y: 0 }, false);
    const accent = hexToInt(THEME.accent);
    paddleG.fillStyle(0x000000, 0.3);
    paddleG.fillRoundedRect(2, 3, PADDLE_W, PADDLE_H, PADDLE_H / 2);
    paddleG.fillStyle(accent, 1);
    paddleG.fillRoundedRect(0, 0, PADDLE_W, PADDLE_H, PADDLE_H / 2);
    paddleG.fillStyle(0xffffff, 0.35);
    paddleG.fillRoundedRect(4, 2, PADDLE_W - 8, PADDLE_H / 3, PADDLE_H / 4);
    paddleG.generateTexture("paddle", PADDLE_W, PADDLE_H);
    paddleG.destroy();

    // Bricks: one texture per gem color (6 rows → 6 distinct colors).
    THEME.gems.forEach((color, i) => {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const base = hexToInt(color);
      g.fillStyle(0x000000, 0.3);
      g.fillRoundedRect(2, 3, BRICK_W, BRICK_H, 6);
      g.fillStyle(base, 1);
      g.fillRoundedRect(0, 0, BRICK_W, BRICK_H, 6);
      // top highlight strip
      g.fillStyle(mixColor(color, WHITE, 0.45), 0.85);
      g.fillRoundedRect(3, 2, BRICK_W - 6, 5, 3);
      // bottom shade
      g.fillStyle(mixColor(color, BLACK, 0.32), 0.7);
      g.fillRoundedRect(0, BRICK_H * 0.55, BRICK_W, BRICK_H * 0.45, 6);
      g.generateTexture(`brick-${i}`, BRICK_W, BRICK_H);
      g.destroy();
    });

    // Particle for brick-pop FX.
    const partG = this.make.graphics({ x: 0, y: 0 }, false);
    partG.fillStyle(0xffffff, 1);
    partG.fillCircle(8, 8, 8);
    partG.generateTexture("particle", 16, 16);
    partG.destroy();
  }

  // ---- Wall setup ------------------------------------------------------

  private buildWall(): void {
    for (const b of this.bricks) b.sprite.destroy();
    this.bricks = [];
    const palette = THEME.gems;
    for (let r = 0; r < BRICK_ROWS; r++) {
      const colorIdx = r % palette.length;
      for (let c = 0; c < BRICK_COLS; c++) {
        const x = WALL_X + c * (BRICK_W + GAP) + BRICK_W / 2;
        const y = WALL_Y + r * (BRICK_H + GAP) + BRICK_H / 2;
        const sprite = this.add.image(x, y, `brick-${colorIdx}`);
        const brick: Brick = { sprite, col: c, row: r, alive: true };
        sprite.setData("brick", brick);
        this.bricks.push(brick);
      }
    }
  }

  // ---- Input -----------------------------------------------------------

  private movePaddleTo(x: number): void {
    if (!this.paddle) return;
    const half = PADDLE_W / 2;
    this.paddle.x = Phaser.Math.Clamp(x, half, GAME_W - half);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    this.movePaddleTo(pointer.x);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    // Position the paddle on tap too (mobile: first touch sets paddle x).
    this.movePaddleTo(pointer.x);
    if (this.state !== "playing") return;
    if (!this.ballStuck) return;
    this.launchBall();
  }

  private launchBall(): void {
    this.ballStuck = false;
    // Launch diagonally upward with a slight random horizontal bias.
    const angle = (Phaser.Math.Between(-30, 30) * Math.PI) / 180;
    this.ballVx = BALL_SPEED * Math.sin(angle);
    this.ballVy = -BALL_SPEED * Math.cos(angle);
  }

  // ---- Per-frame physics (manual AABB — no arcade physics) -------------

  update(_time: number, delta: number): void {
    if (this.state !== "playing") return;
    if (!this.ball || !this.paddle) return;

    if (this.ballStuck) {
      // Glue the ball to the paddle until the player launches it.
      this.ball.x = this.paddle.x;
      this.ball.y = PADDLE_Y - PADDLE_H / 2 - BALL_R;
      return;
    }

    const dt = delta / 1000;
    this.ball.x += this.ballVx * dt;
    this.ball.y += this.ballVy * dt;

    // Side walls.
    if (this.ball.x - BALL_R < 0) {
      this.ball.x = BALL_R;
      this.ballVx = Math.abs(this.ballVx);
    } else if (this.ball.x + BALL_R > GAME_W) {
      this.ball.x = GAME_W - BALL_R;
      this.ballVx = -Math.abs(this.ballVx);
    }
    // Top wall.
    if (this.ball.y - BALL_R < 0) {
      this.ball.y = BALL_R;
      this.ballVy = Math.abs(this.ballVy);
    }
    // Bottom → drop a life.
    if (this.ball.y - BALL_R > GAME_H) {
      this.loseLife();
      return;
    }

    this.checkPaddleCollision();
    this.checkBrickCollisions();

    if (this.bricks.length > 0 && this.bricks.every((b) => !b.alive)) {
      this.winRound();
    }
  }

  private checkPaddleCollision(): void {
    if (!this.ball || !this.paddle) return;
    if (this.ballVy <= 0) return; // only when descending
    const px = this.paddle.x - PADDLE_W / 2;
    const py = PADDLE_Y - PADDLE_H / 2;
    const closestX = Phaser.Math.Clamp(this.ball.x, px, px + PADDLE_W);
    const closestY = Phaser.Math.Clamp(this.ball.y, py, py + PADDLE_H);
    const dx = this.ball.x - closestX;
    const dy = this.ball.y - closestY;
    if (dx * dx + dy * dy > BALL_R * BALL_R) return;
    // Bounce angle from where the ball struck the paddle.
    const offset = Phaser.Math.Clamp(
      (this.ball.x - this.paddle.x) / (PADDLE_W / 2),
      -1,
      1,
    );
    const angle = offset * MAX_BOUNCE_ANGLE;
    this.ballVx = BALL_SPEED * Math.sin(angle);
    this.ballVy = -BALL_SPEED * Math.cos(angle);
    // Park the ball just above the paddle so it never tunnels through.
    this.ball.y = py - BALL_R;
  }

  private checkBrickCollisions(): void {
    if (!this.ball) return;
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const s = brick.sprite;
      const bx = s.x - BRICK_W / 2;
      const by = s.y - BRICK_H / 2;
      const closestX = Phaser.Math.Clamp(this.ball.x, bx, bx + BRICK_W);
      const closestY = Phaser.Math.Clamp(this.ball.y, by, by + BRICK_H);
      const dx = this.ball.x - closestX;
      const dy = this.ball.y - closestY;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      // Resolve along the axis of least penetration.
      const overlapX = BALL_R - Math.abs(dx);
      const overlapY = BALL_R - Math.abs(dy);
      if (overlapX < overlapY) {
        this.ballVx = -this.ballVx;
        this.ball.x += dx >= 0 ? overlapX : -overlapX;
      } else {
        this.ballVy = -this.ballVy;
        this.ball.y += dy >= 0 ? overlapY : -overlapY;
      }
      this.destroyBrick(brick);
      // One brick per frame keeps the bounce direction deterministic.
      break;
    }
  }

  // ---- FX --------------------------------------------------------------

  private destroyBrick(brick: Brick): void {
    brick.alive = false;
    const s = brick.sprite;
    this.score += 10;
    this.emitScore();
    this.popBrick(s.x, s.y, THEME.gems[brick.row % THEME.gems.length]);
    this.tweens.add({
      targets: s,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: 200,
      ease: "power2",
      onComplete: () => s.destroy(),
    });
  }

  private popBrick(x: number, y: number, color: string): void {
    const tint = hexToInt(color);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = this.add
        .image(x, y, "particle")
        .setTint(tint)
        .setScale(0.7)
        .setDepth(30);
      const ang = (Math.PI * 2 * i) / n;
      const dist = 14 + Math.random() * 12;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0,
        duration: 280,
        ease: "power2",
        onComplete: () => p.destroy(),
      });
    }
  }

  // ---- Round lifecycle -------------------------------------------------

  private startRound(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.buildWall();
    this.resetBallToPaddle();
    this.livesText?.setText(this.livesLabel());
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private resetBallToPaddle(): void {
    if (!this.paddle || !this.ball) return;
    this.paddle.x = GAME_W / 2;
    this.ball.x = this.paddle.x;
    this.ball.y = PADDLE_Y - PADDLE_H / 2 - BALL_R;
    this.ballVx = 0;
    this.ballVy = 0;
    this.ballStuck = true;
  }

  private loseLife(): void {
    this.lives = Math.max(0, this.lives - 1);
    this.livesText?.setText(this.livesLabel());
    if (this.lives <= 0) {
      this.gameOver();
    } else {
      this.resetBallToPaddle();
    }
  }

  private winRound(): void {
    this.state = "over";
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "All bricks cleared!",
    });
  }

  private gameOver(): void {
    this.state = "over";
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Out of lives",
    });
  }

  // ---- persistence / events -------------------------------------------

  private livesLabel(): string {
    return `LIVES ${this.lives}`;
  }

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
