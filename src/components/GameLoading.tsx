"use client";

export default function GameLoading({ label }: { label: string }) {
  return (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-[var(--game-bg)] text-white">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-teal-400" />
      <p className="text-sm text-white/60">{label}</p>
    </div>
  );
}
