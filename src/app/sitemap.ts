import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";

// `output: 'export'` requires route handlers to opt into static rendering.
// This sitemap runs at build time (Node context), so `fs` usage below is safe.
export const dynamic = "force-static";

const BASE_URL = "https://clagames.com";

type SitemapEntry = MetadataRoute.Sitemap[number];

// next.config.ts has `trailingSlash: true`, so all page urls end with `/`.
const u = (p: string): SitemapEntry => ({
  url: `${BASE_URL}${p}/`,
  lastModified: new Date(),
});

/**
 * Scan `src/app/games/<slug>/page.tsx` at build time.
 * Adding a new game? Just create the folder + page.tsx — it will appear in
 * the sitemap automatically, no manual list to maintain.
 */
function readGameSlugs(): readonly string[] {
  const gamesDir = path.join(process.cwd(), "src", "app", "games");
  if (!existsSync(gamesDir)) return [];
  return readdirSync(gamesDir)
    .filter((name) => {
      const dirPath = path.join(gamesDir, name);
      const pagePath = path.join(dirPath, "page.tsx");
      return statSync(dirPath).isDirectory() && existsSync(pagePath);
    })
    .sort();
}

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: SitemapEntry[] = [
    {
      ...u(""),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const gamePages: SitemapEntry[] = readGameSlugs().map((slug) => ({
    ...u(`/games/${slug}`),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...gamePages];
}
