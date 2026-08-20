"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { BubbleScene, setBridge } from "./BubbleScene";

export default function BubbleGame() {
  const bridgeRef = useRef<GameBridge | null>(null);
  if (!bridgeRef.current) {
    bridgeRef.current = new GameBridge();
    // Inject the bridge before PhaserGame mounts so the scene's create() can
    // read it (we pass the scene CLASS, not a pre-built instance).
    setBridge(bridgeRef.current);
  }
  const bridge = bridgeRef.current;

  const [game, setGame] = useState<Phaser.Game | null>(null);
  const [state, setState] = useState<GameState>("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  useEffect(() => {
    const offs = [
      bridge.on<GameState>(GameEvents.State, (s) => setState(s)),
      bridge.on<{ score: number; best: number }>(GameEvents.Score, (p) => {
        setScore(p.score);
        setBest(p.best);
      }),
      bridge.on<{ score: number; best: number }>(GameEvents.GameOver, (p) => {
        setScore(p.score);
        setBest(p.best);
        setState("over");
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      bridge.removeAll();
    };
  }, [bridge]);

  const overlay =
    state === "playing" ? null : (
      <GameOverlay
        tone={state === "over" ? "over" : "ready"}
        title={state === "over" ? "Bubble Overflow" : "Bubble Pop"}
        cta={state === "over" ? "Pop Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>瞄准并发射泡泡，3 个以上同色相连消除，泡泡触底结束。</p>
        ) : (
          <p>
            You scored <b className="text-teal-300">{score.toLocaleString()}</b>.
            Best: <b>{best.toLocaleString()}</b>.
          </p>
        )}
      </GameOverlay>
    );

  return (
    <GameShell
      title="Bubble Pop"
      subtitle="Aim & match 3+"
      score={score}
      best={best}
      gameRef={game}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[BubbleScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
