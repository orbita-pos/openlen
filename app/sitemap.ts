import type { MetadataRoute } from "next";
import { TEMPLATES } from "@/components/templates/_registry";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/templates`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
  ];

  const templateRoutes: MetadataRoute.Sitemap = TEMPLATES.map((t) => ({
    url: `${SITE_URL}/templates/${t.id}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticRoutes, ...templateRoutes];
}
