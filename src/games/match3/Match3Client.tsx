"use client";

import dynamic from "next/dynamic";
import GameLoading from "@/components/GameLoading";

// `ssr: false` must live in a Client Component (not a Server Component).
// Phaser is browser-only, so we never server-render the game.
const Match3Game = dynamic(() => import("./Match3Game"), {
  ssr: false,
  loading: () => <GameLoading label="Loading Gem Crush…" />,
});

export default function Match3Client() {
  return <Match3Game />;
}
