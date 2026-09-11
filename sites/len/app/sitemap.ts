import type { MetadataRoute } from "next";
import { LANGS } from "@/i18n";
import { SITE } from "@/lib/seo";
import { articulos } from "@/content/research";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const rutas = ["/", "/research/", "/principles/", ...articulos("en").map((a) => `/research/${a.meta.slug}/`)];
  return rutas.flatMap((r) =>
    LANGS.map((l) => ({
      url: `${SITE}/${l}${r}`,
      alternates: { languages: { en: `${SITE}/en${r}`, es: `${SITE}/es${r}` } },
    })),
  );
}
