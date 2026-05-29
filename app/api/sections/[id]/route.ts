import { getSection, getSectionHtml } from "@/lib/sections/store";

// Single section: metadata + the raw scoped FRAGMENT html. The workspace
// fetches this when the user inserts a section, then posts the fragment into
// the live iframe (openlen:section-insert). The fragment is already host-safe
// (scoped at ingest) so it drops straight into the page.
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const s = await getSection(id);
  if (!s || s.status !== "published") {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const html = await getSectionHtml(id);
  if (html === null) {
    return new Response(JSON.stringify({ error: "html_unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      section: {
        id: s.id,
        type: s.type,
        name: s.name,
        variantLabel: s.variantLabel,
        mode: s.mode,
        rootTag: s.rootTag,
        needsJs: s.needsJs,
        hasPlaceholders: s.hasPlaceholders,
        fonts: s.fonts ?? [],
      },
      html,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
