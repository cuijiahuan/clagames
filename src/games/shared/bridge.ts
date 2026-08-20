// Tiny framework-agnostic event bus so React and Phaser scenes can talk
// without importing Phaser at module load time (keeps SSR safe).

export type GameState = "ready" | "playing" | "over";

export interface ScorePayload {
  score: number;
  best: number;
}

export interface TimerPayload {
  remaining: number; // seconds remaining (match-3)
}

export interface GameOverPayload {
  score: number;
  best: number;
  reason?: string;
}

type Handler<T = unknown> = (payload: T) => void;

export class GameBridge {
  private listeners = new Map<string, Set<Handler>>();

  on<T = unknown>(event: string, fn: Handler<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Handler);
    return () => this.off(event, fn);
  }

  once<T = unknown>(event: string, fn: Handler<T>): () => void {
    const off = this.on<T>(event, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<T = unknown>(event: string, fn: Handler<T>): void {
    this.listeners.get(event)?.delete(fn as Handler);
  }

  emit<T = unknown>(event: string, payload?: T): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload as T);
      } catch (err) {
        console.error(`[GameBridge] handler error for "${event}"`, err);
      }
    });
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

// Canonical event names so both sides agree.
export const GameEvents = {
  State: "state", // GameState
  Score: "score", // ScorePayload
  Timer: "timer", // TimerPayload
  Combo: "combo", // { chain, multiplier }
  GameOver: "gameover", // GameOverPayload
  Start: "start", // React -> Phaser
  Restart: "restart", // React -> Phaser
  Pause: "pause", // React -> Phaser
  Resume: "resume", // React -> Phaser
} as const;
