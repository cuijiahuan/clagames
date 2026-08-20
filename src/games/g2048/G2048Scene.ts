import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- G2048 config ---------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const SIZE = 4; // 4x4 grid
const CELL = 86; // tile size
const GAP = 8; // gap between tiles
const PADDING = 12; // inner padding inside the panel
const BOARD_W = 400; // panel width
const BOARD_H = 400; // panel height (square)
const BOARD_X = (GAME_W - BOARD_W) / 2; // = 25
const BOARD_Y = 200;
// Cell content area: 4 cells + 3 gaps
const INNER_W = SIZE * CELL + (SIZE - 1) * GAP;
// Center the cell block inside the panel inner area so the slight panel
// surplus (panel - 2*padding - inner) is split evenly.
const CONTENT_OFFSET_X = (BOARD_W - 2 * PADDING - INNER_W) / 2;
const CONTENT_OFFSET_Y = (BOARD_H - 2 * PADDING - INNER_W) / 2;
const CELL_ORIGIN_X = BOARD_X + PADDING + CONTENT_OFFSET_X;
const CELL_ORIGIN_Y = BOARD_Y + PADDING + CONTENT_OFFSET_Y;

const BEST_KEY = "clagames.g2048.best";
const SWIPE_THRESHOLD = 24; // px — smaller gestures ignored

type Direction = "left" | "right" | "up" | "down";

interface Tile {
  value: number;
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  r: number;
  c: number;
}

interface MoveEntry {
  tile: Tile;
  toR: number;
  toC: number;
}

interface MergeEntry {
  survivor: Tile;
  victim: Tile;
  newValue: number;
}

// ---- bridge injection (matches Match3Scene pattern) -----------------
let activeBridge: GameBridge | null = null;
export function setBridge(b: GameBridge): void {
  activeBridge = b;
}

/**
 * Swipe 2048 — touch-first 4x4 number merge.
 * Swipe (or arrow keys) to slide all tiles. Equal tiles merge on contact.
 * Reach 2048 to win — but the game only ends when no moves remain.
 * Best score in localStorage.
 */
export class G2048Scene extends Phaser.Scene {
  private bridge!: GameBridge;
  private grid: number[][] = []; // 4x4 values (0 = empty)
  private tiles: (Tile | null)[][] = []; // parallel game objects
  private score = 0;
  private best = 0;
  private state: GameState = "ready";
  private busy = false;
  private pointerDown = false;
  private startX = 0;
  private startY = 0;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "G2048" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();

    // Init grids
    this.grid = [];
    this.tiles = [];
    for (let r = 0; r < SIZE; r++) {
      this.grid.push(new Array(SIZE).fill(0));
      this.tiles.push(new Array(SIZE).fill(null));
    }

    // Background gradient (matches Match3Scene sky).
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

