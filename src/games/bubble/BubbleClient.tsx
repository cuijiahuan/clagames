"use client";

import dynamic from "next/dynamic";
import GameLoading from "@/components/GameLoading";

// `ssr: false` must live in a Client Component (not a Server Component).
// Phaser is browser-only, so we never server-render the game.
const BubbleGame = dynamic(() => import("./BubbleGame"), {
  ssr: false,
  loading: () => <GameLoading label="Loading Bubble Pop…" />,
});

export default function BubbleClient() {
  return <BubbleGame />;
}
