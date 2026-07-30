import { getSection, getSectionHtml } from "@/lib/sections/store";
import { EMBED_SANDBOX_CSP } from "@/lib/publish/embed-sandbox";

// Renderable preview doc for a section. The stored fragment is just
// <link> + scoped <style> + the section element — it has no <html>/<head> and
// no Tailwind runtime, so it can't render on its own. We wrap it in a minimal
// host document with the Tailwind CDN (the same runtime the host pages use) so
// the gallery's <iframe src> shows the real section. Reused by
// TemplatePreviewFrame.
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const s = await getSection(id);
  if (!s || s.status !== "published") {
    return new Response("not found", { status: 404 });
  }
  const fragment = await getSectionHtml(id);
  if (fragment === null) {
    return new Response("preview unavailable", { status: 502 });
  }

  const bg = s.mode === "dark" ? "#0b0b0f" : s.mode === "cream" ? "#f6f3ec" : "#ffffff";
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script><style>html,body{margin:0}body{background:${bg}}</style></head><body>${fragment}</body></html>`;

  return new Response(doc, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      // Incondicional, a diferencia de /raw: esto solo existe para verse
      // incrustado (nunca es una página navegable del producto) y encima es
      // PÚBLICO sin auth. Origen opaco: el fragmento se sirve desde nuestro
      // origen y no pasa por sanitizeForPublish — se siembra por CLI, así que
      // esta es su única línea de defensa. Ver lib/publish/embed-sandbox.ts.
      "Content-Security-Policy": EMBED_SANDBOX_CSP,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
