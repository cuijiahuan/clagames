import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Bubble Pop config ------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const R = 18; // bubble radius
const D = 36; // bubble diameter
const COLS_EVEN = 12; // bubbles in even rows
const COLS_ODD = 11; // bubbles in odd rows (offset by R)
const ROW_H = (D * Math.sqrt(3)) / 2; // hex row spacing ≈ 31.18
const BOARD_W = COLS_EVEN * D; // 432
const LEFT = (GAME_W - BOARD_W) / 2; // 9
const RIGHT = LEFT + BOARD_W; // 441
const TOP = 70; // grid top wall
const DEATH_LINE = 700; // bubbles crossing this (y > 700) end the game
const SHOOTER_X = GAME_W / 2; // 225
const SHOOTER_Y = 740;
const SPEED = 900; // px/s
const INIT_ROWS = 5;
const NUM_TYPES = 6;
const BEST_KEY = "clagames.bubble.best";

interface Bubble {
  type: number;
  sprite: Phaser.GameObjects.Image;
  r: number;
  c: number;
}

interface Flying {
  sprite: Phaser.GameObjects.Image;
  type: number;
  vx: number;
  vy: number;
}

// ---- color helpers (module-local) ------------------------------------
function hexToRgbInt(hex: string): number {
  const h = hex.replace("#", "");
  return Phaser.Display.Color.GetColor(
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  );
}
function mixTo(hex: string, target: string, t: number): number {
  const h = hex.replace("#", "");
  const h2 = target.replace("#", "");
  const r = Math.round(
    parseInt(h.slice(0, 2), 16) +
      (parseInt(h2.slice(0, 2), 16) - parseInt(h.slice(0, 2), 16)) * t,
  );
  const g = Math.round(
    parseInt(h.slice(2, 4), 16) +
      (parseInt(h2.slice(2, 4), 16) - parseInt(h.slice(2, 4), 16)) * t,
  );
  const b = Math.round(
    parseInt(h.slice(4, 6), 16) +
      (parseInt(h2.slice(4, 6), 16) - parseInt(h.slice(4, 6), 16)) * t,
  );
  return Phaser.Display.Color.GetColor(r, g, b);
}
function darken(hex: string, t: number): number {
  return mixTo(hex, "#000000", t);
}
function lighten(hex: string, t: number): number {
  return mixTo(hex, "#ffffff", t);
}

