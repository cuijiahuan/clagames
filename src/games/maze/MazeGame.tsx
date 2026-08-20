"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { MazeScene, setBridge } from "./MazeScene";

function TimerChip({ remaining }: { remaining: number }) {
  const danger = remaining <= 10;
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[9px] font-medium tracking-widest text-white/40">
        TIME
      </span>
      <span
        className={`font-mono text-sm tabular-nums ${
          danger ? "text-rose-400" : "text-white"
        }`}
      >
        {String(Math.floor(remaining / 60)).padStart(1, "0")}:
        {String(remaining % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

export default function MazeGame() {
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
  const [remaining, setRemaining] = useState(60);

  useEffect(() => {
    const offs = [
      bridge.on<GameState>(GameEvents.State, (s) => setState(s)),
      bridge.on<{ score: number; best: number }>(GameEvents.Score, (p) => {
        setScore(p.score);
        setBest(p.best);
      }),
      bridge.on<{ remaining: number }>(GameEvents.Timer, (p) =>
        setRemaining(p.remaining),
      ),
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
        title={state === "over" ? "Time's Up!" : "Maze Run"}
        cta={state === "over" ? "Run Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>
            Swipe (or use arrow keys) to guide your dot through the maze to the
            gold exit. Each level cleared adds points and a +8s bonus — but the
            maze grows every level. You have 60 seconds.
          </p>
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
      title="Maze Run"
      subtitle="60s • find exit"
      score={score}
      best={best}
      gameRef={game}
      extraStat={<TimerChip remaining={remaining} />}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[MazeScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
