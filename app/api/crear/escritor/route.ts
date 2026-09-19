import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { ESCRITORES_ELEGIBLES } from "@/lib/ai/provider-switch";
import { getEscritorGuardado } from "@/lib/ai/escritor-guardado";

// ─────────────────────────────────────────────────────────────────────────────
// EL ESCRITOR DE CREAR — la preferencia GUARDADA de la persona.
//
// Gemela de `app/api/agent/esfuerzo/route.ts`, y nace con lector Y escritor a
// la vez a propósito: aquella columna estuvo meses con lector y sin ninguna
// superficie por la que ponerla ([[la-palanca-que-no-vuelve-a-ningun-sitio]] en
// su versión callada). Aquí las dos puntas entran en el mismo cambio.
//
// LA FORMA ES LA DCLAUDE CODE. Su `ModelPicker` tiene dos alcances —`Enter` deja
// el modelo de defecto para las próximas sesiones, `s` lo usa sólo en ésta—. En
// una web no hay sesión a la que atar el escalón corto, así que queda el que sí
// existe, que es además el que su propio subtítulo anuncia: «Your pick becomes
// the default for new sessions».
//
// LO QUE NO HACE: no toca la generación en curso. El escritor efectivo lo
// resuelve `writerForTurn(hasImages, fijado)` dentro de `/api/generate`, para
// que cambiar la preferencia a mitad de una página no reescriba con qué modelo
// se escribió lo que ya salió.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "no autorizado" }, { status: 401 });
  }
  // `null` = nunca eligió. El selector lo pinta como «Automático», que es lo
  // que `writerForTurn` hará con él de todas formas.
  return Response.json({ escritor: await getEscritorGuardado(session.user.id) });
}

// Se valida contra el MISMO vocabulario que usa el turno. Dos listas que
// tuvieran que coincidir es exactamente cómo se desincronizan.
//
// 🔴 Y se valida un PAPEL, nunca un id de modelo: aquí es donde se nota que el
// selector eligiera papeles. Un id de modelo escrito por el cliente habría que
// cotejarlo contra un catálogo y emparejarlo con su tarifa a mano — que es la
// forma exacta de la que salieron las dos tarifas cableadas que
// `MODEL_POLICY` acaba de retirar.
const CuerpoSchema = z.object({
  escritor: z.union([z.enum(["reasoner", "visual_critic"]), z.null()]),
});

export async function PUT(req: Request) {
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
  const parsed = CuerpoSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: `escritor tiene que ser null o uno de: ${ESCRITORES_ELEGIBLES.join(", ")}` },
      { status: 400 },
    );
  }

  // «Automático» se guarda como NULL, no como la cadena "auto". Es lo mismo que
  // hace Claude Code al volver al defecto —«Cleared effort from settings»— y deja
  // la columna diciendo la verdad: NULL es «no eligió», que es precisamente lo
  // que significa automático. Guardar una cadena obligaría a
  // `escritor-guardado.ts` a tratar dos valores distintos como el mismo estado.
  await db
    .update(schema.users)
    .set({ crearWriter: parsed.data.escritor })
    .where(eq(schema.users.id, session.user.id));

  return Response.json({ escritor: parsed.data.escritor });
}
