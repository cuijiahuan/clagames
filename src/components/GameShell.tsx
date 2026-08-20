"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import FpsHud from "./FpsHud";
import type Phaser from "phaser";

export interface GameShellProps {
  title: string;
  subtitle?: string;
  score?: number;
  best?: number;
  /** Inject the live Phaser game so the FPS HUD can read it. */
  gameRef?: Phaser.Game | null;
  /** Ready / game-over overlay, rendered above the canvas. */
  overlay?: ReactNode;
  /** Extra stat chip (e.g. countdown timer). */
  extraStat?: ReactNode;
  children: ReactNode;
}

export default function GameShell({
  title,
  subtitle,
  score,
  best,
  gameRef,
  overlay,
  extraStat,
  children,
}: GameShellProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fpsOn, setFpsOn] = useState(true);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFs = async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* iOS Safari doesn't support FS — silently ignore */
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--game-bg)]"
    >
      {/* Top bar */}
      <header className="relative z-20 flex items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2 backdrop-blur sm:gap-3 sm:px-6">
        <Link
          href="/"
          className="rounded-lg border border-white/15 px-2 py-1 text-xs font-medium text-white/80 transition hover:bg-white/10"
        >
          ← Games
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
          {subtitle && (
            <p className="truncate text-[11px] text-white/50">{subtitle}</p>
          )}
        </div>

        {extraStat}

        <Stat label="SCORE" value={score ?? 0} />
        <Stat label="BEST" value={best ?? 0} accent />

        <button
          onClick={() => setFpsOn((v) => !v)}
          aria-pressed={fpsOn}
          className={`hidden rounded-lg border px-2 py-1 text-[11px] font-medium transition sm:block ${
            fpsOn
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
              : "border-white/15 text-white/60 hover:bg-white/10"
          }`}
          title="Toggle FPS overlay (low-end testing)"
        >
          FPS
        </button>
        <button
          onClick={toggleFs}
          className="rounded-lg border border-white/15 px-2 py-1 text-[11px] font-medium text-white/70 transition hover:bg-white/10"
          title="Fullscreen"
        >
          {isFs ? "⤢ Exit" : "⤢ FS"}
        </button>
      </header>

      {/* Play area */}
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-hidden">
        {/* Ambient side glow fills the letterbox on wide screens so the
            portrait canvas doesn't read as a lonely strip on desktop. */}
        <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden>
          <div className="absolute left-0 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-teal-500/10 blur-3xl" />
          <div className="absolute right-0 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-violet-500/10 blur-3xl" />
          <div className="absolute left-1/2 top-0 h-40 w-96 -translate-x-1/2 rounded-full bg-cyan-500/5 blur-3xl" />
        </div>
        {children}
        {fpsOn && (
          <div className="pointer-events-none absolute right-2 top-2 z-20">
            <FpsHud game={gameRef ?? null} />
          </div>
        )}
        {overlay && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
            {overlay}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[9px] font-medium tracking-widest text-white/40">
        {label}
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${
          accent ? "text-teal-300" : "text-white"
        }`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
