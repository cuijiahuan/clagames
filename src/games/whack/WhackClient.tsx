"use client";

import dynamic from "next/dynamic";
import GameLoading from "@/components/GameLoading";

// `ssr: false` must live in a Client Component (not a Server Component).
// Phaser is browser-only, so we never server-render the game.
const WhackGame = dynamic(() => import("./WhackGame"), {
  ssr: false,
  loading: () => <GameLoading label="Loading Mole Mash…" />,
});

export default function WhackClient() {
  return <WhackGame />;
}
