import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Snake config ---------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const COLS = 22;
const ROWS = 30;
const CELL = 18;
const BOARD_W = COLS * CELL; // 396
const BOARD_H = ROWS * CELL; // 540
const BOARD_X = (GAME_W - BOARD_W) / 2; // 27
const BOARD_Y = 160; // leave room for the title
const INITIAL_LENGTH = 3;
const BASE_INTERVAL = 150; // ms per step at score 0
const MIN_INTERVAL = 60; // fastest step
const SPEED_STEP = 8; // ms shaved off per SPEED_EVERY points
const SPEED_EVERY = 5; // speed-up threshold
const SWIPE_THRESHOLD = 12; // px below which a tap is ignored
const BEST_KEY = "clagames.snake.best";

type Dir = "up" | "down" | "left" | "right";
interface Cell {
  x: number;
  y: number;
}

const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, t: number): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return Phaser.Display.Color.GetColor(r, g, bb);
}

function toColorInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Phaser.Display.Color.GetColor(r, g, b);
}

/**
 * Neon Snake — classic snake with a neon coat.
 * Touch-first: swipe anywhere on the board to steer. Keyboard arrows / WASD
 * also work. Eat the glowing food to grow; hitting a wall or yourself ends
 * the round. Speed scales with score; best score saved in localStorage.
 *
 * The React wrapper injects its GameBridge here before the scene boots, so
 * we can pass the scene CLASS to Phaser (which builds a fresh instance per
 * game). This avoids reusing a destroyed instance under React StrictMode.
 */
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class SnakeScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private score = 0;
  private best = 0;
  private state: GameState = "ready";
  private timerEvent?: Phaser.Time.TimerEvent;
  private moveAccumulator = 0;
  private snake: Cell[] = [];
  private segments: Phaser.GameObjects.Image[] = [];
  private dir: Dir = "right";
  private pendingDir: Dir = "right";
  private food?: Phaser.GameObjects.Image;
  private foodCell: Cell = { x: 0, y: 0 };
  private pointerDownAt: { x: number; y: number } | null = null;

  constructor() {
    super({ key: "Snake" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();
    this.moveAccumulator = 0;

    this.makeTextures();
    this.drawBackground();
    this.drawTitle();

    // Food sprite (repositioned each spawn, never destroyed between rounds).
    this.food = this.add.image(0, 0, "food").setDepth(5).setVisible(false);

    this.resetSnake();

    // Touch input — swipe direction is resolved on pointerup.
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    // Keyboard: arrows + WASD.
    const kb = this.input.keyboard;
    if (kb) {
      kb.on("keydown-LEFT", () => this.queueDir("left"));
      kb.on("keydown-RIGHT", () => this.queueDir("right"));
      kb.on("keydown-UP", () => this.queueDir("up"));
      kb.on("keydown-DOWN", () => this.queueDir("down"));
      kb.on("keydown-A", () => this.queueDir("left"));
      kb.on("keydown-D", () => this.queueDir("right"));
      kb.on("keydown-W", () => this.queueDir("up"));
      kb.on("keydown-S", () => this.queueDir("down"));
    }

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
      this.timerEvent?.remove();
    });

    // Tell React we're ready (shows the "Tap to start" overlay).
    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
  }

  update(_time: number, delta: number): void {
    if (this.state !== "playing") return;
    this.moveAccumulator += delta;
    // Clamp big frame gaps (e.g. tab returning to focus) so the snake
    // doesn't fast-forward through itself.
    if (this.moveAccumulator > 1000) this.moveAccumulator = 0;
    const interval = this.currentInterval();
    while (this.moveAccumulator >= interval) {
      this.moveAccumulator -= interval;
      this.step();
      if (this.state !== "playing") break;
    }
  }

  // ---- Setup ----------------------------------------------------------

  private cellX(x: number): number {
    return BOARD_X + x * CELL + CELL / 2;
  }
  private cellY(y: number): number {
    return BOARD_Y + y * CELL + CELL / 2;
  }

  private makeTextures(): void {
    const segSize = CELL - 2; // 16 — leaves a 2px gap for a tiled look

    // Body segment (rounded square with subtle shading).
    const gBody = this.make.graphics({ x: 0, y: 0 }, false);
    gBody.fillStyle(0x000000, 0.3);
    gBody.fillRoundedRect(1, 2, segSize, segSize, 5);
    gBody.fillStyle(toColorInt(THEME.accent), 1);
    gBody.fillRoundedRect(0, 0, segSize, segSize, 5);
    gBody.fillStyle(mixHex(THEME.accent, "#000000", 0.28), 0.55);
    gBody.fillRoundedRect(0, segSize * 0.5, segSize, segSize * 0.5 - 1, 4);
    gBody.fillStyle(mixHex(THEME.accent, "#ffffff", 0.5), 0.7);
    gBody.fillRoundedRect(2, 2, segSize * 0.4, segSize * 0.25, 3);
    gBody.generateTexture("seg", segSize, segSize);
    gBody.destroy();

    // Head — brighter body with eyes.
    const gHead = this.make.graphics({ x: 0, y: 0 }, false);
    gHead.fillStyle(0x000000, 0.3);
    gHead.fillRoundedRect(1, 2, segSize, segSize, 5);
    gHead.fillStyle(mixHex(THEME.accent, "#ffffff", 0.35), 1);
    gHead.fillRoundedRect(0, 0, segSize, segSize, 5);
    gHead.fillStyle(mixHex(THEME.accent, "#ffffff", 0.7), 0.55);
    gHead.fillRoundedRect(2, 2, segSize * 0.5, segSize * 0.3, 3);
    gHead.fillStyle(0x0b1020, 1);
    gHead.fillCircle(4.5, 5, 1.8);
    gHead.fillCircle(segSize - 4.5, 5, 1.8);
    gHead.fillStyle(0xffffff, 1);
    gHead.fillCircle(5, 4.5, 0.7);
    gHead.fillCircle(segSize - 4, 4.5, 0.7);
    gHead.generateTexture("head", segSize, segSize);
    gHead.destroy();

    // Food — glowing dot.
    const foodSize = CELL + 6; // 24 — slightly larger than a cell for a soft halo
    const gFood = this.make.graphics({ x: 0, y: 0 }, false);
    const fc = foodSize / 2;
    gFood.fillStyle(toColorInt(THEME.danger), 0.12);
    gFood.fillCircle(fc, fc, foodSize / 2);
    gFood.fillStyle(toColorInt(THEME.danger), 0.28);
    gFood.fillCircle(fc, fc, (foodSize / 2) * 0.78);
    gFood.fillStyle(toColorInt(THEME.danger), 1);
    gFood.fillCircle(fc, fc, (foodSize / 2) * 0.55);
    gFood.fillStyle(mixHex(THEME.danger, "#ffffff", 0.7), 0.95);
    gFood.fillCircle(fc - 1.5, fc - 1.5, (foodSize / 2) * 0.2);
    gFood.generateTexture("food", foodSize, foodSize);
    gFood.destroy();
  }

  private drawBackground(): void {
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

    // Board panel.
    const panel = this.add.graphics();
    panel.fillStyle(0x111a33, 0.85);
    panel.fillRoundedRect(
      BOARD_X - 10,
      BOARD_Y - 10,
      BOARD_W + 20,
      BOARD_H + 20,
      14,
    );
    panel.lineStyle(2, 0x2a3a6b, 1);
    panel.strokeRoundedRect(
      BOARD_X - 10,
      BOARD_Y - 10,
      BOARD_W + 20,
      BOARD_H + 20,
      14,
    );

    // Faint grid lines for depth.
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x2a3a6b, 0.35);
    for (let c = 1; c < COLS; c++) {
      const x = BOARD_X + c * CELL;
      grid.beginPath();
      grid.moveTo(x, BOARD_Y);
      grid.lineTo(x, BOARD_Y + BOARD_H);
      grid.strokePath();
    }
    for (let r = 1; r < ROWS; r++) {
      const y = BOARD_Y + r * CELL;
      grid.beginPath();
      grid.moveTo(BOARD_X, y);
      grid.lineTo(BOARD_X + BOARD_W, y);
      grid.strokePath();
    }
  }

  private drawTitle(): void {
    const title = this.add
      .text(GAME_W / 2, 70, "NEON SNAKE", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);
    this.add
      .text(GAME_W / 2, 104, "Swipe to steer • eat to grow", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, GAME_H - 36, "Swipe / arrows / WASD to turn", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);
  }

  // ---- Round lifecycle ------------------------------------------------

  private resetSnake(): void {
    // Destroy any existing segments (e.g. on restart after game over).
    for (const s of this.segments) {
      this.tweens.killTweensOf(s);
      s.destroy();
    }
    this.segments = [];
    this.snake = [];

    // Snake spawns mid-board, 3 segments long, head pointing right.
    const midY = Math.floor(ROWS / 2);
    const headX = Math.floor(COLS / 2) - 1;
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      this.snake.push({ x: headX - i, y: midY });
    }
    for (let i = 0; i < this.snake.length; i++) {
      const tex = i === 0 ? "head" : "seg";
      const sprite = this.add
        .image(this.cellX(this.snake[i].x), this.cellY(this.snake[i].y), tex)
        .setDepth(10);
      this.segments.push(sprite);
    }
    this.dir = "right";
    this.pendingDir = "right";
    this.moveAccumulator = 0;
    this.spawnFood();
  }

  private spawnFood(): void {
    // Pick a random cell not occupied by the snake. Sample a few random
    // cells first (fast for sparse boards); fall back to a linear scan.
    const occupied = new Set<number>();
    for (const c of this.snake) occupied.add(c.y * COLS + c.x);
    const total = ROWS * COLS;
    let pick = -1;
    for (let tries = 0; tries < 16; tries++) {
      const idx = Phaser.Math.Between(0, total - 1);
      if (!occupied.has(idx)) {
        pick = idx;
        break;
      }
    }
    if (pick === -1) {
      for (let i = 0; i < total; i++) {
        if (!occupied.has(i)) {
          pick = i;
          break;
        }
      }
    }
    if (pick === -1) {
      // Board is full — that's a win in classic snake.
      if (this.food) this.food.setVisible(false);
      this.gameOver("You filled the board!");
      return;
    }
    this.foodCell = { x: pick % COLS, y: Math.floor(pick / COLS) };
    if (this.food) {
      this.food
        .setPosition(this.cellX(this.foodCell.x), this.cellY(this.foodCell.y))
        .setVisible(true)
        .setScale(1)
        .setAlpha(1);
      this.tweens.killTweensOf(this.food);
      // Gentle pulse so the food reads as "alive".
      this.tweens.add({
        targets: this.food,
        scale: 1.15,
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: "sine.inOut",
      });
    }
  }

  private startRound(): void {
    this.timerEvent?.remove();
    this.resetSnake();
    this.score = 0;
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private gameOver(reason = "Game over"): void {
    if (this.state === "over") return;
    this.state = "over";
    this.saveBest();
    this.emitScore();
    this.flashSnake();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason,
    });
  }

  private flashSnake(): void {
    // Tint the body red and pulse alpha so the death reads clearly.
    for (const s of this.segments) s.setTint(0xff4444);
    this.tweens.add({
      targets: this.segments,
      alpha: 0.4,
      duration: 120,
      yoyo: true,
      repeat: 3,
      onComplete: () => {
        for (const s of this.segments) {
          s.clearTint();
          s.setAlpha(1);
        }
      },
    });
  }

  // ---- Movement -------------------------------------------------------

  private currentInterval(): number {
    const steps = Math.floor(this.score / SPEED_EVERY);
    return Math.max(MIN_INTERVAL, BASE_INTERVAL - steps * SPEED_STEP);
  }

  private step(): void {
    this.dir = this.pendingDir;
    const head = this.snake[0];
    const next: Cell = { x: head.x, y: head.y };
    if (this.dir === "right") next.x++;
    else if (this.dir === "left") next.x--;
    else if (this.dir === "up") next.y--;
    else if (this.dir === "down") next.y++;

    // Wall collision.
    if (next.x < 0 || next.x >= COLS || next.y < 0 || next.y >= ROWS) {
      this.gameOver();
      return;
    }

    const willEat = next.x === this.foodCell.x && next.y === this.foodCell.y;
    // Self collision. When not eating, the tail moves out of the way, so the
    // current tail cell is reachable. When eating, the tail stays.
    const checkLen = willEat ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (this.snake[i].x === next.x && this.snake[i].y === next.y) {
        this.gameOver();
        return;
      }
    }

    this.snake.unshift(next);
    if (willEat) {
      this.score++;
      this.emitScore();
      // Grow: append a new body sprite (repositioned below). segments[0]
      // stays the head sprite; segments[1..] keep the body texture.
      const sprite = this.add.image(0, 0, "seg").setDepth(10);
      this.segments.push(sprite);
      this.spawnFood();
    } else {
      this.snake.pop();
    }

    // Realign sprite positions to the new snake cells.
    for (let i = 0; i < this.segments.length; i++) {
      const cell = this.snake[i];
      this.segments[i].setPosition(this.cellX(cell.x), this.cellY(cell.y));
    }
  }

  // ---- Input ----------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing") return;
    this.pointerDownAt = { x: pointer.x, y: pointer.y };
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.pointerDownAt || this.state !== "playing") {
      this.pointerDownAt = null;
      return;
    }
    const dx = pointer.x - this.pointerDownAt.x;
    const dy = pointer.y - this.pointerDownAt.y;
    this.pointerDownAt = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
      return; // treat as a tap — no turn
    }
    // Pick the dominant axis.
    if (Math.abs(dx) > Math.abs(dy)) {
      this.queueDir(dx > 0 ? "right" : "left");
    } else {
      this.queueDir(dy > 0 ? "down" : "up");
    }
  }

  private queueDir(d: Dir): void {
    // Reject 180° reversals relative to the committed direction so a fast
    // double-swipe can't suicide the snake.
    if (OPPOSITE[this.dir] === d) return;
    this.pendingDir = d;
  }

  // ---- persistence / events ------------------------------------------

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
