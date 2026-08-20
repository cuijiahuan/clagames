import type { MetadataRoute } from "next";

// `output: 'export'` requires route handlers to opt into static rendering.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ClaGames — Instant Play",
    short_name: "ClaGames",
    description:
      "Play casual browser games instantly — no installs, no app store.",
    start_url: "/",
    display: "fullscreen",
    orientation: "portrait",
    background_color: "#0b1020",
    theme_color: "#0b1020",
    categories: ["games", "entertainment"],
    icons: [],
  };
}
