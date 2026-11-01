import { readDeliveredFile } from "@/lib/agent/skills/delivered-request";
import { contentTypeOf } from "@/lib/agent/skills/present";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";

// GET /api/projects/<id>/deliveries/<turn>/<file> — a file Len delivered with `present` (spec local
// 2026-10-26-len-skills, §4.9), to whoever can SEE the project; the chat's card links here
// (`deliverableLocation`). Always a download, never rendered on this origin: a delivered .html or .svg
// would otherwise run with the session of whoever opens it (`…/view` opens those on the canvas host).
// The phone fetches it with its key (spec local 2026-10-31-len-movil, §5.1): `readDeliveredFile` reads
// the person with `usuarioDeLaPeticion(req)`.
export const GET = paraLaApp(async (req: Request, ctx: { params: Promise<{ id: string; turn: string; file: string }> }): Promise<Response> => {
  const read = await readDeliveredFile(req, await ctx.params);
  if (read instanceof Response) return read;
  const { name, bytes } = read;
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentTypeOf(name),
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export const OPTIONS = respuestaPrevia;
