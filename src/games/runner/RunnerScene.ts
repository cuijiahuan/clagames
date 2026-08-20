import Phaser from "@/lib/phaser";
import {
  GameBridge,
  GameEvents,
  type GameState,
} from "@/games/shared/bridge";
import { THEME, FONT_FAMILY } from "@/games/shared/theme";
import { makeAllTextures } from "@/games/shared/textures";

// ---- Runner config ----------------------------------------------------
const GAME_W = 450;
const GAME_H = 800;
const GROUND_TOP = 664; // top of the ground band
const PLAYER_X = 116;
const PLAYER_W = 48;
const PLAYER_H = 60;
const GRAVITY = 2400; // px/s^2
const JUMP_V = -880; // initial jump velocity
const BASE_SPEED = 320; // px/s world scroll
const SPEED_ACCEL = 14; // px/s added per second
const MAX_SPEED = 720;
const BEST_KEY = "clagames.runner.best";

interface Obstacle {
  sprite: Phaser.GameObjects.Image;
  w: number;
  h: number;
  active: boolean;
}

/**
 * Neon Dash — an endless runner tuned for one-handed mobile play.
 * Tap anywhere (or press Space/Up) to jump. Obstacles speed up over time.
 * Physics is handled manually for full control and predictable collisions.
 */
// The React wrapper injects its GameBridge here before the scene boots, so
// we can pass the scene CLASS to Phaser (which builds a fresh instance per
// game). This avoids reusing a destroyed instance under React StrictMode.
let activeBridge: GameBridge | null = null;
export function setBridge(bridge: GameBridge): void {
  activeBridge = bridge;
}

export class RunnerScene extends Phaser.Scene {
  private bridge!: GameBridge;
  private state: GameState = "ready";
  private player!: Phaser.GameObjects.Image;
  private playerY = 0;
  private vy = 0;
  private onGround = true;
  private ground!: Phaser.GameObjects.TileSprite;
  private buildings!: Phaser.GameObjects.TileSprite;
  private stars: Phaser.GameObjects.Image[] = [];
  private pool: Obstacle[] = [];
  private active: Obstacle[] = [];
  private elapsed = 0;
  private speed = BASE_SPEED;
  private nextSpawn = 0.6;
  private score = 0;
  private best = 0;
  private intScore = -1;
  private hint?: Phaser.GameObjects.Text;
  private title?: Phaser.GameObjects.Text;
  private bobT = 0;

  constructor() {
    super({ key: "Runner" });
  }

  create(): void {
    this.bridge = activeBridge!;
    makeAllTextures(this);
    this.best = this.loadBest();
    this.cameras.main.setBackgroundColor(THEME.bg);

    // Sky gradient.
    const sky = this.add.graphics();
    sky.fillGradientStyle(
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x1b, 0x25, 0x50),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      Phaser.Display.Color.GetColor(0x0b, 0x10, 0x20),
      1,
    );
    sky.fillRect(0, 0, GAME_W, GAME_H);

    // Bokeh stars (parallax far layer).
    for (let i = 0; i < 14; i++) {
      const s = this.add
        .image(Phaser.Math.Between(0, GAME_W), Phaser.Math.Between(40, 520), "bokeh")
        .setAlpha(0.5)
        .setScale(Phaser.Math.FloatBetween(0.4, 1));
      this.stars.push(s);
    }

    // Distant buildings (mid parallax).
    this.buildings = this.add
      .tileSprite(0, GROUND_TOP - 120, GAME_W, 160, "building")
      .setOrigin(0, 0)
      .setAlpha(0.55)
      .setTileScale(1, 1.2);

    // Ground band.
    this.add
      .rectangle(0, GROUND_TOP, GAME_W, GAME_H - GROUND_TOP, 0x0b1020, 0)
      .setOrigin(0, 0);
    this.ground = this.add
      .tileSprite(0, GROUND_TOP, GAME_W, GAME_H - GROUND_TOP, "ground")
      .setOrigin(0, 0);
    // Neon line on the ground edge.
    const line = this.add
      .rectangle(0, GROUND_TOP, GAME_W, 3, 0x5eead4)
      .setOrigin(0, 0)
      .setAlpha(0.8);

