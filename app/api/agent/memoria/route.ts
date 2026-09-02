import { z } from "zod";
import { auth } from "@/auth";
import { MEMORY_MARKER_LINE, getUserMemory, forgetAboutUser } from "@/lib/agent/user-memory";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// LA MEMORIA DE LA PERSONA — vista y borrado por su DUEÑO.
//
// POR QUÉ EXISTE. `recordar_preferencia` guarda por defecto con
// alcance="siempre", que escribe en `users.agentMemory` y acompaña al usuario a
// TODOS sus proyectos: se le inyecta en cada turno como «LO QUE SABES DE ESTA
// PERSONA … Respétalo sin que te lo repita».
//
// Hasta hoy esa memoria no tenía NINGUNA superficie: ni ruta, ni componente.
// `forgetAboutUser` existía desde el principio con este comentario —«una memoria
// a la que sólo se puede AÑADIR es una trampa … el borrado es del dueño»— y
// **no tenía un solo llamador en todo el repo**. La primera frase era exacta; la
// segunda, falsa: el dueño tampoco tenía por dónde. Se escribió la salida de
// emergencia y no se le puso puerta.
//
// Y NINGUNO DE LOS DOS ALCANCES TENÍA VISOR, que fue la sorpresa: el prompt
// manda al usuario a «la pestaña Brief» para podar el alcance LOCAL
// (`projects.userBrief`), y esa pestaña tampoco existe —
// `panels/brief-panel.tsx` y `panels/ai-brief-panel.tsx` tienen CERO
// importadores—. Esto cierra el alcance GLOBAL, que es el que el modelo elige
// por omisión y el que cruza todos los proyectos. El local queda pendiente.
//
// Auditoría de inyección del 2026-09-01: esto es además lo que convierte una
// escritura inducida por el texto de una página en un daño PERMANENTE. Aunque
// el modelo hoy no muerde el anzuelo (0/3 medido), una memoria sin visor es un
// sitio del que nada sale.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** De documento a líneas: se quita el encabezado y la viñeta, que son formato y
 *  no contenido. `forgetAboutUser` espera el texto SIN viñeta, así que lo que
 *  sale de aquí es exactamente lo que vuelve por el DELETE. */
function lineasDe(memoria: string | null): string[] {
  if (!memoria) return [];
  return memoria
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "no autorizado" }, { status: 401 });
  }
  const memoria = await getUserMemory(session.user.id);
  return Response.json({ lineas: lineasDe(memoria), marcador: MEMORY_MARKER_LINE });
}

const BorradoSchema = z.union([
  z.object({ preferencia: z.string().min(1).max(400) }),
  z.object({ todo: z.literal(true) }),
]);

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "no autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  const parsed = BorradoSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "pasa { preferencia } para quitar una, o { todo: true } para vaciarla" },
      { status: 400 },
    );
  }

  // VACIAR ENTERA. Se pone a null, no a "": `getUserMemory` ya trata el vacío
  // como ausencia, y null es lo que dice «nunca hubo nada» sin depender de que
  // alguien recuerde recortar espacios.
  if ("todo" in parsed.data) {
    await db
      .update(schema.users)
      .set({ agentMemory: null })
      .where(eq(schema.users.id, session.user.id));
    return Response.json({ ok: true, lineas: [] });
  }

  const quitada = await forgetAboutUser(session.user.id, parsed.data.preferencia);
  // `false` no es un error: la línea ya no estaba (dos pestañas, dos borrados).
  // El cliente pinta el estado que vuelve, así que converge igual.
  const memoria = await getUserMemory(session.user.id);
  return Response.json({ ok: true, quitada, lineas: lineasDe(memoria) });
}