/**
 * Bubble Pop — a casual bubble shooter.
 * Aim with the pointer, tap to launch. Match 3+ same-color bubbles (hex grid)
 * to pop them; disconnected bubbles fall off too. Game ends when a bubble
 * settles below the death line. Best score in localStorage.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we pass the scene CLASS to Phaser (fresh instance per game) and avoid
// reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class BubbleScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private grid = new Map<string, Bubble>();
  private flying: Flying | null = null;
  private score = 0;
  private best = 0;
  private state: GameState = "ready";
  private busy = false;

  private aimAngle = -Math.PI / 2; // straight up
  private aimLine?: Phaser.GameObjects.Graphics;
  private currentType = 0;
  private nextType = 0;
  private currentSprite!: Phaser.GameObjects.Image;
  private nextSprite!: Phaser.GameObjects.Image;

  constructor() {
    super({ key: "Bubble" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.best = this.loadBest();

    // textures (runtime, no images)
    THEME.gems.forEach((c, i) => this.makeBubbleTexture(i, c));
    this.makeParticleTexture();

    // background gradient
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

    // playfield panel
    const panel = this.add.graphics();
    panel.fillStyle(0x111a33, 0.5);
    panel.fillRoundedRect(
      LEFT - 8,
      TOP - 8,
      BOARD_W + 16,
      DEATH_LINE - TOP + 16,
      12,
    );
    panel.lineStyle(2, 0x2a3a6b, 0.9);
    panel.strokeRoundedRect(
      LEFT - 8,
      TOP - 8,
      BOARD_W + 16,
      DEATH_LINE - TOP + 16,
      12,
    );

    // walls (left / right / top)
    const walls = this.add.graphics();
    walls.lineStyle(3, 0x2a3a6b, 0.85);
    walls.lineBetween(LEFT, TOP, LEFT, DEATH_LINE);
    walls.lineBetween(RIGHT, TOP, RIGHT, DEATH_LINE);
    walls.lineBetween(LEFT, TOP, RIGHT, TOP);

    // death line (red dashed)
    const dl = this.add.graphics();
    dl.lineStyle(2, 0xf87171, 0.6);
    for (let x = LEFT; x < RIGHT; x += 12) {
      dl.lineBetween(x, DEATH_LINE, Math.min(x + 6, RIGHT), DEATH_LINE);
    }

    // title
    const title = this.add
      .text(GAME_W / 2, 36, "BUBBLE POP", {
        fontFamily: FONT_FAMILY,
        fontSize: "22px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    title.setLetterSpacing?.(3);
    this.add
      .text(GAME_W / 2, 58, "Aim & match 3+", {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    // shooter base
    const base = this.add.graphics();
    base.fillStyle(0x0b1020, 0.9);
    base.fillCircle(SHOOTER_X, SHOOTER_Y, R + 5);
    base.lineStyle(2, 0x2a3a6b, 1);
    base.strokeCircle(SHOOTER_X, SHOOTER_Y, R + 5);

    // aim line
    this.aimLine = this.add.graphics().setDepth(2);

    // loaded + next bubbles
    this.currentSprite = this.add
      .image(SHOOTER_X, SHOOTER_Y, "bubble-0")
      .setDepth(4);
    this.nextSprite = this.add
      .image(SHOOTER_X - 62, SHOOTER_Y, "bubble-0")
      .setScale(0.65)
      .setDepth(4);
    this.add
      .text(SHOOTER_X - 62, SHOOTER_Y - 30, "NEXT", {
        fontFamily: FONT_FAMILY,
        fontSize: "9px",
        color: THEME.textDim,
      })
      .setOrigin(0.5)
      .setAlpha(0.6);

    this.add
      .text(GAME_W / 2, GAME_H - 12, "Move to aim • Tap to shoot", {
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        color: THEME.textDim,
      })
      .setOrigin(0.5)
      .setAlpha(0.7);

    // preview board + loaded shooter (shown behind the ready overlay)
    this.fillRows(INIT_ROWS);
    this.currentType = Phaser.Math.Between(0, NUM_TYPES - 1);
    this.nextType = Phaser.Math.Between(0, NUM_TYPES - 1);
    this.updateShooterDisplay();

    // input
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerdown", this.onPointerDown, this);

    // React -> Phaser controls. Remove on shutdown so a recreated game
    // (e.g. React StrictMode dev double-mount) doesn't leak handlers.
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

  // ---- textures -------------------------------------------------------

  private makeBubbleTexture(idx: number, color: string): void {
    const size = D;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const cx = size / 2;
    const cy = size / 2;
    // soft drop shadow
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(cx, cy + 2, R);
    // base
    g.fillStyle(hexToRgbInt(color), 1);
    g.fillCircle(cx, cy, R);
    // glossy highlight (lighter, offset up-left)
    g.fillStyle(lighten(color, 0.4), 0.55);
    g.fillCircle(cx - 4, cy - 4, R * 0.7);
    // sparkle dot
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(cx - 6, cy - 6, 3);
    g.generateTexture(`bubble-${idx}`, size, size);
    g.destroy();
  }

  private makeParticleTexture(): void {
    const size = 16;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(size / 2, size / 2, size / 2);
    g.generateTexture("bubble-particle", size, size);
    g.destroy();
  }

  // ---- grid geometry --------------------------------------------------

  private colsInRow(r: number): number {
    return r % 2 === 0 ? COLS_EVEN : COLS_ODD;
  }

  private cellX(r: number, c: number): number {
    const offset = r % 2 === 1 ? R : 0;
    return LEFT + R + c * D + offset;
  }

  private cellY(r: number): number {
    return TOP + R + r * ROW_H;
  }

  /** Six axial neighbours for an offset-row hex grid (odd rows shifted right). */
  private neighbors(r: number, c: number): Array<[number, number]> {
    return r % 2 === 0
      ? [
          [r, c - 1],
          [r, c + 1],
          [r - 1, c - 1],
          [r - 1, c],
          [r + 1, c - 1],
          [r + 1, c],
        ]
      : [
          [r, c - 1],
          [r, c + 1],
          [r - 1, c],
          [r - 1, c + 1],
          [r + 1, c],
          [r + 1, c + 1],
        ];
  }

  private key(r: number, c: number): string {
    return `${r},${c}`;
  }

  // ---- board setup ----------------------------------------------------

  private placeBubble(r: number, c: number, type: number): Bubble {
    const sprite = this.add.image(this.cellX(r, c), this.cellY(r), `bubble-${type}`);
    const bubble: Bubble = { type, sprite, r, c };
    this.grid.set(this.key(r, c), bubble);
    return bubble;
  }

  private fillRows(rows: number): void {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < this.colsInRow(r); c++) {
        const type = Phaser.Math.Between(0, NUM_TYPES - 1);
        this.placeBubble(r, c, type);
      }
    }
  }

  private clearGrid(): void {
    for (const [, b] of this.grid) b.sprite.destroy();
    this.grid.clear();
  }

  // ---- input ----------------------------------------------------------

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing") return;
    const dx = pointer.x - SHOOTER_X;
    const dy = pointer.y - SHOOTER_Y;
    // Clamp to upward-only (10° above horizontal on each side).
    const minA = -Math.PI + 0.17; // ≈ -170°
    const maxA = -0.17; // ≈ -10°
    let ang: number;
    if (dy >= 0) {
      // pointer at/below the shooter: aim up toward that side
      ang = dx >= 0 ? maxA : minA;
    } else {
      ang = Phaser.Math.Clamp(Math.atan2(dy, dx), minA, maxA);
    }
    this.aimAngle = ang;
    this.drawAim();
  }

  private onPointerDown(_pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing" || this.flying || this.busy) return;
    const vx = Math.cos(this.aimAngle) * SPEED;
    const vy = Math.sin(this.aimAngle) * SPEED;
    const sprite = this.add
      .image(SHOOTER_X, SHOOTER_Y, `bubble-${this.currentType}`)
      .setDepth(10);
    this.flying = { sprite, type: this.currentType, vx, vy };
    this.currentSprite.setVisible(false);
    this.drawAim();
  }

  // ---- aim line -------------------------------------------------------

  private drawAim(): void {
    this.aimLine?.clear();
    if (!this.aimLine) return;
    if (this.state !== "playing" || this.flying || this.busy) return;
    const x0 = SHOOTER_X;
    const y0 = SHOOTER_Y - R - 2;
    const len = 240;
    const dash = 8;
    const gap = 6;
    this.aimLine.lineStyle(2, 0xffffff, 0.3);
    let d = 0;
    while (d < len) {
      const d2 = Math.min(d + dash, len);
      this.aimLine.lineBetween(
        x0 + Math.cos(this.aimAngle) * d,
        y0 + Math.sin(this.aimAngle) * d,
        x0 + Math.cos(this.aimAngle) * d2,
        y0 + Math.sin(this.aimAngle) * d2,
      );
      d += dash + gap;
    }
  }

  // ---- update: fly + collide + snap -----------------------------------

  update(_time: number, delta: number): void {
    const f = this.flying;
    if (!f) return;
    let dt = delta / 1000;
    if (dt > 0.05) dt = 0.05; // clamp big frames to avoid tunneling
    const dist = SPEED * dt;
    const steps = Math.max(1, Math.ceil(dist / 9)); // ≤9px per sub-step
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.flying !== f) return; // snapped mid-loop
      let nx = f.sprite.x + f.vx * stepDt;
      const ny = f.sprite.y + f.vy * stepDt;
      // side walls (bounce)
      if (nx < LEFT + R) {
        nx = LEFT + R;
        f.vx = Math.abs(f.vx);
      } else if (nx > RIGHT - R) {
        nx = RIGHT - R;
        f.vx = -Math.abs(f.vx);
      }
      // top wall
      if (ny <= TOP + R) {
        f.sprite.setPosition(nx, TOP + R);
        this.snapBubble();
        return;
      }
      // bubble-bubble collision
      let hit = false;
      for (const [, b] of this.grid) {
        if (Math.hypot(b.sprite.x - nx, b.sprite.y - ny) < D) {
          hit = true;
          break;
        }
      }
      if (hit) {
        f.sprite.setPosition(nx, ny);
        this.snapBubble();
        return;
      }
      f.sprite.setPosition(nx, ny);
    }
  }

  // ---- snap / match / drop -------------------------------------------

  private findSnapCell(
    x: number,
    y: number,
  ): { r: number; c: number } | null {
    let r = Math.round((y - TOP - R) / ROW_H);
    if (r < 0) r = 0;
    let best: { r: number; c: number } | null = null;
    let bestDist = Infinity;
    for (let rr = Math.max(0, r - 1); rr <= r + 1; rr++) {
      for (let c = 0; c < this.colsInRow(rr); c++) {
        const k = this.key(rr, c);
        if (this.grid.has(k)) continue;
        const supported =
          rr === 0 ||
          this.neighbors(rr, c).some(([nr, nc]) =>
            this.grid.has(this.key(nr, nc)),
          );
        if (!supported) continue;
        const cx = this.cellX(rr, c);
        const cy = this.cellY(rr);
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestDist) {
          bestDist = d;
          best = { r: rr, c };
        }
      }
    }
    return best;
  }

  private snapBubble(): void {
    const f = this.flying;
    if (!f) return;
    const cell = this.findSnapCell(f.sprite.x, f.sprite.y);
    if (!cell) {
      // nowhere to place (shouldn't happen) — discard and reload
      f.sprite.destroy();
      this.flying = null;
      this.reloadShooter();
      return;
    }
    const x = this.cellX(cell.r, cell.c);
    const y = this.cellY(cell.r);
    f.sprite.setPosition(x, y);
    const bubble: Bubble = { type: f.type, sprite: f.sprite, r: cell.r, c: cell.c };
    this.grid.set(this.key(cell.r, cell.c), bubble);
    this.flying = null;
    this.drawAim();

    // death line check
    if (y > DEATH_LINE) {
      this.gameOver();
      return;
    }

    const group = this.findGroup(cell.r, cell.c);
    if (group.length >= 3) {
      this.busy = true;
      this.popBubbles(group);
      this.time.delayedCall(220, () => {
        const floating = this.findFloating();
        if (floating.length > 0) {
          this.popBubbles(floating);
          this.time.delayedCall(220, () => this.reloadShooter());
        } else {
          this.reloadShooter();
        }
      });
    } else {
      this.reloadShooter();
    }
  }

  /** Same-color connected group (BFS) starting at (r, c). */
  private findGroup(r: number, c: number): Bubble[] {
    const start = this.grid.get(this.key(r, c));
    if (!start) return [];
    const target = start.type;
    const visited = new Set<string>();
    const queue: string[] = [this.key(r, c)];
    const out: Bubble[] = [];
    visited.add(this.key(r, c));
    while (queue.length > 0) {
      const k = queue.shift()!;
      const b = this.grid.get(k);
      if (!b) continue;
      out.push(b);
      for (const [nr, nc] of this.neighbors(b.r, b.c)) {
        const nk = this.key(nr, nc);
        if (visited.has(nk)) continue;
        const n = this.grid.get(nk);
        if (n && n.type === target) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }
    return out;
  }

  /** Bubbles not connected to the top row (will fall once a group pops). */
  private findFloating(): Bubble[] {
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const [k, b] of this.grid) {
      if (b.r === 0) {
        queue.push(k);
        visited.add(k);
      }
    }
    while (queue.length > 0) {
      const k = queue.shift()!;
      const b = this.grid.get(k);
      if (!b) continue;
      for (const [nr, nc] of this.neighbors(b.r, b.c)) {
        const nk = this.key(nr, nc);
        if (visited.has(nk)) continue;
        if (this.grid.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }
    const out: Bubble[] = [];
    for (const [k, b] of this.grid) {
      if (!visited.has(k)) out.push(b);
    }
    return out;
  }

  private popBubbles(bubbles: Bubble[]): void {
    const points = bubbles.length * 10;
    this.score += points;
    this.emitScore();
    for (const b of bubbles) {
      this.grid.delete(this.key(b.r, b.c));
      this.popFx(b.sprite.x, b.sprite.y, THEME.gems[b.type]);
      this.tweens.add({
        targets: b.sprite,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: 200,
        ease: "power2",
        onComplete: () => b.sprite.destroy(),
      });
    }
  }

  private popFx(x: number, y: number, color: string): void {
    const tint = hexToRgbInt(color);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = this.add
        .image(x, y, "bubble-particle")
        .setTint(tint)
        .setScale(0.7)
        .setDepth(30);
      const ang = (Math.PI * 2 * i) / n;
      const dist = 16 + Math.random() * 12;
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

  // ---- shooter reload -------------------------------------------------

  private reloadShooter(): void {
    this.currentType = this.nextType;
    this.nextType = Phaser.Math.Between(0, NUM_TYPES - 1);
    this.busy = false;
    this.updateShooterDisplay();
    this.drawAim();
  }

  private updateShooterDisplay(): void {
    this.currentSprite.setTexture(`bubble-${this.currentType}`).setVisible(true);
    this.nextSprite.setTexture(`bubble-${this.nextType}`);
  }

  // ---- round lifecycle ------------------------------------------------

  private startRound(): void {
    this.clearGrid();
    if (this.flying) {
      this.flying.sprite.destroy();
      this.flying = null;
    }
    this.score = 0;
    this.busy = false;
    this.fillRows(INIT_ROWS);
    this.currentType = Phaser.Math.Between(0, NUM_TYPES - 1);
    this.nextType = Phaser.Math.Between(0, NUM_TYPES - 1);
    this.updateShooterDisplay();
    this.state = "playing";
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
    this.drawAim();
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
      reason: "Bubble reached the line",
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
