// Abrir una sesión de GPT-Live desde NUESTRO servidor: la oferta WebRTC del
// navegador entra aquí y sale hacia OpenAI con nuestra clave, que nunca llega
// al teléfono. Delegación al cliente: lo que la voz necesite de la página nos lo
// pide a nosotros, y nosotros se lo pedimos a Len.
import { MODELO_DE_VOZ, type ConfigDeVoz } from "./voces";

export const URL_DE_SESIONES = "https://api.openai.com/v1/live/sessions";

export function cuerpoDeSesion(o: { sdp: string; config: ConfigDeVoz }): unknown {
  return {
    session: {
      model: MODELO_DE_VOZ,
      instructions: o.config.instrucciones,
      audio: { output: { voice: o.config.voz } },
      delegation: { type: "client" },
    },
    transport: { type: "webrtc", sdp: o.sdp },
  };
}

export type ResultadoDeSesion =
  | { ok: true; sdp: string; sesionId: string | null }
  | { ok: false; status: number; motivo: string };

export async function abrirSesionDeVoz(o: {
  sdp: string;
  config: ConfigDeVoz;
  apiKey: string;
  fetch?: typeof fetch;
}): Promise<ResultadoDeSesion> {
  const f = o.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(URL_DE_SESIONES, {
      method: "POST",
      headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(cuerpoDeSesion({ sdp: o.sdp, config: o.config })),
    });
  } catch (e) {
    return { ok: false, status: 0, motivo: e instanceof Error ? e.message : String(e) };
  }
  const j = (await r.json().catch(() => null)) as {
    session?: { id?: unknown };
    transport?: { sdp?: unknown };
    error?: { message?: unknown };
  } | null;
  if (!r.ok) {
    const motivo = typeof j?.error?.message === "string" ? j.error.message : `OpenAI respondió ${r.status}`;
    return { ok: false, status: r.status, motivo };
  }
  if (typeof j?.transport?.sdp !== "string") return { ok: false, status: r.status, motivo: "la respuesta no trae SDP" };
  return { ok: true, sdp: j.transport.sdp, sesionId: typeof j.session?.id === "string" ? j.session.id : null };
}
