// Corregirle el rumbo al Agente mientras trabaja, sin pararlo.
//
// POR QUÉ ES OTRA RUTA Y NO EL MISMO SSE. El stream de `/api/agent` va en una
// sola dirección (servidor→cliente): no hay por dónde meterle nada mientras
// corre. Así que la corrección entra por aquí y se encuentra con el bucle a
// través del almacén en proceso (`lib/agent/direcciones.ts`), que es quien la
// guarda hasta que el bucle mira entre vueltas.
//
// AUTORIZACIÓN: sesión + dueño DEL TURNO, no del proyecto. El id del turno
// viaja al cliente por el SSE, así que es un secreto compartido débil — quien
// lo tuviera podría escribir en la conversación de otro, y en este producto eso
// significa escribir en SU página. La comprobación vive en el almacén, que es
// por donde pasan todos los caminos, y aquí sólo se traduce a un código HTTP.
//
// 401 sin sesión · 404 si el turno no existe O no es tuyo — el mismo par que
// usan las demás rutas. Un 403 confirmaría que ese turno EXISTE, que ya es más
// de lo que un extraño debería poder averiguar probando ids.

import { auth } from "@/auth";
import { dirigir, MAX_DIRECCION } from "@/lib/agent/direcciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "no_autenticado" }, 401);

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "cuerpo_invalido" }, 400);
  }

  const { turnoId, texto } = (cuerpo ?? {}) as { turnoId?: unknown; texto?: unknown };
  if (typeof turnoId !== "string" || !turnoId) return json({ error: "falta_turno" }, 400);
  if (typeof texto !== "string") return json({ error: "falta_texto" }, 400);

  const r = dirigir(turnoId, userId, texto);
  if (r === "vacio") return json({ error: "texto_vacio" }, 400);
  // `ajeno` y `no_existe` responden LO MISMO a propósito: distinguirlos le diría
  // a quien prueba ids cuáles existen.
  if (r !== "ok") return json({ error: "turno_no_encontrado" }, 404);

  // El bucle la recogerá entre vueltas. No se espera a que lo haga: bloquear
  // aquí ataría la respuesta del taller a la velocidad del modelo.
  return json({ ok: true, maximo: MAX_DIRECCION });
}
