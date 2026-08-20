import Phaser from "@/lib/phaser";
import { THEME } from "./theme";

// All artwork is generated at runtime so the site needs zero image assets
// (instant load, no extra requests on low-end mobile networks).

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mix(a: string, b: string, t: number): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | bb;
}

function lighten(hex: string, t: number): number {
  return mix(hex, "#ffffff", t);
}
function darken(hex: string, t: number): number {
  return mix(hex, "#000000", t);
}

/** A glossy rounded-square gem with a soft top-left highlight. */
export function makeGemTexture(
  scene: Phaser.Scene,
  key: string,
  color: string,
  size = 64,
): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const r = size * 0.22;

  // soft drop shadow
  g.fillStyle(0x000000, 0.28);
  g.fillRoundedRect(2, 4, size - 4, size - 4, r);
  // base
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(color)), 1);
  g.fillRoundedRect(0, 0, size - 2, size - 2, r);
  // bottom shade
  g.fillStyle(darken(color, 0.28), 0.9);
  g.fillRoundedRect(0, size * 0.45, size - 2, size * 0.5 - 2, r);
  // top-left highlight
  g.fillStyle(lighten(color, 0.55), 0.85);
  g.fillRoundedRect(size * 0.12, size * 0.1, size * 0.5, size * 0.28, r * 0.7);
  // sparkle dot
  g.fillStyle(0xffffff, 0.92);
  g.fillCircle(size * 0.24, size * 0.22, size * 0.05);

  g.generateTexture(key, size, size);
  g.destroy();
}

/** Selection highlight frame used by the match-3 board. */
export function makeSelectorTexture(scene: Phaser.Scene, key: string, size = 64): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const pad = 4;
  g.lineStyle(4, 0xffffff, 1);
  g.strokeRoundedRect(pad, pad, size - pad * 2, size - pad * 2, size * 0.2);
  g.lineStyle(2, lighten(THEME.accent, 0.2), 0.9);
  g.strokeRoundedRect(pad + 2, pad + 2, size - pad * 2 - 4, size - pad * 2 - 4, size * 0.2);
  g.generateTexture(key, size, size);
  g.destroy();
}

/** Particle used for clear/pop FX. */
export function makeParticleTexture(scene: Phaser.Scene, key: string, size = 16): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(size / 2, size / 2, size / 2);
  g.generateTexture(key, size, size);
  g.destroy();
}

/** Neon runner character: a rounded capsule with eye + glow. */
export function makePlayerTexture(scene: Phaser.Scene, key: string, w = 48, h = 60): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const r = 14;
  // glow
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(THEME.runnerPlayer)), 0.25);
  g.fillRoundedRect(-4, -4, w + 8, h + 8, r + 4);
  // body
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(THEME.runnerPlayer)), 1);
  g.fillRoundedRect(0, 0, w, h, r);
  // darker belly
  g.fillStyle(darken(THEME.runnerPlayer, 0.3), 0.6);
  g.fillRoundedRect(6, h * 0.45, w - 12, h * 0.4, r * 0.7);
  // eye
  g.fillStyle(0x0b1020, 1);
  g.fillCircle(w * 0.66, h * 0.28, 5);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(w * 0.7, h * 0.25, 2);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Obstacle block with neon top edge. */
export function makeObstacleTexture(
  scene: Phaser.Scene,
  key: string,
  w = 40,
  h = 60,
): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x000000, 0.3);
  g.fillRoundedRect(2, 4, w, h, 8);
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(THEME.runnerObstacle)), 1);
  g.fillRoundedRect(0, 0, w, h, 8);
  g.fillStyle(lighten(THEME.runnerObstacle, 0.4), 0.95);
  g.fillRect(0, 0, w, 8);
  g.fillStyle(darken(THEME.runnerObstacle, 0.35), 0.8);
  g.fillRoundedRect(4, h * 0.5, w - 8, h * 0.42, 6);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Repeating ground tile. */
export function makeGroundTexture(scene: Phaser.Scene, key: string, w = 64, h = 64): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(THEME.runnerGround)), 1);
  g.fillRect(0, 0, w, h);
  g.fillStyle(Phaser.Display.Color.GetColor(...hexToRgb(THEME.runnerGroundLine)), 1);
  g.fillRect(0, 0, w, 3);
  g.fillStyle(lighten(THEME.runnerGround, 0.15), 0.5);
  for (let i = 0; i < 3; i++) {
    g.fillRect((i * 22) % w, 14 + i * 6, 10, 2);
  }
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Distant building silhouette for parallax. */
export function makeBuildingTexture(scene: Phaser.Scene, key: string, w = 80, h = 120): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x1b2550, 1);
  g.fillRoundedRect(0, 0, w, h, 4);
  g.fillStyle(0x3b82f6, 0.5);
  for (let y = 10; y < h - 10; y += 14) {
    for (let x = 8; x < w - 8; x += 14) {
      if ((x + y) % 3 === 0) g.fillRect(x, y, 6, 6);
    }
  }
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Soft circle used for background bokeh. */
export function makeBokehTexture(scene: Phaser.Scene, key: string, size = 64): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let i = 4; i >= 0; i--) {
    g.fillStyle(0x5eead4, 0.04 * (5 - i));
    g.fillCircle(size / 2, size / 2, (size / 2) * (1 - i * 0.18));
  }
  g.generateTexture(key, size, size);
  g.destroy();
}

export function makeAllTextures(scene: Phaser.Scene): void {
  THEME.gems.forEach((c, i) => makeGemTexture(scene, `gem-${i}`, c, 64));
  makeSelectorTexture(scene, "selector", 64);
  makeParticleTexture(scene, "particle", 16);
  makePlayerTexture(scene, "player");
  makeObstacleTexture(scene, "obstacle");
  makeGroundTexture(scene, "ground");
  makeBuildingTexture(scene, "building");
  makeBokehTexture(scene, "bokeh", 96);
}
