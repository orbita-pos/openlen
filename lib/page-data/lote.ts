/**
 * UN LOTE DE ESCRITURAS DEL DUEÑO SOBRE UN ALMACÉN, DECIDIDO ENTERO ANTES DE
 * TOCAR NADA (H3 de Len 2.x: los almacenes como `/datos/<almacen>.json`).
 *
 * Un Edit del fichero puede traer a la vez cambios, altas y bajas. Se validan
 * TODOS —campos declarados, ids que existen, tamaño de cada fila— y la cuota se
 * mira UNA vez con el lote entero: un Edit que añade tres filas no puede
 * quedarse en dos porque la tercera no cabía, ni pasar porque cada fila, sola,
 * sí cabía.
 *
 * Puro: `aplicarPlanDeAlmacen` (agente.ts) lee de la base lo que esto necesita
 * y aplica lo que esto devuelve. Por eso se prueba sin base.
 */
import type { Plan } from "@/lib/limits";
import { bytesDe, cabe } from "./cuota";
import { validaDocumento, type AlmacenDeclarado } from "./declaracion";

export interface Lote {
  readonly cambios: readonly { readonly id: string; readonly doc: Record<string, unknown> }[];
  readonly altas: readonly Record<string, unknown>[];
  readonly bajas: readonly string[];
}

export type LoteDecidido =
  | {
      readonly ok: true;
      readonly cambios: { id: string; doc: Record<string, unknown> }[];
      readonly altas: Record<string, unknown>[];
      readonly bajas: string[];
    }
  | { readonly ok: false; readonly error: string };

export function decidirLote(args: {
  almacen: AlmacenDeclarado;
  plan: Plan;
  /** Los bytes que el proyecto ocupa HOY, con todas sus filas. */
  usados: number;
  /** Las filas del almacén que existen, por id. */
  existentes: ReadonlyMap<string, Record<string, unknown>>;
  lote: Lote;
}): LoteDecidido {
  const vistos = new Set<string>();
  let entrantes = 0;
  let salientes = 0;

  const altas: Record<string, unknown>[] = [];
  for (const doc of args.lote.altas) {
    const v = validaDocumento(args.almacen, doc);
    if (!v.ok) return { ok: false, error: v.razon };
    const r = cabe({ plan: args.plan, usados: 0, entrantes: bytesDe(v.doc) });
    if (!r.ok && r.razon === "documento_grande") return { ok: false, error: "documento_grande" };
    altas.push(v.doc);
    entrantes += bytesDe(v.doc);
  }

  const cambios: { id: string; doc: Record<string, unknown> }[] = [];
  for (const c of args.lote.cambios) {
    const previo = args.existentes.get(c.id);
    if (!previo) return { ok: false, error: "no_encontrado" };
    if (vistos.has(c.id)) return { ok: false, error: "id_repetido" };
    vistos.add(c.id);
    const v = validaDocumento(args.almacen, c.doc);
    if (!v.ok) return { ok: false, error: v.razon };
    const r = cabe({ plan: args.plan, usados: 0, entrantes: bytesDe(v.doc) });
    if (!r.ok && r.razon === "documento_grande") return { ok: false, error: "documento_grande" };
    cambios.push({ id: c.id, doc: v.doc });
    entrantes += bytesDe(v.doc);
    salientes += bytesDe(previo);
  }

  const bajas: string[] = [];
  for (const id of args.lote.bajas) {
    const previo = args.existentes.get(id);
    if (!previo) return { ok: false, error: "no_encontrado" };
    if (vistos.has(id)) return { ok: false, error: "id_repetido" };
    vistos.add(id);
    bajas.push(id);
    salientes += bytesDe(previo);
  }

  // La CUOTA, una vez y con el lote. Se le pasa el total ya sumado en `usados`
  // y `entrantes: 0`, porque `cabe` compararía `entrantes` contra el máximo de
  // UN documento.
  const veredicto = cabe({ plan: args.plan, usados: args.usados - salientes + entrantes, entrantes: 0 });
  if (!veredicto.ok) return { ok: false, error: veredicto.razon };
  return { ok: true, cambios, altas, bajas };
}
