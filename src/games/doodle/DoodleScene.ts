import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";

// ---- Hop Up config ---------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const PLAYER_W = 44;
const PLAYER_H = 44;
const PLATFORM_W = 70;
const PLATFORM_H = 14;
const GRAVITY = 2200; // px/s^2
const JUMP = 820; // bounce velocity (px/s)
const SCROLL_LINE = 400; // player pinned here while climbing
const BEST_KEY = "clagames.doodle.best";

type PlatformKind = "normal" | "moving" | "fragile";

interface Platform {
  sprite: Phaser.GameObjects.Image;
  kind: PlatformKind;
  vx: number;
  stepped: boolean;
  dead: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function colorInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Phaser.Display.Color.GetColor(r, g, b);
}

/**
 * Hop Up — a doodle-jump style vertical climber.
 * Touch/drag left-right to steer (or use arrow keys). You auto-bounce on
 * landing. Three platform types: static, sliding, and one-use fragile.
 * The world scrolls down as you climb; score = height climbed. Falling off
 * the bottom ends the round. Best height in localStorage.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class DoodleScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private state: GameState = "ready";
  private player!: Phaser.GameObjects.Image;
  private vy = 0;
  private active: Platform[] = [];
  private pool: Platform[] = [];
  private stars: Phaser.GameObjects.Image[] = [];
  private rise = 0;
  private score = 0;
  private best = 0;
  private nextSpawnY = 0;
  private lastSpawnX = GAME_W / 2;
  private lastKind: PlatformKind = "normal";
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private title?: Phaser.GameObjects.Text;
  private hint?: Phaser.GameObjects.Text;
  private bobT = 0;

  constructor() {
    super({ key: "Doodle" });
  }

  create(): void {
    this.bridge = activeBridge!;
    this.makeTextures();
    this.best = this.loadBest();

    // Background gradient (fixed backdrop).
    this.cameras.main.setBackgroundColor(THEME.bg);
    const bg = this.add.graphics();
    bg.fillGradientStyle(
      colorInt(THEME.bgGradientTop),
      colorInt(THEME.bgGradientTop),
      colorInt(THEME.bgGradientBottom),
      colorInt(THEME.bgGradientBottom),
      1,
    );
    bg.fillRect(0, 0, GAME_W, GAME_H);

    // Soft bokeh for a parallax sense of climbing.
    for (let i = 0; i < 16; i++) {
      const s = this.add
        .image(
          Phaser.Math.Between(0, GAME_W),
          Phaser.Math.Between(0, GAME_H),
          "doodle-bokeh",
        )
        .setAlpha(0.45)
        .setScale(Phaser.Math.FloatBetween(0.4, 1))
        .setDepth(1);
      this.stars.push(s);
    }

    // Player.
    this.player = this.add
      .image(GAME_W / 2, 592, "doodle-player")
      .setDepth(10);

    // Title + hint.
    this.title = this.add
      .text(GAME_W / 2, 150, "HOP UP", {
        fontFamily: FONT_FAMILY,
        fontSize: "40px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.9)
      .setDepth(20);
    this.title.setLetterSpacing?.(4);
    this.hint = this.add
      .text(GAME_W / 2, GAME_H - 80, "Tap to start", {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        color: THEME.textDim,
      })
      .setOrigin(0.5)
      .setDepth(20);

    // Input — drag to steer, arrow keys as fallback.
    this.input.on("pointermove", this.onPointerMove, this);
    this.cursors = this.input.keyboard?.createCursorKeys() ?? null;

    // Lay out the opening board so the ready screen looks alive.
    this.layoutStart();

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

  // ---- Textures (generated at runtime, no image assets) --------------

  private makeTextures(): void {
    // Player capsule with eyes + smile.
    const pg = this.make.graphics({ x: 0, y: 0 }, false);
    const pr = 14;
    pg.fillStyle(0x000000, 0.22);
    pg.fillRoundedRect(-3, -2, PLAYER_W + 6, PLAYER_H + 6, pr + 3);
    pg.fillStyle(colorInt(THEME.accent), 1);
    pg.fillRoundedRect(0, 0, PLAYER_W, PLAYER_H, pr);
    pg.fillStyle(0xffffff, 0.16);
    pg.fillRoundedRect(
      PLAYER_W * 0.18,
      PLAYER_H * 0.55,
      PLAYER_W * 0.64,
      PLAYER_H * 0.3,
      pr * 0.6,
    );
    // eyes
    pg.fillStyle(0xffffff, 1);
    pg.fillCircle(15, 15, 6);
    pg.fillCircle(29, 15, 6);
    pg.fillStyle(0x0b1020, 1);
    pg.fillCircle(15, 16, 3);
    pg.fillCircle(29, 16, 3);
    pg.fillStyle(0xffffff, 1);
    pg.fillCircle(14, 14, 1.2);
    pg.fillCircle(28, 14, 1.2);
    // smile
    pg.lineStyle(1.6, 0x0b1020, 0.85);
    pg.beginPath();
    pg.arc(22, 25, 6, 0.15 * Math.PI, 0.85 * Math.PI);
    pg.strokePath();
    pg.generateTexture("doodle-player", PLAYER_W, PLAYER_H);
    pg.destroy();

    this.makePlatformTexture("doodle-platform-normal", THEME.accent, false);
    this.makePlatformTexture("doodle-platform-moving", THEME.accent2, false);
    this.makePlatformTexture("doodle-platform-fragile", THEME.warning, true);

    // Particle for landing dust.
    const ptg = this.make.graphics({ x: 0, y: 0 }, false);
    ptg.fillStyle(0xffffff, 1);
    ptg.fillCircle(8, 8, 8);
    ptg.generateTexture("doodle-particle", 16, 16);
    ptg.destroy();

    // Bokeh disc for the parallax background.
    const bg = this.make.graphics({ x: 0, y: 0 }, false);
    for (let i = 4; i >= 0; i--) {
      bg.fillStyle(0x5eead4, 0.04 * (5 - i));
      bg.fillCircle(48, 48, 48 * (1 - i * 0.18));
    }
    bg.generateTexture("doodle-bokeh", 96, 96);
    bg.destroy();
  }

  private makePlatformTexture(
    key: string,
    color: string,
    fragile: boolean,
  ): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const r = 7;
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(2, 3, PLATFORM_W, PLATFORM_H, r);
    g.fillStyle(colorInt(color), 1);
    g.fillRoundedRect(0, 0, PLATFORM_W, PLATFORM_H, r);
    g.fillStyle(0xffffff, 0.25);
    g.fillRoundedRect(2, 1, PLATFORM_W - 4, 3, 2);
    if (fragile) {
      g.lineStyle(1.4, 0x0b1020, 0.45);
      g.beginPath();
      g.moveTo(12, 2);
      g.lineTo(18, 11);
      g.moveTo(30, 2);
      g.lineTo(36, 11);
      g.moveTo(48, 2);
      g.lineTo(54, 11);
      g.strokePath();
    }
    g.generateTexture(key, PLATFORM_W, PLATFORM_H);
    g.destroy();
  }

  private platformKey(kind: PlatformKind): string {
    return kind === "normal"
      ? "doodle-platform-normal"
      : kind === "moving"
        ? "doodle-platform-moving"
        : "doodle-platform-fragile";
  }

  // ---- Input ----------------------------------------------------------

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.state !== "playing") return;
    this.player.x = Phaser.Math.Clamp(
      pointer.x,
      PLAYER_W / 2,
      GAME_W - PLAYER_W / 2,
    );
  }

  // ---- Board ----------------------------------------------------------

  private pickKind(): PlatformKind {
    const r = Math.random();
    const difficulty = Math.min(1, this.rise / 4000);
    const moveP = 0.12 + 0.18 * difficulty;
    const fragP = 0.08 + 0.17 * difficulty;
    let kind: PlatformKind;
    if (r < moveP) {
      kind = "moving";
    } else if (r < moveP + fragP && this.lastKind !== "fragile") {
      kind = "fragile";
    } else {
      kind = "normal";
    }
    this.lastKind = kind;
    return kind;
  }

  private spawnPlatform(y: number, kind?: PlatformKind, x?: number): void {
    let px: number;
    if (x !== undefined) {
      px = x;
    } else {
      px = Phaser.Math.Clamp(
        this.lastSpawnX + Phaser.Math.Between(-150, 150),
        PLATFORM_W / 2 + 4,
        GAME_W - PLATFORM_W / 2 - 4,
      );
    }
    this.lastSpawnX = px;
    const pk = kind ?? this.pickKind();
    let p = this.pool.pop();
    if (!p) {
      const sprite = this.add.image(px, y, this.platformKey(pk)).setDepth(5);
      p = { sprite, kind: pk, vx: 0, stepped: false, dead: false };
    } else {
      p.kind = pk;
      p.stepped = false;
      p.dead = false;
      p.sprite
        .setTexture(this.platformKey(pk))
        .setPosition(px, y)
        .setVisible(true)
        .setAlpha(1)
        .setScale(1);
    }
    p.vx =
      pk === "moving"
        ? (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.FloatBetween(60, 110)
        : 0;
    this.active.push(p);
  }

  private layoutStart(): void {
    for (const p of this.active) {
      this.tweens.killTweensOf(p.sprite);
      p.sprite.setVisible(false);
      this.pool.push(p);
    }
    this.active = [];
    this.rise = 0;
    this.score = 0;
    this.lastSpawnX = GAME_W / 2;
    this.lastKind = "normal";
    this.tweens.killTweensOf(this.player);
    this.player.setPosition(GAME_W / 2, 592).setAlpha(1).setScale(1).setAngle(0);
    this.vy = 0;
    // Guaranteed safe platform directly under the player.
    this.spawnPlatform(614, "normal", GAME_W / 2);
    let y = 614;
    for (let i = 0; i < 10; i++) {
      y -= Phaser.Math.Between(55, 105);
      this.spawnPlatform(y);
    }
    this.nextSpawnY = y;
  }

  // ---- Loop -----------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000; // clamp big frame gaps
    if (this.state !== "playing") {
      if (this.state === "ready") {
        this.bobT += dt;
        this.player.y = 592 + Math.sin(this.bobT * 4) * 3;
      }
      return;
    }

    // Keyboard steering.
    const left = this.cursors?.left?.isDown ?? false;
    const right = this.cursors?.right?.isDown ?? false;
    const moveSpeed = 340;
    if (left) this.player.x -= moveSpeed * dt;
    if (right) this.player.x += moveSpeed * dt;
    this.player.x = Phaser.Math.Clamp(
      this.player.x,
      PLAYER_W / 2,
      GAME_W - PLAYER_W / 2,
    );

    // Physics: gravity + integrate.
    const prevY = this.player.y;
    this.vy += GRAVITY * dt;
    this.player.y += this.vy * dt;

    // Landing (one-way, swept so fast falls can't tunnel through a platform).
    if (this.vy > 0) {
      const prevBottom = prevY + PLAYER_H / 2;
      const currBottom = this.player.y + PLAYER_H / 2;
      for (const p of this.active) {
        if (p.stepped || p.dead) continue;
        const s = p.sprite;
        const platTop = s.y - PLATFORM_H / 2;
        if (
          Math.abs(this.player.x - s.x) <
            PLAYER_W / 2 + PLATFORM_W / 2 - 6 &&
          prevBottom <= platTop + 8 &&
          currBottom >= platTop
        ) {
          this.vy = -JUMP;
          this.player.y = platTop - PLAYER_H / 2;
          this.bounceFx(this.player.x, platTop);
          this.tweens.killTweensOf(this.player);
          this.tweens.add({
            targets: this.player,
            scaleY: 0.72,
            scaleX: 1.22,
            duration: 80,
            yoyo: true,
            ease: "quad.out",
          });
          if (p.kind === "fragile") {
            p.stepped = true;
            this.tweens.add({
              targets: s,
              alpha: 0,
              scaleY: 0.4,
              duration: 180,
              ease: "power2",
              onComplete: () => {
                p.dead = true;
              },
            });
          }
          break;
        }
      }
    }

    // Moving platforms slide and bounce off the side walls.
    for (const p of this.active) {
      if (p.kind === "moving" && !p.dead) {
        const s = p.sprite;
        s.x += p.vx * dt;
        const half = PLATFORM_W / 2;
        if (s.x < half) {
          s.x = half;
          p.vx = Math.abs(p.vx);
        } else if (s.x > GAME_W - half) {
          s.x = GAME_W - half;
          p.vx = -Math.abs(p.vx);
        }
      }
    }

    // World scroll: pin the player at SCROLL_LINE while it climbs.
    if (this.player.y < SCROLL_LINE) {
      const shift = SCROLL_LINE - this.player.y;
      this.player.y = SCROLL_LINE;
      for (const p of this.active) p.sprite.y += shift;
      for (const s of this.stars) {
        s.y += shift * 0.3;
        if (s.y > GAME_H + 40) {
          s.y = -40;
          s.x = Phaser.Math.Between(0, GAME_W);
        }
      }
      this.nextSpawnY += shift;
      this.rise += shift;
      const sc = Math.floor(this.rise / 100);
      if (sc !== this.score) {
        this.score = sc;
        this.emitScore();
      }
    }

    // Spawn platforms above the visible area so the climb never runs dry.
    while (this.nextSpawnY > -240) {
      this.nextSpawnY -= Phaser.Math.Between(55, 105);
      this.spawnPlatform(this.nextSpawnY);
    }

    // Recycle platforms that fell off-screen or were consumed.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      if (p.dead || p.sprite.y > GAME_H + 60) {
        this.tweens.killTweensOf(p.sprite);
        p.sprite.setVisible(false).setAlpha(1).setScale(1);
        this.active.splice(i, 1);
        this.pool.push(p);
      }
    }

    // Game over: fell below the canvas.
    if (this.player.y > GAME_H + 20) {
      this.gameOver();
    }
  }

  // ---- FX -------------------------------------------------------------

  private bounceFx(x: number, y: number): void {
    const tint = colorInt(THEME.accent);
    for (let i = 0; i < 5; i++) {
      const p = this.add
        .image(x, y, "doodle-particle")
        .setTint(tint)
        .setScale(0.6)
        .setDepth(8);
      const ang = Math.random() * Math.PI * 2;
      const dist = 12 + Math.random() * 16;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0,
        duration: 260,
        ease: "power2",
        onComplete: () => p.destroy(),
      });
    }
  }

  // ---- Lifecycle ------------------------------------------------------

  private startRound(): void {
    this.layoutStart();
    this.vy = -JUMP;
    this.state = "playing";
    this.title?.setAlpha(0.2);
    this.hint?.setAlpha(0);
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private gameOver(): void {
    this.state = "over";
    this.tweens.killTweensOf(this.player);
    if (this.score > this.best) {
      this.best = this.score;
      this.saveBest();
    }
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: this.score,
      best: this.best,
      reason: "Fell down",
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
