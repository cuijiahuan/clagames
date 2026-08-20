"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { RunnerScene, setBridge } from "./RunnerScene";

function ControlsChip() {
  return (
    <div className="hidden items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/60 sm:flex">
      <span className="text-teal-300">Tap</span> = Jump
    </div>
  );
}

export default function RunnerGame() {
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
        title={state === "over" ? "Crashed!" : "Neon Dash"}
        cta={state === "over" ? "Run Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>
            An endless neon runner. Tap anywhere (or press Space) to jump over
            the blocks. The world speeds up the longer you survive.
          </p>
        ) : (
          <p>
            Distance{" "}
            <b className="text-teal-300">{score.toLocaleString()}m</b>. Best:{" "}
            <b>{best.toLocaleString()}m</b>.
          </p>
        )}
      </GameOverlay>
    );

  return (
    <GameShell
      title="Neon Dash"
      subtitle="Endless runner"
      score={score}
      best={best}
      gameRef={game}
      extraStat={<ControlsChip />}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[RunnerScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