    // Player.
    this.playerY = GROUND_TOP - PLAYER_H / 2 - 2;
    this.player = this.add.image(PLAYER_X, this.playerY, "player").setDepth(10);

    this.title = this.add
      .text(GAME_W / 2, 150, "NEON DASH", {
        fontFamily: FONT_FAMILY,
        fontSize: "40px",
        color: "#e2e8f0",
        fontStyle: "bold",
      })
      .setOrigin(0.5)
      .setAlpha(0.9);
    this.hint = this.add
      .text(GAME_W / 2, GROUND_TOP - 150, "Tap to jump", {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        color: THEME.textDim,
      })
      .setOrigin(0.5);

    line.setDepth(2);
    this.ground.setDepth(2);

    // Input — works for mouse and touch (pointerdown).
    this.input.on("pointerdown", this.onTap, this);
    this.input.keyboard?.on("keydown-SPACE", () => this.onTap());
    this.input.keyboard?.on("keydown-UP", () => this.onTap());

    // React -> Phaser controls. Remove them on shutdown so a recreated game
    // (e.g. React StrictMode dev double-mount) doesn't leak handlers.
    // Guard with isActive() in case a start event races with shutdown
    // (the scene's this.add/this.tweens become null after destroy).
    const startIfActive = () => {
      if (this.sys.isActive()) this.startRun();
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

  // ---- Input ----------------------------------------------------------

  private onTap = (_pointer?: Phaser.Input.Pointer): void => {
    if (this.state === "ready" || this.state === "over") {
      // Let the React overlay drive start/restart; tapping the canvas also
      // kicks a fresh run for instant feel.
      this.bridge.emit(GameEvents.Start);
      return;
    }
    if (this.state !== "playing") return;
    if (this.onGround) {
      this.vy = JUMP_V;
      this.onGround = false;
      this.tweens.add({
        targets: this.player,
        scaleY: 0.82,
        scaleX: 1.12,
        duration: 90,
        yoyo: true,
      });
    } else if (this.vy < 0) {
      // hold-to-jump a bit higher (variable jump height)
      this.vy -= 60;
    }
  };

  // ---- Loop -----------------------------------------------------------

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000; // clamp big frame gaps
    if (this.state !== "playing") {
      // Idle drift so the scene looks alive on the "ready" screen.
      this.ground.tilePositionX += BASE_SPEED * 0.25 * dt;
      this.buildings.tilePositionX += BASE_SPEED * 0.04 * dt;
      this.bobT += dt;
      this.player.y =
        this.playerY + Math.sin(this.bobT * 6) * 2 + (this.state === "over" ? 0 : 0);
      return;
    }

    this.elapsed += dt;
    this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.elapsed * SPEED_ACCEL);

    // Physics: gravity + ground clamp.
    this.vy += GRAVITY * dt;
    this.playerY += this.vy * dt;
    const groundCenter = GROUND_TOP - PLAYER_H / 2 - 2;
    if (this.playerY >= groundCenter) {
      this.playerY = groundCenter;
      this.vy = 0;
      if (!this.onGround) {
        this.onGround = true;
        this.tweens.add({
          targets: this.player,
          scaleY: 1,
          scaleX: 1,
          duration: 80,
        });
      }
    }
    // Slight tilt while airborne.
    this.player.setRotation(Phaser.Math.Clamp(this.vy / 2400, -0.18, 0.22));

    // Running bob.
    this.bobT += dt;
    this.player.y = this.onGround
      ? this.playerY + Math.sin(this.bobT * 16) * 2
      : this.playerY;

    // World scroll.
    this.ground.tilePositionX += this.speed * dt;
    this.buildings.tilePositionX += this.speed * 0.18 * dt;
    for (const s of this.stars) {
      s.x -= this.speed * 0.05 * dt;
      if (s.x < -40) s.x = GAME_W + 40;
    }

