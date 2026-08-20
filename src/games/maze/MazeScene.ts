import Phaser from "@/lib/phaser";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Maze config ------------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const BOARD_REGION_X = 25;
const BOARD_REGION_Y = 160;
const BOARD_REGION_W = 400;
const BOARD_REGION_H = 500;
const ROUND_SECONDS = 60;
const LEVEL_TIME_BONUS = 8;
const START_N = 8;
const MAX_N = 14;
const BEST_KEY = "clagames.maze.best";

const WALL_COLOR = 0x4a5e9a;
const PANEL_FILL = 0x111a33;
const PANEL_STROKE = 0x2a3a6b;
const TEXTURE_SIZE = 32;

interface MazeWalls {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}
interface MazeCell {
  walls: MazeWalls;
  visited: boolean;
}
interface Pos {
  r: number;
  c: number;
}
type Dir = "top" | "right" | "bottom" | "left";

function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

const ACCENT = hexToInt(THEME.accent);
const GOAL = hexToInt(THEME.warning);
const BG_TOP = hexToInt(THEME.bgGradientTop);
const BG_BOTTOM = hexToInt(THEME.bgGradientBottom);

/**
 * Maze Run — a casual maze navigator.
 * Swipe (or arrow keys) to move the dot through a perfect maze to the gold
 * exit. Each level cleared adds points and a +8s bonus, but the maze grows
 * every level. 60-second round. Best total score in localStorage.
 *
 * Bridge injection mirrors Match3Scene: the React wrapper calls setBridge()
 * before PhaserGame mounts so create() can read the active bridge. We pass
 * the scene CLASS (not an instance) to Phaser, which builds a fresh instance
 * per game — safe under React StrictMode dev double-mount.
 */
let activeBridge: GameBridge | null = null;
export function setBridge(b: GameBridge): void {
  activeBridge = b;
}

