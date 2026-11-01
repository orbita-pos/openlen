// POST /api/projects/<id>/deliveries/<turn>/<file>/view — open a delivered HTML or SVG to look at it
// (spec local 2026-10-31-len-movil, §5.1) → { url } on the canvas host, a `.app` origin of the project's
// own, never this one: there its JavaScript runs whole without the session of whoever opens it. Same
// access as the download (whoever can SEE the project), from the web or the phone. Anything else is
// 400 `not_html`: it is downloaded from the route above. The person: `usuarioDeLaPeticion(req)`, inside
// `readDeliveredFile`.
import { readDeliveredFile } from "@/lib/agent/skills/delivered-request";
import { lienzoApagado } from "@/lib/lienzo/host";
import { openDeliveredHtml } from "@/lib/lienzo/open-delivered";
import { ORIGENES_DE_LA_APP, paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";

export const POST = paraLaApp(async (req: Request, ctx: { params: Promise<{ id: string; turn: string; file: string }> }): Promise<Response> => {
  const params = await ctx.params;
  const read = await readDeliveredFile(req, params);
  if (read instanceof Response) return read;
  const ext = /\.([A-Za-z0-9]+)$/.exec(read.name)?.[1]?.toLowerCase();
  if (ext !== "html" && ext !== "htm" && ext !== "svg") return Response.json({ error: "not_html" }, { status: 400 });
  if (lienzoApagado()) return Response.json({ error: "sin_host" }, { status: 503 });
  const opened = openDeliveredHtml({
    projectId: params.id,
    personId: read.userId,
    html: new TextDecoder().decode(read.bytes),
    svg: ext === "svg",
    requestHost: req.headers.get("host"),
    framedBy: ORIGENES_DE_LA_APP,
  });
  return opened.ok ? Response.json({ url: opened.url }, { headers: { "cache-control": "no-store" } }) : Response.json({ error: opened.error }, { status: opened.status });
});

export const OPTIONS = respuestaPrevia;
