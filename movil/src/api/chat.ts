// Lo que el chat de la app le pide a OpenLen, por el cliente con la llave.
// El turno se lee con el mismo lector que la llamada (crearLectorSse).
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { crearLectorSse, type EventoSse } from "@/lib/len-bench/sse";
import { SinRed } from "./proyectos";

/** «cortado»: se fue la conexión a media respuesta — el turno sigue en el servidor y la app se vuelve a enganchar. */
export type FinDelTurno = "terminado" | "cortado" | "sinRed" | { status: number };

export async function mandarALen(
  c: ClienteDeOpenLen,
  cuerpo: { projectId: string; prompt: string; foto?: string },
  alEvento: (e: EventoSse) => void,
): Promise<FinDelTurno> {
  let res: Response;
  try {
    res = await c.pedir("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: cuerpo.projectId,
        prompt: cuerpo.prompt,
        zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(cuerpo.foto ? { attachedImage: { url: cuerpo.foto } } : {}),
      }),
    });
  } catch {
    return "sinRed";
  }
  if (!res.ok || !res.body) return { status: res.status };
  const lector = crearLectorSse();
  const dec = new TextDecoder();
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const e of lector.empujar(dec.decode(value, { stream: true }))) alEvento(e);
    }
  } catch {
    return "cortado";
  }
  for (const e of lector.empujar(dec.decode() + "\n\n")) alEvento(e);
  return "terminado";
}

/** Lo que escribes con Len trabajando le corrige el rumbo, sin pararlo. */
export async function dirigirA(c: ClienteDeOpenLen, turnoId: string, texto: string): Promise<boolean> {
  try {
    const r = await c.pedir("/api/agent/dirigir", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnoId, texto }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Sube la foto (ya achicada) y devuelve su dirección completa: la ruta puede
 *  contestar con una relativa, y Len la necesita entera. */
export async function subirFoto(c: ClienteDeOpenLen, base: string, foto: Blob): Promise<string> {
  const form = new FormData();
  form.append("file", foto, "foto.jpg");
  let r: Response;
  try {
    r = await c.pedir("/api/upload", { method: "POST", body: form });
  } catch {
    throw new SinRed();
  }
  if (!r.ok) throw new Error(`OpenLen respondió ${r.status}`);
  const j = (await r.json()) as { url: string };
  return new URL(j.url, base).href;
}

export type Transcripcion = { texto: string } | { error: "sinRed" | "tope" | "fallo" };

export async function transcribir(
  c: ClienteDeOpenLen,
  o: { audio: Blob; projectId: string; idioma: string; segundos: number },
): Promise<Transcripcion> {
  const form = new FormData();
  form.append("audio", o.audio, o.audio.type.includes("mp4") ? "nota.m4a" : "nota.webm");
  form.append("projectId", o.projectId);
  form.append("idioma", o.idioma);
  form.append("segundos", String(Math.round(o.segundos)));
  let r: Response;
  try {
    r = await c.pedir("/api/voz/nota", { method: "POST", body: form });
  } catch {
    return { error: "sinRed" };
  }
  if (r.status === 429) return { error: "tope" };
  if (!r.ok) return { error: "fallo" };
  const j = (await r.json().catch(() => null)) as { texto?: unknown } | null;
  return typeof j?.texto === "string" && j.texto.trim() ? { texto: j.texto.trim() } : { error: "fallo" };
}
