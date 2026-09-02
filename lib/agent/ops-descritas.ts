// LAS OPS DEL TURNO, CONTADAS EN CRISTIANO — lo que de verdad se cambió.
//
// POR QUÉ EXISTE, y en qué se diferencia del diff del panel. El Chat ya lista
// qué secciones cambió un turno comparando el HTML de antes con el de después
// (`lib/workspace-v2/diff-de-turno.ts`), y ese diff ADIVINA: renombrar una
// sección le sale como una quitada más una añadida, y sobre todo **no ve nada
// que no viva en `<body>`** — un cambio de CSS, del `<title>` o del
// comportamiento son invisibles para él.
//
// Las ops sí lo saben, porque son la instrucción literal que se ejecutó. Lo que
// pasaba es que morían dentro de `editar_pagina`: `applyOps` devuelve cuántas se
// aplicaron y nada más, y `ToolOutcome` no tenía dónde ponerlas.
//
// 🔴 LA TRAMPA, y es la que define todo el diseño: el `target` de una op es un
// `data-op-id`, y los op-id se ESTRIPAN antes de guardar y se regeneran en cada
// turno. O sea que un op-id **no direcciona nada en cuanto el turno termina**.
// Persistirlo tal cual sería guardar la llave de una cerradura que ya cambió.
//
// Por eso esto resuelve la op MIENTRAS el documento etiquetado sigue en la mano:
// del op-id se saca su SECCIÓN de primer nivel, de ella una etiqueta legible, y
// de la etiqueta su posición en el documento de DESPUÉS — que es lo que el
// lienzo puede señalar. Lo que se guarda ya no caduca.
//
// PURO A PROPÓSITO: los dos ayudantes nativos entran inyectados, así que su
// prueba corre bajo vitest sin cargar el binding de Rust. Es el mismo invariante
// que mantiene `lib/agent/context.ts`.

import type { Op } from "@/lib/html-ops";

/** Dónde cayó la edición. Las tres últimas son las que el diff de HTML no puede
 *  ver: viven fuera de `<body>` o fuera del documento. */
export type DondeCayo = "documento" | "estilos" | "cabecera" | "comportamiento";

export interface OpDescrita {
  readonly tipo: Op["type"];
  readonly donde: DondeCayo;
  /** El nombre legible de la sección tocada. Vacío cuando la edición no cayó en
   *  el documento —ahí el que pinta usa `donde`— o cuando no se pudo resolver. */
  readonly etiqueta: string;
  /** Posición entre las secciones de primer nivel del documento de DESPUÉS, para
   *  que el lienzo pueda desplazarse hasta ella. `-1` cuando no hay a dónde ir:
   *  un `delete`, o una sección que ya no se encuentra. */
  readonly indice: number;
}

interface LineaDeOutline {
  readonly opId: string;
  readonly etiqueta: string;
}

/**
 * Del outline a filas. El formato lo fija `ScopedView.outline` en
 * `lib/html-ops.ts` —`- [opId] <tag> "encabezado"`— y esto es su único lector.
 * COMPROBADO contra el motor real, no contra el comentario: sobre
 * `templates/starter/taller.html` salen líneas como `- [3] <header> "TALLER…"`.
 */
export function parseOutline(outline: string | null | undefined): LineaDeOutline[] {
  if (!outline) return [];
  const filas: LineaDeOutline[] = [];
  for (const linea of outline.split("\n")) {
    const m = /^\s*-\s*\[([^\]]+)\]\s*(?:<([^>]+)>)?\s*(?:"([^"]*)")?/.exec(linea);
    if (!m) continue;
    const [, opId, tag, encabezado] = m;
    const etiqueta = (encabezado ?? "").trim() || (tag ?? "").trim();
    filas.push({ opId, etiqueta });
  }
  return filas;
}

const DONDE_POR_TARGET: Readonly<Record<string, DondeCayo>> = {
  styles: "estilos",
  head: "cabecera",
  runtime: "comportamiento",
};

export interface DescribirArgs {
  readonly ops: readonly Op[];
  /** El documento etiquetado contra el que se aplicaron las ops. */
  readonly antesTagged: string;
  /** El documento etiquetado DESPUÉS de aplicarlas y guardarlas. */
  readonly despuesTagged: string;
  /** `buildOutline(tagged)` — nativo, inyectado. */
  readonly outlineDe: (tagged: string) => string | null;
  /** `buildScopedView(tagged, opId).scopedHtml` — nativo, inyectado. Devuelve la
   *  sección entera, con los op-id de sus descendientes dentro. */
  readonly seccionDe: (tagged: string, opId: string) => string | null;
}

