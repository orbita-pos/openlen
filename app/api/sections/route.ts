import { listSections } from "@/lib/sections/store";
import { SECTION_TYPE_META } from "@/lib/sections/types";

// Public list endpoint for the section library gallery. Returns metadata for
// every published section + the type-meta map so the client can group without
// a second roundtrip. NO HTML here — the preview iframe pulls a wrapped doc
// from /api/sections/[id]/preview, and insert fetches the fragment from
// /api/sections/[id].
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");

  const rows = await listSections();
  const sections = rows
    .filter((s) => !typeParam || s.type === typeParam)
    .map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
      variantLabel: s.variantLabel,
      mode: s.mode,
      rootTag: s.rootTag,
      needsJs: s.needsJs,
      hasPlaceholders: s.hasPlaceholders,
    }));

  return new Response(
    JSON.stringify({ sections, types: SECTION_TYPE_META }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