    // Board panel (rounded, THEME.panel).
    const panel = this.add.graphics();
    panel.fillStyle(0x111a33, 0.95);
    panel.fillRoundedRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, 18);
    panel.lineStyle(2, 0x2a3a6b, 1);
    panel.strokeRoundedRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, 18);
    // Empty cell wells for depth.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        panel.fillStyle(0x0b1020, 0.55);
        panel.fillRoundedRect(
          this.cellLeft(c),
          this.cellTop(r),
          CELL,
          CELL,
          10,
        );
      }
    }

    // Title + subtitle.
    const title = this.add
      .text(GAME_W / 2, 70, "SWIPE 2048", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);
    this.add
      .text(GAME_W / 2, 104, "Merge to 2048", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    this.hint = this.add
      .text(
        GAME_W / 2,
        GAME_H - 36,
        "Swipe or use arrow keys to move",
        {
          fontFamily: FONT_FAMILY,
          fontSize: "13px",
          color: THEME.textDim,
        },
      )
      .setOrigin(0.5);

    // Pre-generate the 2/4 textures (used by initial spawns).
    this.ensureTileTexture(2);
    this.ensureTileTexture(4);

    // Spawn 2 preview tiles so the board reads as a game, not a placeholder,
    // behind the ready overlay.
    this.spawnRandomTile();
    this.spawnRandomTile();

    // Input.
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on("keydown-LEFT", () => this.moveIfActive("left"));
      keyboard.on("keydown-RIGHT", () => this.moveIfActive("right"));
      keyboard.on("keydown-UP", () => this.moveIfActive("up"));
      keyboard.on("keydown-DOWN", () => this.moveIfActive("down"));
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
    });

    // Tell React we're ready (shows the "Tap to start" overlay).
    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
  }

  // ---- coordinate helpers -------------------------------------------
  private cellLeft(c: number): number {
    return CELL_ORIGIN_X + c * (CELL + GAP);
  }
  private cellTop(r: number): number {
    return CELL_ORIGIN_Y + r * (CELL + GAP);
  }
  private cellX(c: number): number {
    return this.cellLeft(c) + CELL / 2;
  }
  private cellY(r: number): number {
    return this.cellTop(r) + CELL / 2;
  }

  // ---- color / texture ---------------------------------------------
  // Tile color buckets per spec:
  // 2/4 light, 8/16 orange, 32/64 red-orange, 128/256 purple, 512+ bright.
  private tileColor(value: number): { fill: string; text: string } {
    if (value <= 4) return { fill: "#eee4da", text: "#1a1a1a" };
    if (value <= 16) return { fill: "#f2b179", text: "#1a1a1a" };
    if (value <= 64) return { fill: "#f65e3b", text: "#ffffff" };
    if (value <= 256) return { fill: "#9333ea", text: "#ffffff" };
    if (value <= 1024) return { fill: "#facc15", text: "#1a1a1a" };
    return { fill: "#fde047", text: "#1a1a1a" };
  }
  // Font size shrinks as the digit count grows so 2048 still fits the cell.
  private fontSizeFor(value: number): number {
    if (value < 100) return 36;
    if (value < 1000) return 30;
    if (value < 10000) return 24;
    return 18;
  }
  private ensureTileTexture(value: number): void {
    const key = `tile-${value}`;
    if (this.textures.exists(key)) return;
    const { fill } = this.tileColor(value);
    const [rr, gg, bb] = hexToRgb(fill);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    // soft drop shadow
    g.fillStyle(0x000000, 0.25);
    g.fillRoundedRect(2, 4, CELL - 4, CELL - 4, 12);
    // base
    g.fillStyle(Phaser.Display.Color.GetColor(rr, gg, bb), 1);
    g.fillRoundedRect(0, 0, CELL - 4, CELL - 4, 12);
    // top-left highlight (gloss)
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(6, 6, CELL - 16, (CELL - 4) * 0.32, 10);
    g.generateTexture(key, CELL, CELL);
    g.destroy();
  }

  // ---- tile lifecycle ----------------------------------------------
  private createTile(r: number, c: number, value: number): Tile {
    this.ensureTileTexture(value);
    const image = this.add.image(0, 0, `tile-${value}`);
    const { text: textColor } = this.tileColor(value);
    const text = this.add
      .text(0, 0, String(value), {
        fontFamily: FONT_FAMILY,
        fontSize: `${this.fontSizeFor(value)}px`,
        color: textColor,
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const container = this.add.container(this.cellX(c), this.cellY(r), [
      image,
      text,
    ]);
    return { value, container, image, text, r, c };
  }

  private updateTileVisual(tile: Tile): void {
    this.ensureTileTexture(tile.value);
    tile.image.setTexture(`tile-${tile.value}`);
    const { text: textColor } = this.tileColor(tile.value);
    tile.text.setText(String(tile.value));
    tile.text.setStyle({
      fontFamily: FONT_FAMILY,
      fontSize: `${this.fontSizeFor(tile.value)}px`,
      color: textColor,
      fontStyle: "bold",
    });
  }

  private spawnRandomTile(): Tile | null {
    const empties: { r: number; c: number }[] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!this.tiles[r][c]) empties.push({ r, c });
      }
    }
    if (empties.length === 0) return null;
    const pos = empties[Math.floor(Math.random() * empties.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    const tile = this.createTile(pos.r, pos.c, value);
    this.tiles[pos.r][pos.c] = tile;
    this.grid[pos.r][pos.c] = value;
    // pop-in
    tile.container.setScale(0);
    this.tweens.add({
      targets: tile.container,
      scale: 1,
      duration: 180,
      ease: "back.out",
    });
    return tile;
  }

  // ---- input -------------------------------------------------------
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.busy) return;
    this.pointerDown = true;
    this.startX = pointer.x;
    this.startY = pointer.y;
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    if (this.state !== "playing" || this.busy) return;
    const dx = pointer.x - this.startX;
    const dy = pointer.y - this.startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < SWIPE_THRESHOLD && ady < SWIPE_THRESHOLD) return;
    let dir: Direction;
    if (adx > ady) dir = dx > 0 ? "right" : "left";
    else dir = dy > 0 ? "down" : "up";
    this.move(dir);
  }

  private moveIfActive(dir: Direction): void {
    if (this.state !== "playing" || this.busy) return;
    this.move(dir);
  }

  // ---- line iteration for moves -----------------------------------
  // Each line is the list of cell positions in compaction order
  // (left→right for "left", right→left for "right", etc.).
  private getLines(dir: Direction): { r: number; c: number }[][] {
    const lines: { r: number; c: number }[][] = [];
    if (dir === "left" || dir === "right") {
      for (let r = 0; r < SIZE; r++) {
        const line: { r: number; c: number }[] = [];
        for (let c = 0; c < SIZE; c++) line.push({ r, c });
        if (dir === "right") line.reverse();
        lines.push(line);
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        const line: { r: number; c: number }[] = [];
        for (let r = 0; r < SIZE; r++) line.push({ r, c });
        if (dir === "down") line.reverse();
        lines.push(line);
      }
    }
    return lines;
  }

  // ---- core move logic ---------------------------------------------
  // Standard 2048: compact tiles toward the chosen edge, merging equal
  // adjacent pairs (each tile merges at most once per move).
  private move(dir: Direction): void {
    const moves: MoveEntry[] = [];
    const merges: MergeEntry[] = [];
    let moved = false;

    for (const line of this.getLines(dir)) {
      // Collect tiles in line order with their original positions.
      const inLine: { tile: Tile; fromR: number; fromC: number }[] = [];
      for (const pos of line) {
        const t = this.tiles[pos.r][pos.c];
        if (t) inLine.push({ tile: t, fromR: pos.r, fromC: pos.c });
      }
      let writeIdx = 0;
      let i = 0;
      while (i < inLine.length) {
        const cur = inLine[i];
        const next = i + 1 < inLine.length ? inLine[i + 1] : null;
        const target = line[writeIdx];
        if (next && cur.tile.value === next.tile.value) {
          const newValue = cur.tile.value * 2;
          merges.push({
            survivor: cur.tile,
            victim: next.tile,
            newValue,
          });
          moves.push({ tile: cur.tile, toR: target.r, toC: target.c });
          moves.push({ tile: next.tile, toR: target.r, toC: target.c });
          if (cur.fromR !== target.r || cur.fromC !== target.c) moved = true;
          if (next.fromR !== target.r || next.fromC !== target.c) moved = true;
          writeIdx++;
          i += 2;
          continue;
        }
        moves.push({ tile: cur.tile, toR: target.r, toC: target.c });
        if (cur.fromR !== target.r || cur.fromC !== target.c) moved = true;
        writeIdx++;
        i++;
      }
    }

    if (!moved) return;
    this.busy = true;

    // Apply logical positions immediately; visuals lag by the tween.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) this.tiles[r][c] = null;
    }
    const victims = new Set(merges.map((m) => m.victim));
    for (const m of moves) {
      m.tile.r = m.toR;
      m.tile.c = m.toC;
      if (!victims.has(m.tile)) {
        this.tiles[m.toR][m.toC] = m.tile;
      }
    }
    for (const m of merges) {
      m.survivor.value = m.newValue;
      this.score += m.newValue;
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        this.grid[r][c] = this.tiles[r][c] ? this.tiles[r][c]!.value : 0;
      }
    }
    this.emitScore();

    // Animate slide (120ms, per spec).
    for (const m of moves) {
      this.tweens.add({
        targets: m.tile.container,
        x: this.cellX(m.toC),
        y: this.cellY(m.toR),
        duration: 120,
        ease: "quad.inOut",
      });
    }

    this.time.delayedCall(120, () => {
      // Remove victims, refresh survivor visuals + pop emphasis.
      for (const m of merges) {
        m.victim.container.destroy();
      }
      for (const m of merges) {
        this.updateTileVisual(m.survivor);
        this.tweens.add({
          targets: m.survivor.container,
          scale: 1.18,
          duration: 90,
          ease: "back.out",
          yoyo: true,
        });
      }
      // Spawn a new tile (2 @90%, 4 @10%) per spec.
      this.spawnRandomTile();
      if (!this.hasMovesAvailable()) {
        this.gameOver();
      } else {
        this.busy = false;
      }
    });
  }

  // ---- game-over detection ----------------------------------------
  private hasMovesAvailable(): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.grid[r][c] === 0) return true;
      }
    }
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = this.grid[r][c];
        if (c < SIZE - 1 && this.grid[r][c + 1] === v) return true;
        if (r < SIZE - 1 && this.grid[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  // ---- round lifecycle --------------------------------------------
  private startRound(): void {
    // Clear existing tiles.
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        this.tiles[r][c]?.container.destroy();
        this.tiles[r][c] = null;
        this.grid[r][c] = 0;
      }
    }
    this.score = 0;
    this.busy = false;
    this.pointerDown = false;
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
    // Place 2 starter tiles.
    this.spawnRandomTile();
    this.spawnRandomTile();
  }

  private gameOver(): void {
    this.state = "over";
    this.busy = true;
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "No moves left",
    });
  }

  // ---- persistence / events --------------------------------------
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

// ---- module-level helpers -----------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