    // Obstacles.
    for (const ob of this.active) {
      ob.sprite.x -= this.speed * dt;
    }
    // Recycle off-screen.
    for (let i = this.active.length - 1; i >= 0; i--) {
      const ob = this.active[i];
      if (ob.sprite.x < -ob.w) {
        ob.sprite.setVisible(false);
        ob.active = false;
        this.active.splice(i, 1);
        this.pool.push(ob);
      }
    }

    // Spawn new obstacles.
    if (this.elapsed >= this.nextSpawn) {
      this.spawnObstacle();
      const interval = Math.max(0.62, 1.5 - this.elapsed * 0.016);
      this.nextSpawn = this.elapsed + interval * Phaser.Math.FloatBetween(0.85, 1.25);
    }

    // Collision (forgiving AABB).
    const pBox = {
      x: this.player.x - PLAYER_W * 0.32,
      y: this.player.y - PLAYER_H * 0.4,
      w: PLAYER_W * 0.64,
      h: PLAYER_H * 0.8,
    };
    for (const ob of this.active) {
      const oBox = {
        x: ob.sprite.x - ob.w * 0.4,
        y: ob.sprite.y - ob.h * 0.4,
        w: ob.w * 0.8,
        h: ob.h * 0.8,
      };
      if (this.aabb(pBox, oBox)) {
        this.gameOver();
        return;
      }
    }

    // Score (~10 pts/sec, +distance).
    this.score += dt * 10;
    const is = Math.floor(this.score);
    if (is !== this.intScore) {
      this.intScore = is;
      this.emitScore();
    }
  }

  private aabb(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  // ---- Obstacle pool --------------------------------------------------

  private spawnObstacle(): void {
    const h = Phaser.Math.Between(44, 86);
    const w = h > 70 ? 34 : 40;
    let ob = this.pool.pop();
    if (!ob) {
      const sprite = this.add.image(0, 0, "obstacle").setDepth(5);
      ob = { sprite, w, h, active: false };
    } else {
      ob.sprite.setTexture("obstacle").setVisible(true);
    }
    ob.w = w;
    ob.h = h;
    ob.active = true;
    ob.sprite
      .setOrigin(0.5, 1)
      .setDisplaySize(w, h)
      .setPosition(GAME_W + 40 + Phaser.Math.Between(0, 60), GROUND_TOP - 2);
    this.active.push(ob);
  }

  // ---- Lifecycle ------------------------------------------------------

  private startRun(): void {
    // Reset obstacles.
    for (const ob of this.active) {
      ob.sprite.setVisible(false);
      this.pool.push(ob);
    }
    this.active = [];

    this.playerY = GROUND_TOP - PLAYER_H / 2 - 2;
    this.vy = 0;
    this.onGround = true;
    this.player
      .setY(this.playerY)
      .setRotation(0)
      .setScale(1);
    this.elapsed = 0;
    this.speed = BASE_SPEED;
    this.nextSpawn = 0.6;
    this.score = 0;
    this.intScore = -1;
    this.state = "playing";
    this.title?.setAlpha(0.25);
    this.hint?.setAlpha(0);
    this.bridge.emit(GameEvents.State, "playing" as GameState);
    this.emitScore();
  }

  private gameOver(): void {
    this.state = "over";
    this.vy = -260; // little hop on death
    this.tweens.add({ targets: this.player, angle: 90, duration: 360 });
    if (this.score > this.best) {
      this.best = this.score;
      this.saveBest();
    }
    this.emitScore();
    this.bridge.emit(GameEvents.State, "over" as GameState);
    this.bridge.emit(GameEvents.GameOver, {
      score: Math.floor(this.score),
      best: Math.floor(this.best),
      reason: "Crashed!",
    });
  }

  // ---- persistence / events ------------------------------------------

  private emitScore(): void {
    this.bridge.emit(GameEvents.Score, {
      score: Math.floor(this.score),
      best: Math.floor(this.best),
    });
  }
  private loadBest(): number {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(BEST_KEY) || 0);
  }
  private saveBest(): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(BEST_KEY, String(Math.floor(this.best)));
  }
}
