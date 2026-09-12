import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { ESFUERZOS, NIVELES, NIVEL_POR_DEFECTO } from "@/lib/agent/esfuerzo";
import { getEsfuerzoGuardado } from "@/lib/agent/esfuerzo-guardado";

// ─────────────────────────────────────────────────────────────────────────────
// EL ESFUERZO DE LEN — la preferencia GUARDADA de la persona.
//
// POR QUÉ EXISTE. `users.agentEffort` se creó con lector
// (`esfuerzo-guardado.ts`, que lo lee en cada turno) y SIN ESCRITOR: la columna
// llevaba desde su migración sin una sola superficie por la que un usuario
// pudiera ponerla. Es la misma forma que documentan
// [[la-palanca-que-no-vuelve-a-ningun-sitio]] y [[limpiador-sin-emisor]], y la
// razón por la que el propio plan que la creó dejó apuntado que el selector le
// debía un productor.
//
// LO QUE NO HACE: no toca el esfuerzo del turno en curso. Eso viaja en el
// cuerpo de `POST /api/agent` (el pin por turno de Claude Code), justamente para
// que cambiar la preferencia a mitad de un turno no reescriba con qué esfuerzo
// corrió lo que ya se mandó.
//
// El GET existe para que el taller pinte el mando con lo que hay guardado sin
// tener que adivinarlo, y devuelve además a qué nivel resuelve `auto` — que es
// lo que Claude Code enseña como `Effort level: auto (currently high)`.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "no autorizado" }, { status: 401 });
  }
  // `null` = nunca eligió. El cliente lo pinta como `auto`, que es lo que
  // `esfuerzoEfectivo` hará con él de todas formas.
  const guardado = await getEsfuerzoGuardado(session.user.id);
  return Response.json({
    esfuerzo: guardado ?? "auto",
    niveles: NIVELES,
    resuelveA: NIVEL_POR_DEFECTO,
  });
}

// Se valida contra el MISMO vocabulario que lee el turno. Dos listas que
// tuvieran que coincidir es exactamente cómo se desincronizan.
const CuerpoSchema = z.object({
  esfuerzo: z.enum(ESFUERZOS as readonly [string, ...string[]]),
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
      { error: `esfuerzo tiene que ser uno de: ${ESFUERZOS.join(", ")}` },
      { status: 400 },
    );
  }

  // `auto` se guarda como NULL, no como la cadena "auto". Es lo mismo que hace
  // Claude Code al volver a auto —«Cleared effort from settings»—, y deja la
  // columna diciendo la verdad: NULL es «no eligió», que es precisamente lo que
  // significa auto. Guardar la cadena obligaría a `esfuerzo-guardado.ts` a
  // tratar dos valores distintos como el mismo estado.
  const valor = parsed.data.esfuerzo === "auto" ? null : parsed.data.esfuerzo;
  await db
    .update(schema.users)
    .set({ agentEffort: valor })
    .where(eq(schema.users.id, session.user.id));

  return Response.json({ esfuerzo: parsed.data.esfuerzo, resuelveA: NIVEL_POR_DEFECTO });
}
