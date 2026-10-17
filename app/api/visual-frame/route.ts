// THE FRAME OF LEN'S VISUALS (local spec 2026-10-16-len-inline-visuals, §4.3).
// Only on `lienzo-visuals.<lienzo domain>` (next.config rewrites every path of
// that host here); anywhere else it is a 404, so the frame never runs on the
// app's own origin. The document holds nothing of anyone's: no cookie is set,
// and the chat sends the code and the colors by postMessage.
import { frameAncestors } from "@/lib/lienzo/host";
import { isVisualsHost } from "@/lib/lienzo/prefijo";
import { visualFrameParentOrigins } from "@/lib/lienzo/visuals-host";
import { buildVisualFrameDocument, visualFrameCsp } from "@/lib/visuals/frame-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const host = req.headers.get("host");
  if (!isVisualsHost(host)) return new Response("Not found", { status: 404 });
  return new Response(buildVisualFrameDocument({ parentOrigins: visualFrameParentOrigins({ hostDeLaPeticion: host }), cspInMeta: false }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": visualFrameCsp(frameAncestors()),
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
