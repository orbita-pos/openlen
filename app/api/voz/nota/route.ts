// La nota de voz del chat de la app (pieza 2): entra el audio, sale el texto,
// y la app se lo manda a Len como si lo hubieras escrito. Mismas protecciones
// que /api/voz/sesion: el interruptor, la llave o la sesión, el dueño de la
// página, la clave de OpenAI y un tope diario. Los segundos sólo se apuntan;
// cobrarlos va antes de subir, junto con los de la llamada.
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { esDuenoDelProyecto } from "@/lib/voz/dueno";
import { transcribirNota } from "@/lib/voz/transcribir";
import { topeDeNotas } from "@/lib/voz/tope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ~2 min de opus a 32 kbps son ~0,5 MB: 3 MB deja margen sin abrir la puerta a
// cualquier cosa. (No se exporta: una ruta de Next sólo puede exportar sus
// métodos y su configuración.)
const MAX_BYTES_DE_NOTA = 3 * 1024 * 1024;
const modelo = () => process.env.OPENLEN_VOZ_NOTA_MODELO?.trim() || "gpt-4o-mini-transcribe";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  if (process.env.OPENLEN_VOZ?.trim() !== "1") return json({ error: "voz_apagada" }, 503);
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "no_autenticado" }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "cuerpo_invalido" }, 400);
  }
  const audio = form.get("audio");
  const projectId = String(form.get("projectId") ?? "").trim();
  const crudo = String(form.get("idioma") ?? "");
  const idioma = /^[a-z]{2}$/.test(crudo) ? crudo : "es";
  const segundos = Number(form.get("segundos"));
  if (!(audio instanceof Blob) || audio.size === 0 || !audio.type.startsWith("audio/") || !projectId) {
    return json({ error: "cuerpo_invalido" }, 400);
  }
  if (audio.size > MAX_BYTES_DE_NOTA) return json({ error: "nota_grande" }, 413);

  if (!(await esDuenoDelProyecto(projectId, userId))) return json({ error: "proyecto_no_encontrado" }, 404);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "sin_clave" }, 503);
  if (!topeDeNotas.intentar()) return json({ error: "tope_del_dia" }, 429);

  const r = await transcribirNota({ audio, idioma, modelo: modelo(), apiKey });
  if (!r.ok) {
    console.error(`[voz] nota no transcrita: ${r.status} ${r.motivo} usuario=${userId} proyecto=${projectId}`);
    return json({ error: "openai", status: r.status }, 502);
  }
  console.log(
    `[voz] nota usuario=${userId} proyecto=${projectId} idioma=${idioma} segundos=${Number.isFinite(segundos) ? Math.round(segundos) : "?"} bytes=${audio.size}`,
  );
  return json({ texto: r.texto });
});

export const OPTIONS = respuestaPrevia;
