import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Pair Up config --------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const COLS = 4;
const ROWS = 4;
const CELL = 86;
const GAP = 8;
const BOARD_W = 400;
const BOARD_H = 400;
const BOARD_X = (GAME_W - BOARD_W) / 2; // 25
const BOARD_Y = 180;
const PADDING = (BOARD_W - (COLS * CELL + (COLS - 1) * GAP)) / 2; // 16
const CELL_ORIGIN_X = BOARD_X + PADDING; // 41
const CELL_ORIGIN_Y = BOARD_Y + PADDING; // 196
const NUM_PATTERNS = 8; // 8 pairs => 16 cards
const BEST_KEY = "clagames.memory.best";
const FLIP_MS = 130;
const MISMATCH_DELAY = 800;

type ShapeKind =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "star"
  | "hexagon"
  | "ring"
  | "starOutline";

interface PatternSpec {
  color: string;
  shape: ShapeKind;
}

// 8 distinct faces: 6 drawn in the gem palette + 2 geometric (ring, star
// outline) in the accent colors. Hollow vs filled keeps every pair unique.
const PATTERNS: PatternSpec[] = [
  { color: THEME.gems[0], shape: "circle" },
  { color: THEME.gems[1], shape: "square" },
  { color: THEME.gems[2], shape: "triangle" },
  { color: THEME.gems[3], shape: "diamond" },
  { color: THEME.gems[4], shape: "star" },
  { color: THEME.gems[5], shape: "hexagon" },
  { color: THEME.accent, shape: "ring" },
  { color: THEME.accent2, shape: "starOutline" },
];

interface Card {
  type: number;
  r: number;
  c: number;
  container: Phaser.GameObjects.Container;
  back: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Image;
  flipped: boolean;
  matched: boolean;
}

interface Pt {
  x: number;
  y: number;
}

// ---- bridge injection (matches Match3Scene pattern) ------------------
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

/**
 * Pair Up — a touch-first memory match (concentration) game.
 * Flip two cards per move. Matching pairs stay face-up. Clear all eight
 * pairs to win. Score = moves used; best = fewest moves to clear (lower is
 * better), stored in localStorage. All artwork is generated at runtime.
 */
