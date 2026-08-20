"use client";

import type Phaser from "phaser";
import { useEffect, useRef, useState } from "react";
import PhaserGame from "@/components/PhaserGame";
import GameShell from "@/components/GameShell";
import GameOverlay from "@/components/GameOverlay";
import { GameBridge, GameEvents, type GameState } from "@/games/shared/bridge";
import { FlappyScene, setBridge } from "./FlappyScene";

export default function FlappyGame() {
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
        title={state === "over" ? "Crashed" : "Flap Bird"}
        cta={state === "over" ? "Fly Again" : "Tap to Start"}
        onCta={() => bridge.emit(GameEvents.Start)}
      >
        {state === "ready" ? (
          <p>
            点击屏幕扇翅上升，穿过管道间隙得分，撞管道或地面结束。
          </p>
        ) : (
          <p>
            得分 <b className="text-teal-300">{score.toLocaleString()}</b>。
            最佳：<b>{best.toLocaleString()}</b>。
          </p>
        )}
      </GameOverlay>
    );

  return (
    <GameShell
      title="Flap Bird"
      subtitle="Tap to flap"
      score={score}
      best={best}
      gameRef={game}
      overlay={overlay}
    >
      <PhaserGame
        width={450}
        height={800}
        scenes={[FlappyScene]}
        onReady={setGame}
      />
    </GameShell>
  );
}
