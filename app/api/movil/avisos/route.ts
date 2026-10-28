import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { llaveDeLaCabecera } from "@/lib/movil/secreto";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { avisosActivos, borrarAvisos, guardarAvisos } from "@/lib/movil/avisos";
import { fcmDisponible } from "@/lib/notifications/channels/fcm-transporte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function identidad(req: Request) {
  const llave = llaveDeLaCabecera(req.headers.get("authorization"));
  if (!llave) return null;
  const userId = await usuarioDeLaPeticion(req);
  return userId ? { userId, llave } : null;
}
export const GET = paraLaApp(async (req: Request) => {
  const i = await identidad(req);
  if (!i) return Response.json({ error: "sin_llave" }, { status: 401 });
  const disponible = fcmDisponible();
  return Response.json({ disponible, activa: disponible && await avisosActivos(i.userId, i.llave), recipientUserId: i.userId }, { headers: { "cache-control": "no-store" } });
});
export const POST = paraLaApp(async (req: Request) => {
  const i = await identidad(req);
  if (!i) return Response.json({ error: "sin_llave" }, { status: 401 });
  if (!fcmDisponible()) return Response.json({ error: "no_disponible" }, { status: 503 });
  const b = await req.json().catch(() => null) as { token?: unknown } | null;
  if (typeof b?.token !== "string" || !/^[A-Za-z0-9_:\-]{20,4096}$/.test(b.token)) return Response.json({ error: "datos" }, { status: 400 });
  try { await guardarAvisos(i.userId, i.llave, b.token); }
  catch (e) {
    if ((e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505") return Response.json({ error: "token_en_uso" }, { status: 409 });
    throw e;
  }
  return new Response(null, { status: 204 });
});
export const DELETE = paraLaApp(async (req: Request) => {
  const i = await identidad(req);
  if (!i) return Response.json({ error: "sin_llave" }, { status: 401 });
  await borrarAvisos(i.userId, i.llave);
  return new Response(null, { status: 204 });
});
export const OPTIONS = respuestaPrevia;
