import {
  listTemplates,
  TEMPLATE_FAMILY_META,
  type TemplateFamily,
} from "@/lib/templates/store";

// Public list endpoint. Returns metadata for every published template +
// the family meta map so a client can render the gallery without a second
// roundtrip. NO HTML in this response — the iframe pulls that directly
// from storageUrl.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const familyParam = url.searchParams.get("family");
  const family = isFamily(familyParam) ? familyParam : undefined;

  const rows = await listTemplates({ family });
  const body = JSON.stringify({
    templates: rows.map(stripInternals),
    families: TEMPLATE_FAMILY_META,
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Edge-cache the gallery: revalidate every 5 min on the CDN, serve
      // stale up to 1 hour while revalidating in the background.
      "Cache-Control":
        "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

function isFamily(v: string | null): v is TemplateFamily {
  return v === "technical-minimal" || v === "editorial" || v === "commerce";
}

function stripInternals(t: Awaited<ReturnType<typeof listTemplates>>[number]) {
  // Drop storageKey + size — internal-only. Keep storageUrl (the iframe
  // fallback needs it) and the preview images so the workspace picker can
  // render a static <img> facade instead of booting a live iframe per card.
  return {
    id: t.id,
    name: t.name,
    family: t.family,
    accent: t.accent,
    pitch: t.pitch,
    description: t.description,
    mode: t.mode,
    storageUrl: t.storageUrl,
    contentHash: t.contentHash,
    thumbnailUrl: t.thumbnailUrl,
    tileUrl: t.tileUrl,
  };
}
