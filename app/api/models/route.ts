import {
  listModels,
  MODEL_FAMILY_META,
  type ModelFamily,
} from "@/lib/models/store";

// Public list endpoint. Returns metadata for every published model + the
// family meta map so a client can render the picker without a second
// roundtrip. NO binary in this response — the 3D runtime fetches that
// directly from storageUrl.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const familyParam = url.searchParams.get("family");
  const family = isFamily(familyParam) ? familyParam : undefined;

  const rows = await listModels({ family });
  const body = JSON.stringify({
    models: rows.map(stripInternals),
    families: MODEL_FAMILY_META,
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Edge-cache the catalog: revalidate every 5 min on the CDN, serve
      // stale up to 1 hour while revalidating in the background.
      "Cache-Control":
        "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

function isFamily(v: string | null): v is ModelFamily {
  return (
    v === "product" ||
    v === "decorative" ||
    v === "prop" ||
    v === "character" ||
    v === "mechanical"
  );
}

function stripInternals(m: Awaited<ReturnType<typeof listModels>>[number]) {
  // Drop storageKey + size — internal-only. Keep storageUrl (the runtime
  // fetches the GLB directly) and preview images for the picker UI.
  return {
    id: m.id,
    name: m.name,
    family: m.family,
    author: m.author,
    pitch: m.pitch,
    description: m.description,
    storageUrl: m.storageUrl,
    contentHash: m.contentHash,
    sceneSpec: m.sceneSpec,
    tags: m.tags,
    license: m.license,
    thumbnailUrl: m.thumbnailUrl,
    tileUrl: m.tileUrl,
    featured: m.featured,
  };
}