export class MazeScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private score = 0;
  private best = 0;
  private level = 1;
  private n = START_N;
  private cell = 0;
  private boardX = 0;
  private boardY = 0;
  private grid: MazeCell[][] = [];
  private playerR = 0;
  private playerC = 0;
  private state: GameState = "ready";
  private timerEvent?: Phaser.Time.TimerEvent;
  private remaining = ROUND_SECONDS;
  private busy = false;
  private swipeStart?: { x: number; y: number };

  private panelG?: Phaser.GameObjects.Graphics;
  private wallsG?: Phaser.GameObjects.Graphics;
  private player?: Phaser.GameObjects.Image;
  private goal?: Phaser.GameObjects.Image;
  private levelText?: Phaser.GameObjects.Text;
  private bonusText?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "Maze" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();
    this.makeTextures();

    // Background gradient.
    this.cameras.main.setBackgroundColor(THEME.bg);
    const bg = this.add.graphics();
    bg.fillGradientStyle(BG_TOP, BG_TOP, BG_BOTTOM, BG_BOTTOM, 1);
    bg.fillRect(0, 0, GAME_W, GAME_H);

    // Title + subtitle.
    const title = this.add
      .text(GAME_W / 2, 70, "MAZE RUN", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: THEME.text,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);
    this.add
      .text(GAME_W / 2, 104, "Swipe or arrow keys • reach the gold exit", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // Reusable graphics layers (cleared + redrawn each level).
    this.panelG = this.add.graphics();
    this.wallsG = this.add.graphics();

    this.levelText = this.add
      .text(GAME_W / 2, BOARD_REGION_Y - 18, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "16px",
        color: THEME.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.bonusText = this.add
      .text(GAME_W / 2, BOARD_REGION_Y + BOARD_REGION_H + 20, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        color: THEME.warning,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.goal = this.add.image(0, 0, "maze-goal").setDepth(5);
    this.player = this.add.image(0, 0, "maze-player").setDepth(10);

    this.add
      .text(
        GAME_W / 2,
        GAME_H - 36,
        "Swipe / arrows to move • bigger maze each level",
        {
          fontFamily: FONT_FAMILY,
          fontSize: "13px",
          color: THEME.textDim,
        },
      )
      .setOrigin(0.5);

    // Build the initial level-1 maze so the board is visible behind the
    // "Tap to Start" overlay (mirrors Match3's fillInitialGrid in create).
    this.level = 1;
    this.buildLevel();

    // Input.
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    const kb = this.input.keyboard;
    if (kb) {
      kb.on("keydown-LEFT", () => this.tryMove(0, -1));
      kb.on("keydown-RIGHT", () => this.tryMove(0, 1));
      kb.on("keydown-UP", () => this.tryMove(-1, 0));
      kb.on("keydown-DOWN", () => this.tryMove(1, 0));
    }

    // React -> Phaser controls. Remove on shutdown so a recreated game
    // doesn't leak handlers. Guard with isActive() in case a start event
    // races with shutdown (this.add/this.tweens are null after destroy).
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

    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
  }

  // ---- Textures (runtime, no image assets) ---------------------------

  private makeTextures(): void {
    if (this.textures.exists("maze-player")) return;

    const p = this.make.graphics({ x: 0, y: 0 }, false);
    p.fillStyle(ACCENT, 0.22);
    p.fillCircle(16, 16, 16);
    p.fillStyle(ACCENT, 1);
    p.fillCircle(16, 16, 13);
    p.fillStyle(0x0b1020, 1);
    p.fillCircle(11, 13, 2.6);
    p.fillCircle(21, 13, 2.6);
    p.fillStyle(0xffffff, 1);
    p.fillCircle(12, 12.2, 1);
    p.fillCircle(22, 12.2, 1);
    p.generateTexture("maze-player", TEXTURE_SIZE, TEXTURE_SIZE);
    p.destroy();

    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(GOAL, 0.25);
    g.fillCircle(16, 16, 16);
    g.lineStyle(2, GOAL, 1);
    g.strokeCircle(16, 16, 12);
    g.fillStyle(GOAL, 1);
    g.fillCircle(16, 16, 7);
    g.generateTexture("maze-goal", TEXTURE_SIZE, TEXTURE_SIZE);
    g.destroy();
  }

  // ---- Level / maze setup --------------------------------------------

  /** Compute layout + generate + redraw for the current `this.level`. */
  private buildLevel(): void {
    this.n = Math.min(START_N + (this.level - 1), MAX_N);
    this.cell = Math.floor(
      Math.min(BOARD_REGION_W, BOARD_REGION_H) / this.n,
    );
    const boardSize = this.cell * this.n;
    this.boardX = BOARD_REGION_X + (BOARD_REGION_W - boardSize) / 2;
    this.boardY = BOARD_REGION_Y + (BOARD_REGION_H - boardSize) / 2;

    this.grid = this.generateMaze(this.n);
    this.playerR = 0;
    this.playerC = 0;
    this.drawPanel(boardSize);
    this.drawWalls();
    this.placeGoal();
    this.placePlayer(true);
    const lt = this.levelText;
    if (lt) lt.setText(`LEVEL ${this.level}`);
  }

  private drawPanel(boardSize: number): void {
    const pg = this.panelG;
    if (!pg) return;
    pg.clear();
    pg.fillStyle(PANEL_FILL, 0.9);
    pg.fillRoundedRect(
      this.boardX - 12,
      this.boardY - 12,
      boardSize + 24,
      boardSize + 24,
      16,
    );
    pg.lineStyle(2, PANEL_STROKE, 1);
    pg.strokeRoundedRect(
      this.boardX - 12,
      this.boardY - 12,
      boardSize + 24,
      boardSize + 24,
      16,
    );
  }

  private drawWalls(): void {
    const w = this.wallsG;
    if (!w) return;
    w.clear();
    w.lineStyle(3, WALL_COLOR, 1);
    w.beginPath();
    const n = this.n;
    const cell = this.cell;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const x = this.boardX + c * cell;
        const y = this.boardY + r * cell;
        const walls = this.grid[r][c].walls;
        if (walls.top) {
          w.moveTo(x, y);
          w.lineTo(x + cell, y);
        }
        if (walls.bottom) {
          w.moveTo(x, y + cell);
          w.lineTo(x + cell, y + cell);
        }
        if (walls.left) {
          w.moveTo(x, y);
          w.lineTo(x, y + cell);
        }
        if (walls.right) {
          w.moveTo(x + cell, y);
          w.lineTo(x + cell, y + cell);
        }
      }
    }
    w.strokePath();
  }

  private placePlayer(instant: boolean, onDone?: () => void): void {
    const p = this.player;
    if (!p) {
      onDone?.();
      return;
    }
    const x = this.cellCenterX(this.playerC);
    const y = this.cellCenterY(this.playerR);
    const scale = (this.cell * 0.62) / TEXTURE_SIZE;
    p.setScale(scale).setDepth(10);
    if (instant) {
      p.setPosition(x, y);
      onDone?.();
    } else {
      this.tweens.add({
        targets: p,
        x,
        y,
        duration: 110,
        ease: "quad.out",
        onComplete: () => onDone?.(),
      });
    }
  }

  private placeGoal(): void {
    const g = this.goal;
    if (!g) return;
    const x = this.cellCenterX(this.n - 1);
    const y = this.cellCenterY(this.n - 1);
    const base = (this.cell * 0.5) / TEXTURE_SIZE;
    g.setPosition(x, y).setScale(base).setDepth(5).setAlpha(1);
    this.tweens.killTweensOf(g);
    this.tweens.add({
      targets: g,
      scaleX: base * 1.18,
      scaleY: base * 1.18,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });
  }

  private cellCenterX(c: number): number {
    return this.boardX + c * this.cell + this.cell / 2;
  }
  private cellCenterY(r: number): number {
    return this.boardY + r * this.cell + this.cell / 2;
  }

  /** Recursive-backtracker (iterative) perfect maze. */
  private generateMaze(n: number): MazeCell[][] {
    const grid: MazeCell[][] = [];
    for (let r = 0; r < n; r++) {
      grid[r] = [];
      for (let c = 0; c < n; c++) {
        grid[r][c] = {
          walls: { top: true, right: true, bottom: true, left: true },
          visited: false,
        };
      }
    }
    const stack: Pos[] = [{ r: 0, c: 0 }];
    grid[0][0].visited = true;
    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const opts: Array<{ p: Pos; dir: Dir }> = [];
      if (cur.r > 0 && !grid[cur.r - 1][cur.c].visited)
        opts.push({ p: { r: cur.r - 1, c: cur.c }, dir: "top" });
      if (cur.c < n - 1 && !grid[cur.r][cur.c + 1].visited)
        opts.push({ p: { r: cur.r, c: cur.c + 1 }, dir: "right" });
      if (cur.r < n - 1 && !grid[cur.r + 1][cur.c].visited)
        opts.push({ p: { r: cur.r + 1, c: cur.c }, dir: "bottom" });
      if (cur.c > 0 && !grid[cur.r][cur.c - 1].visited)
        opts.push({ p: { r: cur.r, c: cur.c - 1 }, dir: "left" });
      if (opts.length === 0) {
        stack.pop();
        continue;
      }
      const pick = opts[Phaser.Math.Between(0, opts.length - 1)];
      const curWalls = grid[cur.r][cur.c].walls;
      const nxtWalls = grid[pick.p.r][pick.p.c].walls;
      if (pick.dir === "top") {
        curWalls.top = false;
        nxtWalls.bottom = false;
      } else if (pick.dir === "right") {
        curWalls.right = false;
        nxtWalls.left = false;
      } else if (pick.dir === "bottom") {
        curWalls.bottom = false;
        nxtWalls.top = false;
      } else {
        curWalls.left = false;
        nxtWalls.right = false;
      }
      grid[pick.p.r][pick.p.c].visited = true;
      stack.push(pick.p);
    }
    return grid;
  }

  // ---- Input ----------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.busy) return;
    this.swipeStart = { x: pointer.x, y: pointer.y };
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const start = this.swipeStart;
    this.swipeStart = undefined;
    if (this.state !== "playing" || this.busy || !start) return;
    const dx = pointer.x - start.x;
    const dy = pointer.y - start.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 12) return; // ignore taps/noise
    if (ax > ay) this.tryMove(0, dx > 0 ? 1 : -1);
    else this.tryMove(dy > 0 ? 1 : -1, 0);
  }

  private tryMove(dr: number, dc: number): void {
    if (this.state !== "playing" || this.busy) return;
    const r = this.playerR;
    const c = this.playerC;
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= this.n || nc < 0 || nc >= this.n) return;
    const walls = this.grid[r][c].walls;
    if (dr === -1 && walls.top) return;
    if (dr === 1 && walls.bottom) return;
    if (dc === -1 && walls.left) return;
    if (dc === 1 && walls.right) return;

    this.busy = true;
    this.playerR = nr;
    this.playerC = nc;
    this.placePlayer(false, () => {
      this.busy = false;
      if (this.playerR === this.n - 1 && this.playerC === this.n - 1) {
        this.completeLevel();
      }
    });
  }

  private completeLevel(): void {
    this.score += this.level;
    this.level += 1;
    this.remaining += LEVEL_TIME_BONUS;
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
    this.flashBonus(`+${LEVEL_TIME_BONUS}s  •  LEVEL ${this.level}`);
    this.buildLevel();
    const p = this.player;
    if (p) {
      const s = p.scaleX;
      p.setScale(s * 1.4);
      this.tweens.add({
        targets: p,
        scaleX: s,
        scaleY: s,
        duration: 220,
        ease: "back.out",
      });
    }
  }

  private flashBonus(text: string): void {
    const t = this.bonusText;
    if (!t) return;
    t.setText(text);
    this.tweens.killTweensOf(t);
    t.setAlpha(0).setScale(0.85);
    this.tweens.add({
      targets: t,
      alpha: 1,
      scale: 1,
      duration: 160,
      ease: "back.out",
      onComplete: () => {
        this.tweens.add({
          targets: t,
          alpha: 0,
          duration: 800,
          delay: 500,
        });
      },
    });
  }

  // ---- Round lifecycle ------------------------------------------------

  private startRound(): void {
    this.timerEvent?.remove();
    this.score = 0;
    this.level = 1;
    this.remaining = ROUND_SECONDS;
    this.busy = false;
    this.swipeStart = undefined;
    this.state = "playing";
    this.buildLevel();
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      repeat: Infinity,
      callback: () => {
        if (this.state !== "playing") return;
        this.remaining = Math.max(0, this.remaining - 1);
        this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
        if (this.remaining <= 0) this.gameOver();
      },
    });
  }

  private gameOver(): void {
    this.state = "over";
    this.timerEvent?.remove();
    this.busy = true;
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Time's up!",
    });
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
    if (this.score > this.best) {
      this.best = this.score;
      if (typeof window !== "undefined") {
        localStorage.setItem(BEST_KEY, String(this.best));
      }
    }
  }
}
