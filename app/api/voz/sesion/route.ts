// Abrir una llamada con Len (docs/superpowers/specs/2026-09-30-len-voz-design.md).
//
// El orden es el de los costes: primero lo gratis (interruptor, sesión, cuerpo,
// dueño) y el tope y OpenAI al final, para que un proyecto ajeno o un cuerpo
// roto no gasten ni una llamada del tope.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { esDuenoDelProyecto } from "@/lib/voz/dueno";
import { abrirSesionDeVoz } from "@/lib/voz/sesion";
import { topeDeLlamadas } from "@/lib/voz/tope";
import { vozParaIdioma } from "@/lib/voz/voces";
import { SESSION_OPEN_SECONDS, voiceCenticredits, watchVoiceCall } from "@/lib/voz/billing";
import { debitCredits, getCreditState } from "@/lib/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  // ENCENDIDA POR DEFECTO desde el 2026-10-03 (Jesús: «todo tiene que estar
  // encendido»): OPT-OUT, como los kill-switches; sólo el literal "0" la apaga.
  if (process.env.OPENLEN_VOZ?.trim() === "0") return json({ error: "voz_apagada" }, 503);
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  const b = (await req.json().catch(() => null)) as { projectId?: unknown; sdp?: unknown; idioma?: unknown } | null;
  const projectId = typeof b?.projectId === "string" ? b.projectId.trim() : "";
  const sdp = typeof b?.sdp === "string" ? b.sdp : "";
  const idioma = typeof b?.idioma === "string" && /^[a-z]{2}$/.test(b.idioma) ? b.idioma : "es";
  if (!projectId || !sdp || sdp.length > 20_000) return json({ error: "cuerpo_invalido" }, 400);

  if (!(await esDuenoDelProyecto(projectId, userId))) return json({ error: "proyecto_no_encontrado" }, 404);
  // LA VOZ SE COBRA (Jesús, 03/10: 5 créditos por minuto). Para abrirla hace falta
  // al menos lo que OpenAI cobra al abrir; a media llamada la cuelga el servidor
  // si el saldo se acaba (`lib/voz/billing.ts`).
  const { balance } = await getCreditState(userId);
  if (balance < voiceCenticredits(SESSION_OPEN_SECONDS)) return json({ error: "sin_creditos" }, 402);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "sin_clave" }, 503);
  if (!topeDeLlamadas.intentar()) return json({ error: "tope_del_dia" }, 429);

  const config = vozParaIdioma(idioma, { vozIngles: process.env.OPENLEN_VOZ_INGLES });
  const r = await abrirSesionDeVoz({ sdp, config, apiKey });
  if (!r.ok) {
    console.error(`[voz] no se abrió: ${r.status} ${r.motivo} usuario=${userId} proyecto=${projectId}`);
    return json({ error: "openai", status: r.status }, 502);
  }
  console.log(`[voz] abierta ${r.sesionId ?? "?"} usuario=${userId} proyecto=${projectId} idioma=${idioma} voz=${config.voz}`);
  // El servidor se engancha a ESA sesión y la cobra con los segundos que le dice
  // OpenAI; no se espera: vive lo que dure la llamada, fuera de esta petición.
  if (r.sesionId) {
    watchVoiceCall({
      sessionId: r.sesionId,
      apiKey,
      userId,
      charge: debitCredits,
      balance: async (u) => (await getCreditState(u)).balance,
    });
  } else {
    console.error(`[voz] OpenAI no dio id de sesión: la llamada de usuario=${userId} no se puede cobrar`);
  }
  return json({ sdp: r.sdp, sesionId: r.sesionId, saludo: config.saludo });
});

export const OPTIONS = respuestaPrevia;
