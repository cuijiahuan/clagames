import type { MetadataRoute } from "next";

// `output: 'export'` requires route handlers to opt into static rendering.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    // Next outputs /sitemap.xml — do not add trailing slash for the XML file.
    sitemap: "https://clagames.com/sitemap.xml",
  };
}
