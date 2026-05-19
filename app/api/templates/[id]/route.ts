import { getTemplate } from "@/lib/templates/store";

// Single-template metadata. Used by the detail page (/templates/[slug])
// when SSG generation needs to fetch one. HTML body is NOT included — the
// iframe loads it directly from storageUrl.
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const t = await getTemplate(id);
  if (!t || t.status !== "published") {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      id: t.id,
      name: t.name,
      family: t.family,
      accent: t.accent,
      pitch: t.pitch,
      description: t.description,
      mode: t.mode,
      storageUrl: t.storageUrl,
      contentHash: t.contentHash,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
