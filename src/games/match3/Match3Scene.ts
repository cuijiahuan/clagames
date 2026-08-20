import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";
import { makeAllTextures } from "@/games/shared/textures";

// ---- Match-3 config ---------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const COLS = 8;
const ROWS = 8;
const CELL = 52;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const BOARD_X = (GAME_W - BOARD_W) / 2;
const BOARD_Y = 168;
const NUM_TYPES = 6;
const ROUND_SECONDS = 60;
const BEST_KEY = "clagames.match3.best";

interface Gem {
  type: number;
  sprite: Phaser.GameObjects.Image;
  r: number;
  c: number;
}

interface Cell {
  r: number;
  c: number;
}

/**
 * Gem Crush — a casual match-3.
 * Touch-first: tap a gem, then tap an adjacent gem to swap. Cascading clears
 * build a combo multiplier. 60-second rounds. Best score in localStorage.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class Match3Scene extends Phaser.Scene {
  private bridge!: GameBridge;
  private grid: (Gem | null)[][] = [];
  private selected: Cell | null = null;
  private selector?: Phaser.GameObjects.Image;
  private score = 0;
  private best = 0;
  private combo = 0;
  private state: GameState = "ready";
  private timerEvent?: Phaser.Time.TimerEvent;
  private remaining = ROUND_SECONDS;
  private busy = false;
  private comboText?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "Match3" });
  }

  create(): void {
    this.bridge = activeBridge!;
    makeAllTextures(this);
    this.best = this.loadBest();

    // Background.
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
    // checker cells for depth
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if ((r + c) % 2 === 0) {
          panel.fillStyle(0x0b1020, 0.35);
          panel.fillRoundedRect(
            BOARD_X + c * CELL + 3,
            BOARD_Y + r * CELL + 3,
            CELL - 6,
            CELL - 6,
            8,
          );
        }
      }
    }

    // Title + hint.
    const title = this.add
      .text(GAME_W / 2, 70, "GEM CRUSH", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 104, "Match 3+ to clear • chain for combos", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);

    this.comboText = this.add
      .text(GAME_W / 2, BOARD_Y - 40, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "22px",
        color: THEME.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.hint = this.add
      .text(GAME_W / 2, GAME_H - 36, "Tap a gem, then tap an adjacent gem", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    this.selector = this.add.image(0, 0, "selector").setVisible(false);

    this.fillInitialGrid(true);
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
      this.timerEvent?.remove();
    });

    // Tell React we're ready (shows the "Tap to start" overlay).
    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
  }

  // ---- Board setup ----------------------------------------------------

  private cellX(c: number): number {
    return BOARD_X + c * CELL + CELL / 2;
  }
  private cellY(r: number): number {
    return BOARD_Y + r * CELL + CELL / 2;
  }

  private createGem(r: number, c: number, type: number, x: number, y: number): Gem {
    const sprite = this.add.image(x, y, `gem-${type}`).setScale(0.86);
    const gem: Gem = { type, sprite, r, c };
    sprite.setData("gem", gem);
    return gem;
  }

  /** Fill grid avoiding any starting matches. */
  private fillInitialGrid(animate: boolean): void {
    this.grid = [];
    for (let r = 0; r < ROWS; r++) {
      this.grid[r] = [];
      for (let c = 0; c < COLS; c++) {
        const forbidden = new Set<number>();
        if (c >= 2 && this.grid[r][c - 1] && this.grid[r][c - 2]) {
          forbidden.add(this.grid[r][c - 1]!.type);
        }
        if (r >= 2 && this.grid[r - 1] && this.grid[r - 2] && this.grid[r - 1][c] && this.grid[r - 2][c]) {
          forbidden.add(this.grid[r - 1][c]!.type);
        }
        let type = Phaser.Math.Between(0, NUM_TYPES - 1);
        while (forbidden.has(type)) type = Phaser.Math.Between(0, NUM_TYPES - 1);
        const startY = animate ? this.cellY(r) - 240 - c * 14 : this.cellY(r);
        const gem = this.createGem(r, c, type, this.cellX(c), startY);
        this.grid[r][c] = gem;
        if (animate) {
          this.tweens.add({
            targets: gem.sprite,
            y: this.cellY(r),
            duration: 420,
            ease: "cubic.out",
            delay: (r + c) * 14,
          });
        }
      }
    }
    // Make sure the very first board has at least one possible move.
    if (!this.hasPossibleMove()) this.shuffleBoard();
  }

  // ---- Input ----------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.busy) return;
    const c = Math.floor((pointer.x - BOARD_X) / CELL);
    const r = Math.floor((pointer.y - BOARD_Y) / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
      this.selected = null;
      this.selector?.setVisible(false);
      return;
    }
    if (!this.selected) {
      this.select(r, c);
      return;
    }
    if (this.selected.r === r && this.selected.c === c) {
      this.selected = null;
      this.selector?.setVisible(false);
      return;
    }
    if (this.isAdjacent(this.selected, { r, c })) {
      const a = this.selected;
      this.selected = null;
      this.selector?.setVisible(false);
      this.trySwap(a.r, a.c, r, c);
    } else {
      this.select(r, c);
    }
  }

  private select(r: number, c: number): void {
    this.selected = { r, c };
    if (this.selector) {
      this.selector
        .setPosition(this.cellX(c), this.cellY(r))
        .setVisible(true)
        .setDepth(20);
    }
  }

  private isAdjacent(a: Cell, b: Cell): boolean {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  // ---- Swap -----------------------------------------------------------

  private trySwap(r1: number, c1: number, r2: number, c2: number): void {
    const a = this.grid[r1][c1];
    const b = this.grid[r2][c2];
    if (!a || !b) return;
    this.busy = true;
    this.animateSwap(a, b, () => {
      // swap in grid
      this.grid[r1][c1] = b;
      this.grid[r2][c2] = a;
      a.r = r2; a.c = c2; b.r = r1; b.c = c1;
      const matches = this.findMatches();
      if (matches.length > 0) {
        this.combo = 0;
        this.processMatches();
      } else {
        // illegal move — swap back
        this.animateSwap(a, b, () => {
          this.grid[r1][c1] = a;
          this.grid[r2][c2] = b;
          a.r = r1; a.c = c1; b.r = r2; b.c = c2;
          this.busy = false;
        });
      }
    });
  }

  private animateSwap(a: Gem, b: Gem, done: () => void): void {
    const ax = a.sprite.x, ay = a.sprite.y;
    const bx = b.sprite.x, by = b.sprite.y;
    this.tweens.add({
      targets: a.sprite,
      x: bx,
      y: by,
      duration: 170,
      ease: "quad.inOut",
    });
    this.tweens.add({
      targets: b.sprite,
      x: ax,
      y: ay,
      duration: 170,
      ease: "quad.inOut",
      onComplete: done,
    });
  }

  // ---- Match detection ------------------------------------------------

  private findMatches(): Cell[] {
    const matched: boolean[][] = Array.from({ length: ROWS }, () =>
      Array(COLS).fill(false),
    );
    // horizontal
    for (let r = 0; r < ROWS; r++) {
      let runStart = 0;
      for (let c = 1; c <= COLS; c++) {
        const prev = this.grid[r][c - 1];
        const cur = c < COLS ? this.grid[r][c] : null;
        const same = prev && cur && cur.type === prev.type;
        if (!same) {
          if (c - runStart >= 3 && prev) {
            for (let k = runStart; k < c; k++) matched[r][k] = true;
          }
          runStart = c;
        }
      }
    }
    // vertical
    for (let c = 0; c < COLS; c++) {
      let runStart = 0;
      for (let r = 1; r <= ROWS; r++) {
        const prev = this.grid[r - 1][c];
        const cur = r < ROWS ? this.grid[r][c] : null;
        const same = prev && cur && cur.type === prev.type;
        if (!same) {
          if (r - runStart >= 3 && prev) {
            for (let k = runStart; k < r; k++) matched[k][c] = true;
          }
          runStart = r;
        }
      }
    }
    const out: Cell[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (matched[r][c]) out.push({ r, c });
    return out;
  }

  // ---- Clear / collapse / cascade ------------------------------------

  private processMatches(): void {
    const matches = this.findMatches();
    if (matches.length === 0) {
      this.combo = 0;
      if (this.state === "playing" && !this.hasPossibleMove()) {
        this.shuffleBoard(true);
      }
      this.busy = false;
      return;
    }
    this.combo++;
    this.busy = true;
    const cleared = matches.length;
    const points = cleared * 10 * this.combo;
    this.score += points;
    this.emitScore();

    for (const { r, c } of matches) {
      const gem = this.grid[r][c];
      if (!gem) continue;
      this.popGem(gem.sprite.x, gem.sprite.y, THEME.gems[gem.type]);
      this.tweens.add({
        targets: gem.sprite,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: 200,
        ease: "power2",
        onComplete: () => gem.sprite.destroy(),
      });
      this.grid[r][c] = null;
    }
    if (this.combo >= 2) this.showCombo(this.combo);

    this.time.delayedCall(210, () => {
      this.collapse();
      this.time.delayedCall(290, () => this.processMatches());
    });
  }

  private collapse(): void {
    for (let c = 0; c < COLS; c++) {
      let writeRow = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const gem = this.grid[r][c];
        if (gem) {
          if (writeRow !== r) {
            this.grid[writeRow][c] = gem;
            this.grid[r][c] = null;
            gem.r = writeRow;
            this.tweens.add({
              targets: gem.sprite,
              y: this.cellY(writeRow),
              duration: 220,
              ease: "cubic.inOut",
            });
          }
          writeRow--;
        }
      }
      // refill empties (writeRow..0)
      let spawn = 0;
      for (let r = writeRow; r >= 0; r--) {
        spawn++;
        const type = Phaser.Math.Between(0, NUM_TYPES - 1);
        const gem = this.createGem(
          r,
          c,
          type,
          this.cellX(c),
          this.cellY(-spawn),
        );
        this.grid[r][c] = gem;
        this.tweens.add({
          targets: gem.sprite,
          y: this.cellY(r),
          duration: 300,
          ease: "cubic.out",
        });
      }
    }
  }

  // ---- Hints / shuffles ----------------------------------------------

  private hasPossibleMove(): boolean {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (c < COLS - 1) {
          this.swapTypes(r, c, r, c + 1);
          if (this.findMatches().length > 0) {
            this.swapTypes(r, c, r, c + 1);
            return true;
          }
          this.swapTypes(r, c, r, c + 1);
        }
        if (r < ROWS - 1) {
          this.swapTypes(r, c, r + 1, c);
          if (this.findMatches().length > 0) {
            this.swapTypes(r, c, r + 1, c);
            return true;
          }
          this.swapTypes(r, c, r + 1, c);
        }
      }
    }
    return false;
  }

  private swapTypes(r1: number, c1: number, r2: number, c2: number): void {
    const a = this.grid[r1][c1];
    const b = this.grid[r2][c2];
    this.grid[r1][c1] = b;
    this.grid[r2][c2] = a;
  }

  private shuffleBoard(animate = false): void {
    // destroy current gems
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) this.grid[r]?.[c]?.sprite.destroy();
    this.fillInitialGrid(animate);
  }

  // ---- FX -------------------------------------------------------------

  private popGem(x: number, y: number, color: string): void {
    const hex = color.replace("#", "");
    const tint = Phaser.Display.Color.GetColor(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    );
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = this.add
        .image(x, y, "particle")
        .setTint(tint)
        .setScale(0.7)
        .setDepth(30);
      const ang = (Math.PI * 2 * i) / n;
      const dist = 16 + Math.random() * 14;
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

  private showCombo(chain: number): void {
    if (!this.comboText) return;
    this.comboText.setText(`COMBO x${chain}`);
    this.comboText.setAlpha(0).setScale(0.8);
    this.tweens.killTweensOf(this.comboText);
    this.tweens.add({
      targets: this.comboText,
      alpha: 1,
      scale: 1,
      duration: 160,
      ease: "back.out",
      onComplete: () => {
        this.tweens.add({
          targets: this.comboText,
          alpha: 0,
          duration: 700,
          delay: 400,
        });
      },
    });
    this.bridge.emit(GameEvents.Combo, { chain, multiplier: chain });
  }

  // ---- Round lifecycle ------------------------------------------------

  private startRound(): void {
    this.timerEvent?.remove();
    // rebuild board
    this.shuffleBoard(false);
    this.score = 0;
    this.combo = 0;
    this.remaining = ROUND_SECONDS;
    this.busy = false;
    this.selected = null;
    this.selector?.setVisible(false);
    this.state = "playing";
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
    if (this.score > this.best) {
      this.best = this.score;
      this.saveBest();
    }
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
    if (typeof window === "undefined") return;
    localStorage.setItem(BEST_KEY, String(this.best));
  }
}
