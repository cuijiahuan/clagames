// Shared visual theme so both games feel like the same product ("ClaGames").
// Colors are tuned to look good on low-end Android panels (high contrast).

export const THEME = {
  bg: "#0b1020",
  bgGradientTop: "#1b2550",
  bgGradientBottom: "#0b1020",
  panel: "#111a33",
  panelStroke: "#2a3a6b",
  accent: "#5eead4", // teal
  accent2: "#a78bfa", // violet
  danger: "#f87171",
  warning: "#fbbf24",
  text: "#e2e8f0",
  textDim: "#94a3b8",
  // Match-3 gem palette (6 types). High-saturation, distinguishable.
  gems: ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"],
  // Runner palette
  runnerPlayer: "#5eead4",
  runnerObstacle: "#f87171",
  runnerGround: "#1e293b",
  runnerGroundLine: "#334155",
  runnerSky: "#0b1020",
} as const;

export const FONT_FAMILY =
  "Geist, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
