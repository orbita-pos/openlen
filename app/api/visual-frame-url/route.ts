// WHERE THE CHAT LOADS LEN'S VISUALS FROM (local spec 2026-10-16-len-inline-visuals; spec local
// 2026-11-22-visuales-de-verdad, §1). `null` means there is no isolated host here: the chat then uses a `srcdoc` frame
// without `allow-same-origin`. Answers both the web session and the phone's key (with CORS).
import { visualFrameUrl } from "@/lib/lienzo/visuals-host";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = respuestaPrevia;

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    { url: visualFrameUrl({ hostDeLaPeticion: req.headers.get("host") }) },
    { headers: { "cache-control": "private, max-age=300" } },
  );
});
