import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { ESFUERZOS, caparEsfuerzo, capacidadDeEsfuerzo } from "@/lib/agent/esfuerzo";
import { MODEL_POLICY } from "@/lib/generation/model-policy";
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
  // 🔴 LA ESCALERA LA DICE EL MODELO, no una constante. Claude Code lo resuelve
  // igual (`…` -> `…`) y su reserva para un modelo que no
  // conoce es `["low","medium","high"]`: `xhigh` y `max` se ganan.
  //
  // Este campo `niveles` ya existía y NO LO CONSUMÍA NADIE — el mando pintaba la
  // constante importada. Era la forma de [[la-palanca-que-no-vuelve-a-ningun-sitio]]
  // en su versión callada: no un interruptor sin destino, un dato sin lector.
  // Ahora es la única fuente, y por eso el mando deja de importar `NIVELES`.
  const capacidad = capacidadDeEsfuerzo(MODEL_POLICY.agent.modelId);
  return Response.json({
    // Se DEVUELVE recortado: si el papel cambió a un modelo con menos peldaños,
    // lo guardado puede ser un nivel que ya no se ofrece, y el mando pintaría
    // una selección que no está en su propia lista.
    esfuerzo: caparEsfuerzo(guardado ?? "auto", capacidad),
    niveles: capacidad.niveles,
    resuelveA: capacidad.defecto,
    // ⚰️ Aquí devolví `medido: capacidad.medido` y NO LO LEÍA NADIE. Es
    // exactamente el patrón que este mismo fichero acababa de cerrar con
    // `niveles` —un dato sin lector, [[la-palanca-que-no-vuelve-a-ningun-sitio]]
    // en su versión callada— y lo volví a abrir en el commit siguiente.
    //
    // La idea era que el taller pudiera decir «este modelo no está medido» en
    // vez de dejar que el usuario dedujera de una lista corta que su modelo es
    // peor. Sigue siendo buena idea, y sigue sin ocurrir: hoy el modelo del
    // papel SÍ está medido, así que la lista nunca sale corta. El día que haga
    // falta, entra CON su lector. `capacidadDeEsfuerzo().medido` lo sigue
    // diciendo para quien lo necesite.
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

  return Response.json({
    esfuerzo: parsed.data.esfuerzo,
    resuelveA: capacidadDeEsfuerzo(MODEL_POLICY.agent.modelId).defecto,
  });
}