/**
 * De cada op-id del documento a la SECCIÓN de primer nivel que lo contiene.
 *
 * 🔴 SE HACE EN UNA PASADA POR SECCIÓN, no una por op, y no con
 * `containerOpId`. Medido sobre una plantilla real: `containerOpId` devuelve el
 * contenedor SEMÁNTICO, que el 8% de las veces NO es una sección de primer
 * nivel — y en esos casos es su propio contenedor, así que subir por él no
 * llega a ninguna parte. Mirar qué op-ids viven DENTRO de cada sección resuelve
 * el 100% y cuesta una llamada nativa por sección (doce en una página normal)
 * en vez de una por op.
 */
function mapaDeSecciones(
  tagged: string,
  secciones: readonly LineaDeOutline[],
  seccionDe: DescribirArgs["seccionDe"],
): Map<string, number> {
  const mapa = new Map<string, number>();
  secciones.forEach((f, i) => {
    const html = seccionDe(tagged, f.opId);
    if (!html) return;
    for (const m of html.matchAll(/data-op-id="([^"]+)"/g)) {
      // La PRIMERA gana: las secciones no se solapan, así que esto sólo importa
      // si el motor devolviera algo raro, y ahí quedarse con lo primero es
      // estable entre llamadas.
      if (!mapa.has(m[1])) mapa.set(m[1], i);
    }
  });
  return mapa;
}

/**
 * Describe cada op aplicada. El orden se conserva: es el orden en que el modelo
 * las pidió, y leerlo así cuenta la historia del turno.
 */
export function describirOps(args: DescribirArgs): OpDescrita[] {
  const enDocumento = args.ops.filter(
    (o) => o.type !== "attrs" && !DONDE_POR_TARGET[o.target],
  );

  // Los outlines y el mapa se calculan UNA vez, y sólo si hace falta: un turno
  // que sólo tocó los estilos no paga ninguna llamada nativa.
  const antes = enDocumento.length ? parseOutline(args.outlineDe(args.antesTagged)) : [];
  const despues = enDocumento.length ? parseOutline(args.outlineDe(args.despuesTagged)) : [];
  const seccionPorOpId = enDocumento.length
    ? mapaDeSecciones(args.antesTagged, antes, args.seccionDe)
    : new Map<string, number>();

  const indicePorEtiqueta = new Map<string, number>();
  despues.forEach((f, i) => {
    // El PRIMERO gana: con dos secciones de la misma etiqueta no hay forma de
    // saber cuál, y mandar al usuario a la primera es menos malo que no mandarlo.
    if (f.etiqueta && !indicePorEtiqueta.has(f.etiqueta)) indicePorEtiqueta.set(f.etiqueta, i);
  });

  const out: OpDescrita[] = [];
  for (const op of args.ops) {
    // `attrs` no la emite el modelo — la usa el taller para re-tintar. No es un
    // cambio que contarle a nadie en esta lista.
    if (op.type === "attrs") continue;

    const donde = DONDE_POR_TARGET[op.target];
    if (donde) {
      out.push({ tipo: op.type, donde, etiqueta: "", indice: -1 });
      continue;
    }

    const iSeccion = seccionPorOpId.get(op.target);
    const etiqueta = iSeccion === undefined ? "" : antes[iSeccion]?.etiqueta ?? "";
    // 🔴 LA ETIQUETA NO SIRVE PARA BUSCAR CUANDO LA OP LA CAMBIÓ, y ése es el
    // caso NORMAL, no el raro: el encabezado de una sección es lo que le da
    // nombre en el outline y es también lo que el usuario suele mandar cambiar.
    // Cazado verificando contra el motor real — con los fixtures a mano no
    // salía, porque ahí la etiqueta se mantenía.
    //
    // Cuando el número de secciones NO cambió, ninguna se añadió ni se borró
    // arriba, así que la posición de antes es la de después y se puede usar tal
    // cual. Si cambió, sólo se fía de la etiqueta: mandar al usuario a la
    // sección EQUIVOCADA es peor que no ofrecerle el «ver».
    const mismaEstructura = antes.length === despues.length;
    const indice =
      op.type === "delete"
        ? -1
        : (etiqueta ? indicePorEtiqueta.get(etiqueta) : undefined) ??
          (mismaEstructura && iSeccion !== undefined && iSeccion < despues.length
            ? iSeccion
            : -1);
    out.push({ tipo: op.type, donde: "documento", etiqueta, indice });
  }
  return out;
}
