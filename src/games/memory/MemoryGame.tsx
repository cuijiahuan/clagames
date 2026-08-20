"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { MemoryScene, setBridge } from "./MemoryScene";

function MovesChip({ moves }: { moves: number }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[9px] font-medium tracking-widest text-white/40">
        MOVES
      </span>
      <span className="font-mono text-sm tabular-nums text-white">{moves}</span>
    </div>
  );
}

export default function MemoryGame() {
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
        title={state === "over" ? "Solved!" : "Pair Up"}
        cta={state === "over" ? "Play Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>
            Flip two cards to find matching pairs. Matches stay face-up.
            Clear all eight pairs to win — fewer moves earns a better score.
          </p>
        ) : (
          <p>
            You cleared the board in{" "}
            <b className="text-teal-300">{score}</b> moves. Best:{" "}
            <b>{best}</b> moves.
          </p>
        )}
      </GameOverlay>
    );

  return (
    <GameShell
      title="Pair Up"
      subtitle="Find matching pairs"
      score={score}
      best={best}
      gameRef={game}
      extraStat={<MovesChip moves={score} />}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[MemoryScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
