import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "ClaGames — Instant Play, No Download",
};

interface GameCard {
  href: string;
  title: string;
  tag: string;
  desc: string;
  accent: string;
  glow: string;
  icon: ReactNode;
}

const games: GameCard[] = [
  {
    href: "/games/match3",
    title: "Gem Crush",
    tag: "Match-3",
    desc: "Swap gems, chain combos, beat the 60-second clock.",
    accent: "from-violet-500/80 to-fuchsia-500/80",
    glow: "shadow-violet-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        {[
          [12, 12, "#ef4444"],
          [34, 12, "#f59e0b"],
          [12, 34, "#22c55e"],
          [34, 34, "#06b6d4"],
        ].map(([x, y, c], i) => (
          <rect
            key={i}
            x={x as number}
            y={y as number}
            width="18"
            height="18"
            rx="5"
            fill={c as string}
          />
        ))}
      </svg>
    ),
  },
  {
    href: "/games/runner",
    title: "Neon Dash",
    tag: "Endless Runner",
    desc: "Tap to jump. Survive the neon obstacle gauntlet.",
    accent: "from-teal-400/80 to-cyan-500/80",
    glow: "shadow-teal-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <rect x="0" y="48" width="64" height="10" fill="#334155" />
        <rect x="8" y="30" width="14" height="18" rx="6" fill="#5eead4" />
        <circle cx="18" cy="34" r="2" fill="#0b1020" />
        <rect x="40" y="34" width="10" height="14" rx="2" fill="#f87171" />
      </svg>
    ),
  },
  {
    href: "/games/snake",
    title: "Neon Snake",
    tag: "Arcade",
    desc: "Swipe to steer. Eat, grow, don't bite yourself.",
    accent: "from-emerald-400/80 to-teal-500/80",
    glow: "shadow-emerald-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        {[
          [10, 26],
          [22, 26],
          [34, 26],
          [34, 38],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="11" height="11" rx="3" fill="#34d399" />
        ))}
        <circle cx="45" cy="43" r="3" fill="#f87171" />
      </svg>
    ),
  },
  {
    href: "/games/breakout",
    title: "Brick Buster",
    tag: "Arcade",
    desc: "Slide the paddle, break every brick, 3 lives.",
    accent: "from-amber-400/80 to-orange-500/80",
    glow: "shadow-amber-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        {[
          [8, 10, "#f59e0b"],
          [22, 10, "#f97316"],
          [36, 10, "#ef4444"],
          [8, 22, "#fbbf24"],
          [22, 22, "#f59e0b"],
          [36, 22, "#f97316"],
        ].map(([x, y, c], i) => (
          <rect key={i} x={x as number} y={y as number} width="13" height="7" rx="2" fill={c as string} />
        ))}
        <rect x="24" y="50" width="18" height="4" rx="2" fill="#5eead4" />
        <circle cx="33" cy="40" r="3" fill="#e2e8f0" />
      </svg>
    ),
  },
  {
    href: "/games/flappy",
    title: "Flap Bird",
    tag: "Arcade",
    desc: "Tap to flap through the pipes. How far can you fly?",
    accent: "from-cyan-400/80 to-sky-500/80",
    glow: "shadow-cyan-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <rect x="44" y="0" width="9" height="26" fill="#475569" />
        <rect x="44" y="40" width="9" height="24" fill="#475569" />
        <circle cx="22" cy="32" r="9" fill="#22d3ee" />
        <polygon points="29,32 36,29 36,35" fill="#f59e0b" />
        <circle cx="18" cy="29" r="1.6" fill="#0b1020" />
      </svg>
    ),
  },
  {
    href: "/games/g2048",
    title: "Swipe 2048",
    tag: "Puzzle",
    desc: "Swipe to merge tiles. Reach 2048 — and beyond.",
    accent: "from-violet-500/80 to-indigo-500/80",
    glow: "shadow-violet-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <rect x="8" y="8" width="22" height="22" rx="4" fill="#a78bfa" />
        <rect x="34" y="8" width="22" height="22" rx="4" fill="#818cf8" />
        <rect x="8" y="34" width="22" height="22" rx="4" fill="#6366f1" />
        <rect x="34" y="34" width="22" height="22" rx="4" fill="#4f46e5" />
        <text x="19" y="24" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fff">2</text>
        <text x="45" y="24" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fff">4</text>
        <text x="19" y="50" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#fff">8</text>
        <text x="45" y="50" textAnchor="middle" fontSize="10" fontWeight="bold" fill="#fff">16</text>
      </svg>
    ),
  },
  {
    href: "/games/memory",
    title: "Pair Up",
    tag: "Memory",
    desc: "Flip cards, find matching pairs in fewer moves.",
    accent: "from-teal-400/80 to-emerald-500/80",
    glow: "shadow-teal-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <rect x="8" y="10" width="20" height="26" rx="3" fill="#2a3a6b" />
        <rect x="8" y="10" width="20" height="26" rx="3" fill="none" stroke="#5eead4" strokeWidth="1.5" />
        <rect x="36" y="28" width="20" height="26" rx="3" fill="#1e293b" transform="rotate(12 46 41)" />
        <text x="18" y="28" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#5eead4">?</text>
      </svg>
    ),
  },
  {
    href: "/games/whack",
    title: "Mole Mash",
    tag: "Reflex",
    desc: "30 seconds. Whack moles, dodge bombs, chain combos.",
    accent: "from-amber-400/80 to-rose-500/80",
    glow: "shadow-amber-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <ellipse cx="32" cy="50" rx="24" ry="8" fill="#1e293b" />
        <rect x="22" y="32" width="20" height="20" rx="9" fill="#5eead4" />
        <circle cx="27" cy="40" r="2" fill="#0b1020" />
        <circle cx="37" cy="40" r="2" fill="#0b1020" />
        <rect x="30" y="44" width="4" height="3" rx="1.5" fill="#0b1020" />
      </svg>
    ),
  },
  {
    href: "/games/doodle",
    title: "Hop Up",
    tag: "Arcade",
    desc: "Move left & right. Bounce on platforms, climb forever.",
    accent: "from-teal-400/80 to-green-500/80",
    glow: "shadow-teal-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <rect x="6" y="44" width="20" height="5" rx="2.5" fill="#a78bfa" />
        <rect x="38" y="28" width="20" height="5" rx="2.5" fill="#fbbf24" />
        <rect x="22" y="12" width="20" height="5" rx="2.5" fill="#5eead4" />
        <circle cx="32" cy="38" r="7" fill="#5eead4" />
        <circle cx="29" cy="37" r="1.4" fill="#0b1020" />
      </svg>
    ),
  },
  {
    href: "/games/bubble",
    title: "Bubble Pop",
    tag: "Puzzle",
    desc: "Aim, shoot, match 3+ same-color bubbles. Clear the board.",
    accent: "from-fuchsia-500/80 to-purple-500/80",
    glow: "shadow-fuchsia-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <circle cx="20" cy="18" r="9" fill="#ef4444" />
        <circle cx="40" cy="18" r="9" fill="#f59e0b" />
        <circle cx="30" cy="34" r="9" fill="#22c55e" />
        <circle cx="14" cy="36" r="6" fill="#06b6d4" />
        <circle cx="46" cy="36" r="6" fill="#a855f7" />
        <circle cx="17" cy="15" r="2.5" fill="#fff" opacity="0.7" />
      </svg>
    ),
  },
  {
    href: "/games/maze",
    title: "Maze Run",
    tag: "Puzzle",
    desc: "Swipe through procedurally-generated mazes. Beat the timer.",
    accent: "from-indigo-500/80 to-violet-500/80",
    glow: "shadow-indigo-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden strokeWidth="3" stroke="#818cf8" fill="none">
        <path d="M10 10 H54 V54 H10 Z M10 22 H30 M22 22 V38 M22 38 H42 M30 38 V54 M42 38 V22 M42 30 H54" />
        <circle cx="14" cy="14" r="3" fill="#5eead4" stroke="none" />
        <circle cx="50" cy="50" r="3" fill="#fbbf24" stroke="none" />
      </svg>
    ),
  },
  {
    href: "/games/tictac",
    title: "TicTac",
    tag: "Strategy",
    desc: "Classic tic-tac-toe vs a smart AI. Build a win streak.",
    accent: "from-teal-400/80 to-cyan-500/80",
    glow: "shadow-teal-500/30",
    icon: (
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
        <path d="M24 8 V56 M40 8 V56 M8 24 H56 M8 40 H56" stroke="#334155" strokeWidth="3" fill="none" />
        <path d="M11 11 L21 21 M21 11 L11 21" stroke="#5eead4" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="45" cy="45" r="7" stroke="#f87171" strokeWidth="3.5" fill="none" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-[var(--game-bg)] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-10 sm:py-14">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-violet-500 text-sm font-black text-slate-950">
              C
            </div>
            <span className="text-sm font-semibold tracking-tight">
              ClaGames
            </span>
          </div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/60">
            12 games · No download
          </span>
        </header>

        {/* Hero */}
        <section className="mt-10 flex flex-col items-center text-center sm:mt-16">
          <span className="mb-4 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-xs font-medium text-teal-300">
            Play instantly in your browser
          </span>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Tap, play, go.
            <br />
            <span className="bg-gradient-to-r from-teal-300 to-violet-400 bg-clip-text text-transparent">
              12 games that just work.
            </span>
          </h1>
          <p className="mt-4 max-w-md text-base text-white/60 sm:text-lg">
            Casual games for the mobile web. Built with Next.js + Phaser — no
            app store, no waiting. Mobile-first, tuned for low-end Android.
          </p>
        </section>

        {/* Game grid */}
        <section className="mt-12 grid grid-cols-2 gap-4 sm:mt-16 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
          {games.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl transition hover:-translate-y-1 hover:border-white/20 sm:p-5 ${g.glow}`}
            >
              <div
                className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${g.accent}`}
              />
              <div className="mb-3 flex items-center justify-between sm:mb-4">
                <div className="grid h-14 w-14 place-items-center rounded-xl bg-black/40 sm:h-16 sm:w-16">
                  {g.icon}
                </div>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-medium text-white/60 sm:text-[11px]">
                  {g.tag}
                </span>
              </div>
              <h2 className="text-base font-bold sm:text-xl">{g.title}</h2>
              <p className="mt-1 text-xs text-white/55 sm:text-sm">{g.desc}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-teal-300 transition group-hover:gap-2 sm:mt-4 sm:text-sm">
                Play now →
              </span>
            </Link>
          ))}
        </section>

        {/* Tech footer */}
        <footer className="mt-auto pt-14 text-center text-xs text-white/40">
          Built with Next.js {`(App Router)`} + Phaser · Tailwind CSS
        </footer>
      </main>
    </div>
  );
}
