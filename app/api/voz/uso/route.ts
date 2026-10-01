// Los segundos de cada llamada, como los cuenta OpenAI (`usage.seconds`). En dev
// sólo se apuntan; cobrarlos en créditos va antes de subir, y leyéndolos desde el
// SERVIDOR: lo que manda el teléfono se puede falsear.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return new Response(null, { status: 401 });
  const b = (await req.json().catch(() => null)) as { sesionId?: unknown; segundos?: unknown; motivo?: unknown } | null;
  const sesionId = typeof b?.sesionId === "string" ? b.sesionId.slice(0, 100) : "?";
  const segundos = typeof b?.segundos === "number" && Number.isFinite(b.segundos) ? Math.round(b.segundos) : null;
  const motivo = typeof b?.motivo === "string" ? b.motivo.slice(0, 40) : "?";
  console.log(`[voz] cerrada ${sesionId} usuario=${userId} segundos=${segundos ?? "?"} motivo=${motivo}`);
  return new Response(null, { status: 204 });
});

export const OPTIONS = respuestaPrevia;
