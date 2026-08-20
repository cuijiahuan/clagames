"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { WhackScene, setBridge } from "./WhackScene";

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

export default function WhackGame() {
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
  const [remaining, setRemaining] = useState(30);

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
        title={state === "over" ? "Time's Up!" : "Mole Mash"}
        cta={state === "over" ? "Mash Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>
            Whack the moles as they pop up — chain hits for combo multipliers.
            Dodge the bombs! You have 30 seconds.
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
      title="Mole Mash"
      subtitle="30s • whack fast"
      score={score}
      best={best}
      gameRef={game}
      extraStat={<TimerChip remaining={remaining} />}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[WhackScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
