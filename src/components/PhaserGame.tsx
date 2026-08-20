"use client";

import Phaser from "@/lib/phaser";
import { useEffect, useRef } from "react";
import { THEME } from "@/games/shared/theme";

export interface PhaserGameProps {
  /** Base (design) resolution. The canvas scales to fit the container. */
  width: number;
  height: number;
  /** Phaser scene classes (fresh instance per game) or instances. */
  scenes: Array<Phaser.Scene | (new () => Phaser.Scene)>;
  backgroundColor?: string;
  /** Optional extra GameConfig tweaks (e.g. physics). */
  physics?: Phaser.Types.Core.PhysicsConfig;
  /** Called once the Phaser.Game is created (after first mount). */
  onReady?: (game: Phaser.Game) => void;
  className?: string;
}

/**
 * Mounts a Phaser game inside a React tree and tears it down on unmount.
 *
 * Lifecycle / Responsive / Touch notes:
 *  - Scale.FIT keeps the design aspect ratio and letterboxes to the parent.
 *  - CENTER_BOTH centers the canvas for desktop letterboxing.
 *  - `touch-action: none` on the container stops the page from scrolling when
 *    the user swipes inside the game on mobile.
 *  - `powerPreference: "low-power"` + `antialias: true` keep low-end Android
 *    GPUs happy; we render an FPS HUD separately so regressions are visible.
 *  - Cleanup destroys the game so React StrictMode (dev double-invoke) works.
 */
export default function PhaserGame({
  width,
  height,
  scenes,
  backgroundColor = THEME.bg,
  physics,
  onReady,
  className,
}: PhaserGameProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // Keep the latest onReady without re-creating the game on every render.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!parentRef.current) return;
    if (gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: parentRef.current,
      backgroundColor,
      width,
      height,
      // Responsive scaling tuned for mobile-first portrait play.
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        expandParent: true,
      },
      // One canvas, no DOM-based text — better for mobile.
      render: {
        antialias: true,
        powerPreference: "low-power",
        roundPixels: true,
      },
      input: {
        activePointers: 3,
      },
      // Prevent the long-press context menu on mobile.
      disableContextMenu: true,
      // Aim for 60; actualFps is surfaced in the HUD for low-end checks.
      fps: {
        target: 60,
        min: 30,
      },
      ...(physics ? { physics } : {}),
      scene: scenes as unknown as Phaser.Types.Core.GameConfig["scene"],
    });

    gameRef.current = game;
    onReadyRef.current?.(game);

    const handleResize = () => game.scale.refresh();
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      game.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        touchAction: "none",
        // Prevent iOS callout/selection on long press.
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    />
  );
}
