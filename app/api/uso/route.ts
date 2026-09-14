import { auth } from "@/auth";
import { validarEventoDeCliente } from "@/lib/uso/catalogo";
import { guardarEventos, puedeRegistrar, type FilaDeUso } from "@/lib/uso/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uso — los eventos de uso que manda el navegador (lib/uso/cliente.ts).
//
// Contesta SIEMPRE 204, como la baliza de `/c`: es telemetría, no una API, y un
// error visible no le sirve a la persona para nada.
//
//  - El usuario sale de la SESIÓN, nunca del cuerpo.
//  - Sólo pasa lo que el catálogo deja pasar, evento a evento.
//  - Respeta `DNT: 1` y `Sec-GPC: 1`.
//  - Sólo del MISMO origen. Las páginas publicadas en `*.openlen.com` son
//    same-site con la app, así que el navegador les adjuntaría la cookie de
//    sesión: sin esta guarda, el JavaScript de cualquier página publicada podría
//    escribir eventos a nombre de quien la visita.
// ─────────────────────────────────────────────────────────────────────────────

/** El tope por petición. El cliente parte sus lotes con el mismo número. */
const MAX_POR_LOTE = 20;

const nada = () => new Response(null, { status: 204 });

export async function POST(req: Request): Promise<Response> {
  if (!puedeRegistrar(req.headers)) return nada();
  const sitio = req.headers.get("sec-fetch-site");
  if (sitio !== null && sitio !== "same-origin") return nada();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return nada();

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return nada();
  }
  const eventos = (cuerpo as { eventos?: unknown } | null)?.eventos;
  if (!Array.isArray(eventos)) return nada();

  const filas: FilaDeUso[] = [];
  for (const crudo of eventos.slice(0, MAX_POR_LOTE)) {
    const evento = validarEventoDeCliente(crudo);
    if (evento) filas.push({ userId, ...evento });
  }
  await guardarEventos(filas);
  return nada();
}
