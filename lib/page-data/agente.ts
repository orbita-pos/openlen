// Lo que el Agente hace sobre un almacén. Sin HTTP, sin sesión, sin cookies.
//
// POR QUÉ NO SE LLAMA A store.ts DIRECTAMENTE DESDE tools.ts: el Agente escribe
// SIEMPRE como dueño (`alcance: "todos"`, `visitorId: null`) y la cuota se le
// aplica igual que a un visitante. Esas dos reglas metidas en `tools.ts` —que ya
// pasa de 2.000 líneas— es exactamente donde se pierden. Aquí caben en cien y se
// prueban solas.
//
// EL PLAN SALE DE LA BASE, no de quien llama. `AgentSession` no lo lleva
// (lib/agent/tools.ts:399 — es projectId, userId, taggedHtml, page…), así que si
// cada llamador tuviera que pasarlo, tarde o temprano alguien pondría `"free"`
// por defecto: eso le corta la cuota a un usuario Pro a la décima parte, y el
// síntoma que ve es «no me deja guardar», sin nada que lo explique.

import "server-only";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Plan } from "@/lib/limits";
import { validaDocumento } from "./declaracion";
import { declaracionPublicada } from "./publicada";
import { bytesDe, cabe } from "./cuota";
import { borrar, bytesUsados, escribir, listar } from "./store";

export type ResultadoAgente =
  | { ok: true; mensaje: string }
  | { ok: false; error: string };

/** El plan del dueño, o `null` si el usuario no existe. `null` no se degrada a
 *  `free`: un usuario que no existe no debe poder escribir. */
async function planDe(userId: string): Promise<Plan | null> {
  const [fila] = await db
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!fila) return null;
  return fila.plan === "pro" ? "pro" : "free";
}

async function almacenDe(projectId: string, nombre: string) {
  const declaracion = await declaracionPublicada(projectId);
  return declaracion[nombre] ?? null;
}

export async function leerDatos(args: {
  projectId: string;
  almacen: string;
}): Promise<{ id: string; doc: Record<string, unknown> }[]> {
  const filas = await listar({
    projectId: args.projectId,
    store: args.almacen,
    alcance: "todos",
    visitorId: null,
  });
  return filas.map((f) => ({ id: f.id, doc: f.doc }));
}

export async function agregarDato(args: {
  projectId: string;
  userId: string;
  almacen: string;
  doc: Record<string, unknown>;
}): Promise<ResultadoAgente> {
  const plan = await planDe(args.userId);
  if (!plan) return { ok: false, error: "no_autorizado" };

  const almacen = await almacenDe(args.projectId, args.almacen);
  // NO se crea al vuelo: la declaración vive en el documento, y el Agente la
  // escribe EDITANDO la página, no por la puerta de atrás. Si pudiera crear
  // almacenes aquí habría dos fuentes de verdad y la del HTML dejaría de
  // mandar — que es toda la arquitectura.
  if (!almacen) return { ok: false, error: "almacen_no_declarado" };

  const validado = validaDocumento(almacen, args.doc);
  if (!validado.ok) return { ok: false, error: validado.razon };

  const veredicto = cabe({
    plan,
    usados: await bytesUsados(args.projectId),
    entrantes: bytesDe(validado.doc),
  });
  if (!veredicto.ok) return { ok: false, error: veredicto.razon };

  await escribir({
    projectId: args.projectId,
    store: args.almacen,
    visitorId: null,
    doc: validado.doc,
    caducaDias: almacen.caducaDias,
  });
  return { ok: true, mensaje: `Añadido a «${args.almacen}».` };
}

export async function editarDato(args: {
  projectId: string;
  userId: string;
  almacen: string;
  id: string;
  doc: Record<string, unknown>;
}): Promise<ResultadoAgente> {
  const plan = await planDe(args.userId);
  if (!plan) return { ok: false, error: "no_autorizado" };

  const almacen = await almacenDe(args.projectId, args.almacen);
  if (!almacen) return { ok: false, error: "almacen_no_declarado" };

  const existentes = await leerDatos({ projectId: args.projectId, almacen: args.almacen });
  const previo = existentes.find((f) => f.id === args.id);
  // Editar un id que no existe NO inserta: el Agente creería estar corrigiendo
  // y acabaría duplicando en silencio.
  if (!previo) return { ok: false, error: "no_encontrado" };

  const validado = validaDocumento(almacen, args.doc);
  if (!validado.ok) return { ok: false, error: validado.razon };

  const veredicto = cabe({
    plan,
    usados: await bytesUsados(args.projectId),
    entrantes: bytesDe(validado.doc),
    salientes: bytesDe(previo.doc),
  });
  if (!veredicto.ok) return { ok: false, error: veredicto.razon };

  await escribir({
    projectId: args.projectId,
    store: args.almacen,
    visitorId: null,
    doc: validado.doc,
    caducaDias: almacen.caducaDias,
    reemplazaId: args.id,
  });
  return { ok: true, mensaje: `Actualizado en «${args.almacen}».` };
}

export async function quitarDato(args: {
  projectId: string;
  almacen: string;
  id: string;
}): Promise<ResultadoAgente> {
  const hecho = await borrar({
    projectId: args.projectId,
    store: args.almacen,
    id: args.id,
    alcance: "todos",
    visitorId: null,
  });
  return hecho
    ? { ok: true, mensaje: `Quitado de «${args.almacen}».` }
    : { ok: false, error: "no_encontrado" };
}
