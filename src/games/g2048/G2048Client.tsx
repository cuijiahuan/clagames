"use client";

import dynamic from "next/dynamic";
import GameLoading from "@/components/GameLoading";

// `ssr: false` must live in a Client Component (not a Server Component).
// Phaser is browser-only, so we never server-render the game.
const G2048Game = dynamic(() => import("./G2048Game"), {
  ssr: false,
  loading: () => <GameLoading label="Loading Swipe 2048…" />,
});

export default function G2048Client() {
  return <G2048Game />;
}
