"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";

/**
 * Reads the live frame rate from a running Phaser game so we can spot
 * low-end Android regressions directly in the UI. The HUD is cheap
 * (rAF-throttled, no re-renders of the game).
 */
export default function FpsHud({ game }: { game: Phaser.Game | null }) {
  const [fps, setFps] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

  useEffect(() => {
    if (!game) return;

    const tick = (now: number) => {
      // Update ~4x/sec to avoid churn.
      if (now - lastRef.current > 250) {
        lastRef.current = now;
        const value = Math.round(game.loop.actualFps);
        setFps(value);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [game]);

  const color =
    fps >= 50 ? "#22c55e" : fps >= 30 ? "#fbbf24" : "#ef4444";

  return (
    <div className="pointer-events-none rounded-full bg-black/55 px-2.5 py-1 font-mono text-[11px] leading-none text-white tabular-nums backdrop-blur">
      <span style={{ color }}>{fps}</span>
      <span className="text-white/50"> fps</span>
    </div>
  );
}
