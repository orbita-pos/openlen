import type { MetadataRoute } from "next";
import { listTemplates } from "@/lib/templates/store";
import { routing } from "@/i18n/routing";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// hreflang alternates for a locale-agnostic path ("" = homepage, "/templates",
// "/templates/<slug>"). next-intl is configured with localePrefix: "always",
// so every public URL is prefixed (/en/…, /es/…).
function languageAlternates(path: string) {
  return {
    languages: Object.fromEntries(
      routing.locales.map((locale) => [locale, `${SITE_URL}/${locale}${path}`]),
    ),
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPaths = [
    { path: "", changeFrequency: "weekly" as const, priority: 1.0 },
    { path: "/templates", changeFrequency: "weekly" as const, priority: 0.9 },
  ];

  const templates = await listTemplates();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of routing.locales) {
    for (const s of staticPaths) {
      entries.push({
        url: `${SITE_URL}/${locale}${s.path}`,
        lastModified: now,
        changeFrequency: s.changeFrequency,
        priority: s.priority,
        alternates: languageAlternates(s.path),
      });
    }
    for (const tpl of templates) {
      entries.push({
        url: `${SITE_URL}/${locale}/templates/${tpl.id}`,
        lastModified: tpl.updatedAt,
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: languageAlternates(`/templates/${tpl.id}`),
      });
    }
  }

  return entries;
}
