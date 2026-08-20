import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- TicTac config ----------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const COLS = 3;
const ROWS = 3;
const CELL = 120;
const BOARD_W = COLS * CELL; // 360
const BOARD_H = ROWS * CELL; // 360
const BOARD_X = 45;
const BOARD_Y = 220;
const BEST_KEY = "clagames.tictac.best";
const AI_THINK_MS = 400;
const WIN_FLASH_MS = 420;

type CellValue = 0 | 1 | 2; // 0 empty, 1 player X, 2 AI O
type PlaySide = 1 | 2;
type EndResult = "win" | "lose" | "draw";
type LineTriple = [number, number, number];

// 8 winning lines (3 rows, 3 cols, 2 diagonals) as cell indices.
const LINES: LineTriple[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const CORNERS = [0, 2, 6, 8];
const EDGES = [1, 3, 5, 7];
const CENTER = 4;

function hexToColor(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

/**
 * TicTac — noughts & crosses vs a simple AI.
 * Player is X (teal), AI is O (red), player goes first.
 * Win = +1 to the current win streak; lose/draw = streak reset to 0.
 * Best = highest streak ever, persisted in localStorage.
 */
export class TicTacScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private score = 0;
  private best = 0;
  private state: GameState = "ready";
  private board: CellValue[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  private turn: PlaySide = 1;
  private busy = false;
  private pieces: Phaser.GameObjects.Image[] = [];
  private winLine?: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: "TicTac" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();

    // Background gradient.
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

    this.makeTextures();

    // Board panel (rounded square).
    const panel = this.add.graphics();
    panel.fillStyle(0x111a33, 0.9);
    panel.fillRoundedRect(
      BOARD_X - 12,
      BOARD_Y - 12,
      BOARD_W + 24,
      BOARD_H + 24,
      20,
    );
    panel.lineStyle(2, 0x2a3a6b, 1);
    panel.strokeRoundedRect(
      BOARD_X - 12,
      BOARD_Y - 12,
      BOARD_W + 24,
      BOARD_H + 24,
      20,
    );

    // Grid lines (2 vertical + 2 horizontal), inset so they don't poke the panel edge.
    const grid = this.add.graphics();
    grid.lineStyle(3, 0x2a3a6b, 1);
    for (let i = 1; i < COLS; i++) {
      const x = BOARD_X + i * CELL;
      grid.lineBetween(x, BOARD_Y + 6, x, BOARD_Y + BOARD_H - 6);
    }
    for (let i = 1; i < ROWS; i++) {
      const y = BOARD_Y + i * CELL;
      grid.lineBetween(BOARD_X + 6, y, BOARD_X + BOARD_W - 6, y);
    }

    // Title + subtitle + hint.
    const title = this.add
      .text(GAME_W / 2, 70, "TICTAC", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 104, "Three in a row • beat the AI", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);

    this.add
      .text(GAME_W / 2, GAME_H - 36, "Tap an empty cell to place X", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

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

  // ---- Textures (runtime-generated, no image assets) -----------------

  private makeTextures(): void {
    const size = CELL; // 120
    const lw = 14; // line width
    const pad = 28; // padding from cell edge
    const accent = hexToColor(THEME.accent);
    const danger = hexToColor(THEME.danger);

    // X texture: two slanted lines with rounded cap dots.
    const xg = this.make.graphics({ x: 0, y: 0 }, false);
    xg.lineStyle(lw, accent, 1);
    xg.lineBetween(pad, pad, size - pad, size - pad);
    xg.lineBetween(size - pad, pad, pad, size - pad);
    xg.fillStyle(accent, 1);
    xg.fillCircle(pad, pad, lw / 2);
    xg.fillCircle(size - pad, pad, lw / 2);
    xg.fillCircle(pad, size - pad, lw / 2);
    xg.fillCircle(size - pad, size - pad, lw / 2);
    xg.generateTexture("tictac-x", size, size);
    xg.destroy();

    // O texture: a ring.
    const og = this.make.graphics({ x: 0, y: 0 }, false);
    og.lineStyle(lw, danger, 1);
    og.strokeCircle(size / 2, size / 2, size / 2 - pad);
    og.generateTexture("tictac-o", size, size);
    og.destroy();
  }

  // ---- Board geometry --------------------------------------------------

  private cellCenter(i: number): [number, number] {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    return [BOARD_X + c * CELL + CELL / 2, BOARD_Y + r * CELL + CELL / 2];
  }

  // ---- Round lifecycle -------------------------------------------------

  private startRound(): void {
    // Clear visuals from any previous round.
    for (const p of this.pieces) p.destroy();
    this.pieces = [];
    this.winLine?.destroy();
    this.winLine = undefined;
    this.board = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.turn = 1;
    this.busy = false;
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  // ---- Input -----------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.busy) return;
    if (this.turn !== 1) return; // only the player triggers input
    const c = Math.floor((pointer.x - BOARD_X) / CELL);
    const r = Math.floor((pointer.y - BOARD_Y) / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const i = r * COLS + c;
    if (this.board[i] !== 0) return;
    this.placePiece(i, 1);
  }

  // ---- Placement / flow -----------------------------------------------

  private placePiece(i: number, who: PlaySide): void {
    if (this.board[i] !== 0) return;
    this.board[i] = who;
    this.busy = true;
    const [cx, cy] = this.cellCenter(i);
    const key = who === 1 ? "tictac-x" : "tictac-o";
    const img = this.add.image(cx, cy, key).setScale(0).setDepth(10);
    this.pieces.push(img);
    this.tweens.add({
      targets: img,
      scale: 1,
      duration: 220,
      ease: "back.out",
      onComplete: () => this.afterMove(who),
    });
  }

  private afterMove(who: PlaySide): void {
    const line = this.findWin(who);
    if (line) {
      this.highlightLine(line);
      this.time.delayedCall(WIN_FLASH_MS, () => {
        this.endGame(who === 1 ? "win" : "lose");
      });
      return;
    }
    if (this.board.every((v) => v !== 0)) {
      this.time.delayedCall(WIN_FLASH_MS, () => this.endGame("draw"));
      return;
    }
    if (who === 1) {
      // Hand turn to AI after a brief "think" pause.
      this.turn = 2;
      this.time.delayedCall(AI_THINK_MS, () => this.aiMove());
    } else {
      // Back to player.
      this.turn = 1;
      this.busy = false;
    }
  }

  // ---- AI -------------------------------------------------------------

  private aiMove(): void {
    let move = this.findCompletingCell(2); // 1) win if possible
    if (move === -1) move = this.findCompletingCell(1); // 2) block player
    if (move === -1 && this.board[CENTER] === 0) move = CENTER; // 3) center
    if (move === -1) {
      const corners = CORNERS.filter((i) => this.board[i] === 0);
      if (corners.length > 0) {
        move = corners[Phaser.Math.Between(0, corners.length - 1)]; // 4) corner
      }
    }
    if (move === -1) {
      const edges = EDGES.filter((i) => this.board[i] === 0);
      if (edges.length > 0) {
        move = edges[Phaser.Math.Between(0, edges.length - 1)]; // 5) edge
      }
    }
    if (move === -1) {
      this.busy = false;
      return;
    }
    this.placePiece(move, 2);
  }

  /** Find the empty cell that would complete a line for `who` (win/block). */
  private findCompletingCell(who: PlaySide): number {
    for (const [a, b, c] of LINES) {
      const cells = [this.board[a], this.board[b], this.board[c]];
      const mine = cells.filter((v) => v === who).length;
      const empty = cells.filter((v) => v === 0).length;
      if (mine === 2 && empty === 1) {
        if (this.board[a] === 0) return a;
        if (this.board[b] === 0) return b;
        if (this.board[c] === 0) return c;
      }
    }
    return -1;
  }

  // ---- Win detection / FX --------------------------------------------

  private findWin(who: PlaySide): LineTriple | null {
    for (const [a, b, c] of LINES) {
      if (
        this.board[a] === who &&
        this.board[b] === who &&
        this.board[c] === who
      ) {
        return [a, b, c];
      }
    }
    return null;
  }

  private highlightLine(line: LineTriple): void {
    const [a, , c] = line;
    const [ax, ay] = this.cellCenter(a);
    const [cx, cy] = this.cellCenter(c);
    const g = this.add.graphics().setDepth(20);
    g.lineStyle(8, hexToColor(THEME.warning), 1);
    g.lineBetween(ax, ay, cx, cy);
    g.setAlpha(0);
    this.tweens.add({
      targets: g,
      alpha: 1,
      duration: 240,
      ease: "quad.out",
    });
    this.winLine = g;
  }

  // ---- End game -------------------------------------------------------

  private endGame(result: EndResult): void {
    this.state = "over";
    this.busy = true;
    if (result === "win") {
      this.score += 1; // streak continues
    } else {
      this.score = 0; // streak broken
    }
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason:
        result === "win" ? "You win!" : result === "lose" ? "AI wins!" : "Draw",
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
    if (typeof window === "undefined") return;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
  }
}
