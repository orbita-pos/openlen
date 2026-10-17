// WHERE THE CHAT LOADS LEN'S VISUALS FROM (local spec 2026-10-16-len-inline-visuals).
// `null` means there is no isolated host here: the chat then uses a `srcdoc`
// frame without `allow-same-origin`. No secret in it, so no session needed.
import { visualFrameUrl } from "@/lib/lienzo/visuals-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return Response.json(
    { url: visualFrameUrl({ hostDeLaPeticion: req.headers.get("host") }) },
    { headers: { "cache-control": "private, max-age=300" } },
  );
}
