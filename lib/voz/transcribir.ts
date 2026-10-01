// La nota de voz del chat de la app → texto, con la API de transcripción de
// OpenAI. Como `abrirSesionDeVoz`: el fetch se inyecta (las pruebas no tocan
// la red) y un fallo vuelve como dato, no como excepción.
export const URL_DE_TRANSCRIPCION = "https://api.openai.com/v1/audio/transcriptions";

export type ResultadoDeTranscripcion = { ok: true; texto: string } | { ok: false; status: number; motivo: string };

export async function transcribirNota(o: {
  audio: Blob;
  idioma: string;
  modelo: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Promise<ResultadoDeTranscripcion> {
  const f = o.fetch ?? fetch;
  const cuerpo = new FormData();
  // El nombre lleva la extensión: OpenAI decide el formato por ella.
  cuerpo.append("file", o.audio, o.audio.type.includes("mp4") ? "nota.m4a" : "nota.webm");
  cuerpo.append("model", o.modelo);
  cuerpo.append("language", o.idioma);
  cuerpo.append("response_format", "json");
  let r: Response;
  try {
    r = await f(URL_DE_TRANSCRIPCION, { method: "POST", headers: { authorization: `Bearer ${o.apiKey}` }, body: cuerpo });
  } catch (e) {
    return { ok: false, status: 0, motivo: e instanceof Error ? e.message : String(e) };
  }
  const j = (await r.json().catch(() => null)) as { text?: unknown; error?: { message?: unknown } } | null;
  if (!r.ok) {
    return { ok: false, status: r.status, motivo: typeof j?.error?.message === "string" ? j.error.message : `OpenAI respondió ${r.status}` };
  }
  if (typeof j?.text !== "string") return { ok: false, status: r.status, motivo: "la respuesta no trae texto" };
  return { ok: true, texto: j.text.trim() };
}
