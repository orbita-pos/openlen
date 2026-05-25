import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// AI training bots we explicitly opt out of. Curated from
// https://github.com/ai-robots-txt/ai.robots.txt as of 2026-05.
// Add new entries here when new high-traffic AI crawlers emerge —
// they're stable enough that a quarterly review is more than
// sufficient (most major ones have been on the list since 2023).
const AI_BOTS_DISALLOW = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "PerplexityBot",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Omgili",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default rule for all well-behaved crawlers (Googlebot, Bingbot,
      // etc.). Marketing surfaces stay indexable; authed routes + API
      // are explicitly off-limits.
      {
        userAgent: "*",
        allow: ["/", "/templates", "/templates/curated/"],
        disallow: [
          "/api/",
          "/new-v2",
          "/projects",
          "/login",
          "/signup",
          "/auth/",
        ],
      },
      // Block AI training crawlers entirely. Used to be CF-managed
      // (Scrape Shield → Manage robots.txt), moved into code so the
      // policy lives in the repo and survives infra changes.
      ...AI_BOTS_DISALLOW.map((bot) => ({
        userAgent: bot,
        disallow: ["/"],
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
