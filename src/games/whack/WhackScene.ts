import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Whack-a-Mole config --------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const COLS = 3;
const ROWS = 3;
const CELL = 130;
const BOARD_X = 30;
const BOARD_Y = 220;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const ROUND_SECONDS = 30;
const BEST_KEY = "clagames.whack.best";
const BOMB_CHANCE = 0.2;
const SPAWN_DELAY = 800; // ms (within the 700–900ms spec)
const MOLE_STAY_MS = 1200;
const MOLE_RISE_MS = 220;
const MOLE_SINK_MS = 220;

interface Hole {
  x: number;
  y: number;
  row: number;
  mole: Mole | null;
}

interface Mole {
  sprite: Phaser.GameObjects.Image;
  holeIndex: number;
  isBomb: boolean;
  hit: boolean;
}

/**
 * Mole Mash — a 30s whack-a-mole.
 * Touch-first: moles pop out of 3×3 holes; tap to mash them for points. Chain
 * hits build a combo multiplier. Bombs deduct score and break the chain. Best
 * score in localStorage.
 *
 * The React wrapper injects its GameBridge here before the scene boots, so we
 * can pass the scene CLASS to Phaser (which builds a fresh instance per game).
 * This avoids reusing a destroyed instance under React StrictMode.
 */
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class WhackScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private holes: Hole[] = [];
  private rowMasks: Phaser.Display.Masks.GeometryMask[] = [];
  private maskGraphics: Phaser.GameObjects.Graphics[] = [];
  private score = 0;
  private best = 0;
  private combo = 0;
  private state: GameState = "ready";
  private timerEvent?: Phaser.Time.TimerEvent;
  private spawnEvent?: Phaser.Time.TimerEvent;
  private remaining = ROUND_SECONDS;
  private comboText?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "Whack" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.makeTextures();
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

    // Per-row geometry masks: each mask reveals only the area above that
    // row's ground line (the hole's vertical center). A mole whose sprite
    // sits below its ground line is invisible, so it appears to emerge from
    // the hole as it rises.
    for (let r = 0; r < ROWS; r++) {
      const groundY = BOARD_Y + r * CELL + CELL / 2;
      const g = this.make.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, GAME_W, groundY);
      this.rowMasks[r] = g.createGeometryMask();
      this.maskGraphics.push(g);
    }

    // Holes.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = BOARD_X + c * CELL + CELL / 2;
        const y = BOARD_Y + r * CELL + CELL / 2;
        this.add.image(x, y, "whack-hole").setDepth(5);
        this.holes.push({ x, y, row: r, mole: null });
      }
    }

    // Combo text + hint.
    this.comboText = this.add
      .text(GAME_W / 2, BOARD_Y - 36, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "22px",
        color: THEME.accent,
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(40);

    this.hint = this.add
      .text(GAME_W / 2, GAME_H - 36, "Tap moles • dodge bombs", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    this.input.on("pointerdown", this.onPointerDown, this);

    // React -> Phaser controls. Remove them on shutdown so a recreated game
    // (e.g. React StrictMode dev double-mount) doesn't leak handlers.
    // Guard with isActive() in case a start event races with shutdown.
    const startIfActive = () => {
      if (this.sys.isActive()) this.startRound();
    };
    const offStart = this.bridge.on(GameEvents.Start, startIfActive);
    const offRestart = this.bridge.on(GameEvents.Restart, startIfActive);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offStart();
      offRestart();
      this.timerEvent?.remove();
      this.spawnEvent?.remove();
      this.clearMoles();
    });

    // Tell React we're ready (shows the "Tap to start" overlay).
    this.bridge.emit(GameEvents.State, "ready" as GameState);
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
    this.bridge.emit(GameEvents.Combo, { chain: 0, multiplier: 1 });
  }

  // ---- textures ------------------------------------------------------

  private makeTextures(): void {
    if (this.textures.exists("whack-hole")) return;

    // Hole: outer rim + dark pit.
    const hole = this.make.graphics();
    hole.fillStyle(0x1e293b, 1);
    hole.fillEllipse(60, 35, 110, 50);
    hole.fillStyle(0x0b1020, 1);
    hole.fillEllipse(60, 38, 92, 36);
    hole.lineStyle(2, 0x334155, 1);
    hole.strokeEllipse(60, 35, 110, 50);
    hole.generateTexture("whack-hole", 120, 70);
    hole.destroy();

    // Mole (normal): teal capsule + belly + eyes + nose.
    const mole = this.make.graphics();
    mole.fillStyle(0x5eead4, 1);
    mole.fillRoundedRect(10, 18, 60, 58, 22);
    mole.fillStyle(0x99f6e8, 1);
    mole.fillRoundedRect(20, 34, 40, 36, 14);
    mole.fillStyle(0xffffff, 1);
    mole.fillCircle(28, 36, 7);
    mole.fillCircle(52, 36, 7);
    mole.fillStyle(0x111827, 1);
    mole.fillCircle(29, 37, 3);
    mole.fillCircle(53, 37, 3);
    mole.fillCircle(40, 47, 3);
    mole.generateTexture("whack-mole", 80, 80);
    mole.destroy();

    // Bomb mole: red body + fuse/spark + X eyes.
    const bomb = this.make.graphics();
    bomb.fillStyle(0xf87171, 1);
    bomb.fillRoundedRect(10, 18, 60, 58, 22);
    bomb.fillStyle(0xfecaca, 1);
    bomb.fillRoundedRect(20, 34, 40, 36, 14);
    bomb.lineStyle(3, 0x44403c, 1);
    bomb.beginPath();
    bomb.moveTo(40, 18);
    bomb.lineTo(46, 10);
    bomb.lineTo(50, 4);
    bomb.strokePath();
    bomb.fillStyle(0xfbbf24, 1);
    bomb.fillCircle(50, 4, 5);
    bomb.fillStyle(0xfde68a, 1);
    bomb.fillCircle(50, 4, 2.5);
    bomb.lineStyle(2.5, 0x111827, 1);
    bomb.beginPath();
    bomb.moveTo(24, 33);
    bomb.lineTo(32, 39);
    bomb.moveTo(32, 33);
    bomb.lineTo(24, 39);
    bomb.moveTo(48, 33);
    bomb.lineTo(56, 39);
    bomb.moveTo(56, 33);
    bomb.lineTo(48, 39);
    bomb.strokePath();
    bomb.generateTexture("whack-bomb", 80, 80);
    bomb.destroy();

    // Particle.
    const part = this.make.graphics();
    part.fillStyle(0xffffff, 1);
    part.fillCircle(4, 4, 4);
    part.generateTexture("whack-particle", 8, 8);
    part.destroy();
  }

  // ---- spawn ---------------------------------------------------------

  private spawnMoles(): void {
    if (this.state !== "playing") return;
    const empty: number[] = [];
    for (let i = 0; i < this.holes.length; i++) {
      if (!this.holes[i].mole) empty.push(i);
    }
    if (empty.length === 0) return;
    const max = Math.min(2, empty.length);
    const count = Phaser.Math.Between(1, max);
    Phaser.Utils.Array.Shuffle(empty);
    for (let k = 0; k < count; k++) {
      this.spawnMole(empty[k]);
    }
  }

  private spawnMole(holeIndex: number): void {
    const hole = this.holes[holeIndex];
    const isBomb = Math.random() < BOMB_CHANCE;
    const tex = isBomb ? "whack-bomb" : "whack-mole";
    const downY = hole.y + 55; // fully below ground line -> masked out
    const upY = hole.y - 18;
    const sprite = this.add.image(hole.x, downY, tex).setDepth(10);
    sprite.setMask(this.rowMasks[hole.row]);
    const mole: Mole = { sprite, holeIndex, isBomb, hit: false };
    hole.mole = mole;

    this.tweens.add({
      targets: sprite,
      y: upY,
      duration: MOLE_RISE_MS,
      ease: "back.out",
      onComplete: () => {
        if (mole.hit) return;
        this.tweens.add({
          targets: sprite,
          y: downY,
          duration: MOLE_SINK_MS,
          delay: MOLE_STAY_MS,
          ease: "quad.in",
          onComplete: () => {
            // Auto-sunk without being hit. A missed normal mole breaks the
            // combo; bombs are supposed to be ignored, so they don't penalize.
            if (!mole.hit && !mole.isBomb) {
              this.combo = 0;
              this.bridge.emit(GameEvents.Combo, { chain: 0, multiplier: 1 });
              this.hideCombo();
            }
            this.removeMole(holeIndex);
          },
        });
      },
    });
  }

  private removeMole(holeIndex: number): void {
    const hole = this.holes[holeIndex];
    const mole = hole.mole;
    if (!mole) return;
    this.tweens.killTweensOf(mole.sprite);
    mole.sprite.destroy();
    hole.mole = null;
  }

  private clearMoles(): void {
    for (const hole of this.holes) {
      const mole = hole.mole;
      if (!mole) continue;
      this.tweens.killTweensOf(mole.sprite);
      mole.sprite.destroy();
      hole.mole = null;
    }
  }

  // ---- input ---------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing") return;
    // Pick the closest visible mole under the pointer (only counts clicks
    // above the hole's ground line — i.e. on the poking-out head).
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.holes.length; i++) {
      const hole = this.holes[i];
      const mole = hole.mole;
      if (!mole || mole.hit) continue;
      const sprite = mole.sprite;
      const b = sprite.getBounds();
      if (!b.contains(pointer.x, pointer.y)) continue;
      if (pointer.y >= hole.y) continue;
      const dx = pointer.x - sprite.x;
      const dy = pointer.y - (sprite.y - 15);
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) this.hitMole(best);
  }

  private hitMole(holeIndex: number): void {
    const hole = this.holes[holeIndex];
    const mole = hole.mole;
    if (!mole || mole.hit) return;
    mole.hit = true;
    this.tweens.killTweensOf(mole.sprite);

    if (mole.isBomb) {
      this.score = Math.max(0, this.score - 2);
      this.combo = 0;
      this.bridge.emit(GameEvents.Combo, { chain: 0, multiplier: 1 });
      this.hideCombo();
    } else {
      const mult = Math.floor(1 + this.combo * 0.5);
      this.score += 1 * mult;
      this.combo++;
      this.showCombo(this.combo, mult);
      this.bridge.emit(GameEvents.Combo, {
        chain: this.combo,
        multiplier: mult,
      });
    }

    this.popMole(mole.sprite.x, mole.sprite.y - 15, mole.isBomb);
    this.tweens.add({
      targets: mole.sprite,
      scaleX: 0.2,
      scaleY: 0.2,
      alpha: 0,
      duration: 200,
      ease: "power2",
      onComplete: () => this.removeMole(holeIndex),
    });
    this.emitScore();
  }

  // ---- FX ------------------------------------------------------------

  private popMole(x: number, y: number, isBomb: boolean): void {
    const color = isBomb ? THEME.danger : THEME.accent;
    const hex = color.replace("#", "");
    const tint = Phaser.Display.Color.GetColor(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    );
    const n = 7;
    for (let i = 0; i < n; i++) {
      const p = this.add
        .image(x, y, "whack-particle")
        .setTint(tint)
        .setScale(0.8)
        .setDepth(30);
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = 18 + Math.random() * 16;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0,
        duration: 320,
        ease: "power2",
        onComplete: () => p.destroy(),
      });
    }
  }

  private showCombo(chain: number, mult: number): void {
    if (!this.comboText) return;
    if (chain < 2) {
      this.hideCombo();
      return;
    }
    this.comboText.setText(`COMBO x${chain} • +${mult}`);
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
  }

  private hideCombo(): void {
    if (!this.comboText) return;
    this.tweens.killTweensOf(this.comboText);
    this.comboText.setAlpha(0);
  }

  // ---- round lifecycle ----------------------------------------------

  private startRound(): void {
    this.clearMoles();
    this.score = 0;
    this.combo = 0;
    this.remaining = ROUND_SECONDS;
    this.state = "playing";
    this.hideCombo();
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
    this.bridge.emit(GameEvents.Timer, { remaining: this.remaining });
    this.bridge.emit(GameEvents.Combo, { chain: 0, multiplier: 1 });

    this.timerEvent?.remove();
    this.spawnEvent?.remove();

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
    this.spawnEvent = this.time.addEvent({
      delay: SPAWN_DELAY,
      repeat: Infinity,
      callback: () => this.spawnMoles(),
    });
  }

  private gameOver(): void {
    this.state = "over";
    this.timerEvent?.remove();
    this.spawnEvent?.remove();
    this.clearMoles();
    this.saveBest();
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Time's up!",
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

  private saveBest(): void {
    if (typeof window === "undefined") return;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
  }
}
