"use client";

import type { ReactNode } from "react";

export interface GameOverlayProps {
  title: string;
  children?: ReactNode;
  /** Primary CTA text. If provided, renders a button calling onClick. */
  cta?: string;
  onCta?: () => void;
  tone?: "ready" | "over";
}

export default function GameOverlay({
  title,
  children,
  cta,
  onCta,
  tone = "ready",
}: GameOverlayProps) {
  const accent = tone === "over" ? "bg-rose-500/90" : "bg-teal-400/90";
  return (
    <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-black/70 p-6 text-center backdrop-blur-md shadow-2xl">
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      {children && (
        <div className="mt-2 text-sm text-white/70">{children}</div>
      )}
      {cta && (
        <button
          onClick={onCta}
          className={`mt-5 w-full rounded-xl ${accent} px-5 py-3 text-base font-bold text-slate-950 transition active:scale-[0.98]`}
        >
          {cta}
        </button>
      )}
    </div>
  );
}