export class MemoryScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private cards: (Card | null)[][] = [];
  private allCards: Card[] = [];
  private firstPick: Card | null = null;
  private score = 0; // moves used this round
  private best = 0; // fewest moves to clear (0 = no record yet)
  private state: GameState = "ready";
  private busy = false;
  private timerEvent?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: "Memory" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();
    this.makeTextures();

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
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        panel.fillStyle(0x0b1020, 0.5);
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
      .text(GAME_W / 2, 70, "PAIR UP", {
        fontFamily: FONT_FAMILY,
        fontSize: "34px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(4);
    this.add
      .text(GAME_W / 2, 104, "Find matching pairs", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_W / 2, GAME_H - 36, "Flip two cards • fewer moves is better", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // Deal a face-down board so it reads as a game behind the ready overlay.
    this.dealCards();

    // Input.
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

  // ---- textures (runtime-generated, no image assets) ----------------
  private makeTextures(): void {
    const S = CELL;
    const cx = (S - 2) / 2;
    const cy = (S - 2) / 2;
    // Card back: dark rounded square with an accent diamond motif.
    if (!this.textures.exists("card-back")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x000000, 0.28);
      g.fillRoundedRect(2, 4, S - 4, S - 4, 12);
      g.fillStyle(hexToColor(THEME.panelStroke), 1);
      g.fillRoundedRect(0, 0, S - 2, S - 2, 12);
      g.lineStyle(2, hexToColor(THEME.accent), 0.7);
      g.strokePoints(polyPoints(cx, cy, S * 0.26, 4), true, true);
      g.fillStyle(hexToColor(THEME.accent), 0.9);
      g.fillCircle(cx, cy, 5);
      g.generateTexture("card-back", S, S);
      g.destroy();
    }
    // Card faces: 8 distinct pattern textures (one per pair type).
    for (let i = 0; i < NUM_PATTERNS; i++) {
      const key = `card-face-${i}`;
      if (this.textures.exists(key)) continue;
      const spec = PATTERNS[i];
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x000000, 0.22);
      g.fillRoundedRect(2, 4, S - 4, S - 4, 12);
      g.fillStyle(0xeef2ff, 1);
      g.fillRoundedRect(0, 0, S - 2, S - 2, 12);
      g.lineStyle(2, 0xc7d2fe, 1);
      g.strokeRoundedRect(1, 1, S - 4, S - 4, 11);
      drawShape(g, spec.shape, cx, cy, S * 0.28, hexToColor(spec.color));
      g.generateTexture(key, S, S);
      g.destroy();
    }
  }

  // ---- board setup ---------------------------------------------------
  private createCard(r: number, c: number, type: number): Card {
    const back = this.add.image(0, 0, "card-back");
    const face = this.add
      .image(0, 0, `card-face-${type}`)
      .setVisible(false);
    const container = this.add.container(this.cellX(c), this.cellY(r), [
      back,
      face,
    ]);
    return { type, r, c, container, back, face, flipped: false, matched: false };
  }

  /** Shuffle 8 pairs into 16 slots and lay them face-down. */
  private dealCards(): void {
    for (const card of this.allCards) card.container.destroy();
    this.allCards = [];
    this.cards = [];
    this.firstPick = null;

    const deck: number[] = [];
    for (let t = 0; t < NUM_PATTERNS; t++) {
      deck.push(t);
      deck.push(t);
    }
    Phaser.Utils.Array.Shuffle(deck);

    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      this.cards[r] = [];
      for (let c = 0; c < COLS; c++) {
        const type = deck[i++];
        const card = this.createCard(r, c, type);
        this.cards[r][c] = card;
        this.allCards.push(card);
        // Staggered pop-in so the deal feels alive.
        card.container.setScale(0);
        this.tweens.add({
          targets: card.container,
          scale: 1,
          duration: 220,
          ease: "back.out",
          delay: (r * COLS + c) * 28,
        });
      }
    }
  }

  // ---- input ---------------------------------------------------------
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.busy) return;
    const localX = pointer.x - CELL_ORIGIN_X;
    const localY = pointer.y - CELL_ORIGIN_Y;
    if (localX < 0 || localY < 0) return;
    const c = Math.floor(localX / (CELL + GAP));
    const r = Math.floor(localY / (CELL + GAP));
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    // Ignore taps that land in the gap between cards.
    const withinX = localX - c * (CELL + GAP);
    const withinY = localY - r * (CELL + GAP);
    if (withinX > CELL || withinY > CELL) return;
    const card = this.cards[r]?.[c];
    if (!card || card.matched || card.flipped) return;
    if (this.firstPick && this.firstPick === card) return;

    this.flipTo(card, true);

    if (!this.firstPick) {
      this.firstPick = card;
      return;
    }

    // Second pick — count a move and resolve the pair.
    const a = this.firstPick;
    this.firstPick = null;
    this.score++;
    this.emitScore();
    this.busy = true;
    this.flipTo(card, true, () => {
      if (a.type === card.type) {
        a.matched = true;
        card.matched = true;
        this.highlightMatch(a, card);
        this.busy = false;
        if (this.allMatched()) this.gameOver();
      } else {
        this.timerEvent?.remove();
        this.timerEvent = this.time.delayedCall(MISMATCH_DELAY, () => {
          this.timerEvent = undefined;
          let remaining = 2;
          const done = () => {
            remaining -= 1;
            if (remaining === 0) this.busy = false;
          };
          this.flipTo(a, false, done);
          this.flipTo(card, false, done);
        });
      }
    });
  }

  /** Flip a card with a 3D-ish half-turn (scaleX 1→0→1, swap face at 0). */
  private flipTo(
    card: Card,
    showFace: boolean,
    onDone?: () => void,
  ): void {
    card.flipped = showFace;
    this.tweens.add({
      targets: card.container,
      scaleX: 0,
      duration: FLIP_MS,
      ease: "quad.in",
      onComplete: () => {
        card.back.setVisible(!showFace);
        card.face.setVisible(showFace);
        this.tweens.add({
          targets: card.container,
          scaleX: 1,
          duration: FLIP_MS,
          ease: "quad.out",
          onComplete: () => onDone?.(),
        });
      },
    });
  }

  private highlightMatch(a: Card, b: Card): void {
    for (const card of [a, b]) {
      this.tweens.add({
        targets: card.container,
        scale: 1.12,
        duration: 120,
        ease: "quad.out",
        yoyo: true,
      });
    }
  }

  private allMatched(): boolean {
    return this.allCards.every((card) => card.matched);
  }

  // ---- round lifecycle ----------------------------------------------
  private startRound(): void {
    this.timerEvent?.remove();
    this.timerEvent = undefined;
    this.firstPick = null;
    this.busy = false;
    this.score = 0;
    this.dealCards();
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private gameOver(): void {
    this.state = "over";
    this.busy = true;
    this.timerEvent?.remove();
    this.timerEvent = undefined;
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Cleared",
    });
  }

  // ---- persistence / events -----------------------------------------
  private emitScore(): void {
    this.bridge.emit(GameEvents.Score, { score: this.score, best: this.best });
  }
  private loadBest(): number {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(BEST_KEY) || 0);
  }
  // Best = fewest moves to clear. Lower is better, so update when the new
  // score beats the record OR when no record exists yet (best === 0).
  private saveBest(): void {
    if (this.best === 0 || this.score < this.best) {
      this.best = this.score;
      if (typeof window !== "undefined") {
        localStorage.setItem(BEST_KEY, String(this.best));
      }
    }
  }
}

// ---- module-level texture helpers -----------------------------------
function hexToColor(hex: string): number {
  const h = hex.replace("#", "");
  return Phaser.Display.Color.GetColor(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  );
}

function polyPoints(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rot = -Math.PI / 2,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points = 5,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function drawShape(
  g: Phaser.GameObjects.Graphics,
  shape: ShapeKind,
  cx: number,
  cy: number,
  R: number,
  color: number,
): void {
  g.fillStyle(color, 1);
  g.lineStyle(Math.max(4, R * 0.4), color, 1);
  switch (shape) {
    case "circle":
      g.fillCircle(cx, cy, R);
      break;
    case "square":
      g.fillRoundedRect(cx - R, cy - R, R * 2, R * 2, 8);
      break;
    case "triangle":
      g.fillTriangle(
        cx,
        cy - R,
        cx - R * 0.95,
        cy + R * 0.85,
        cx + R * 0.95,
        cy + R * 0.85,
      );
      break;
    case "diamond":
      g.fillPoints(polyPoints(cx, cy, R, 4), true, true);
      break;
    case "star":
      g.fillPoints(starPoints(cx, cy, R, R * 0.45, 5), true, true);
      break;
    case "hexagon":
      g.fillPoints(polyPoints(cx, cy, R, 6), true, true);
      break;
    case "ring":
      g.strokeCircle(cx, cy, R * 0.85);
      break;
    case "starOutline":
      g.strokePoints(starPoints(cx, cy, R, R * 0.45, 5), true, true);
      break;
  }
}
