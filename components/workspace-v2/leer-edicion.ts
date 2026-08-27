// LA FRONTERA CON EL NAVEGADOR.
//
// Todo lo que llega por `postMessage` es entrada no fiable, aunque venga de
// nuestro propio iframe: el documento que corre ahí dentro es el del modelo, y
// ahora además su JavaScript corre. Aquí se decide qué tiene forma de edición y
// qué se tira.
//
// Vivía dentro de `app/[locale]/new/page.tsx`, y por vivir ahí no tenía ni una
// prueba. El aplicador —`lib/page-engine/aplicar-ediciones.ts`— sí las tiene, y
// de sobra; el que las tiraba antes de llegar a él no tenía ninguna. Ahí estaba
// el hueco por el que se colaba que quitar una tipografía no quitase nada
// (2026-08-27): el lector no leía `reemplazarPorAtributo` y descartaba las
// ediciones de cabeza con `html` vacío, que son justamente las que BORRAN.
import type { Edicion } from "@/lib/page-engine/aplicar-ediciones";

import { stripEditorInstrumentationFragment } from "./strip-editor-instrumentation";

/**
 * Lee una edición del mensaje del iframe, o `null` si no tiene forma válida.
 *
 * El fragmento se limpia AQUÍ porque cada inyector borra sólo sus propios
 * marcadores — el elemento que manda uno puede llevar encima los de los otros
 * cuatro. Éste es el único embudo por el que pasa toda edición.
 */
export function leerEdicion(data: unknown): Edicion | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  if (d.op === "attrs_raiz") {
    const attrs = leerAtributos(d.attrs);
    return attrs ? { op: "attrs_raiz", attrs } : null;
  }

  if (d.op === "cabeza") {
    if (typeof d.html !== "string") return null;
    const porAtributo =
      typeof d.reemplazarPorAtributo === "string" && d.reemplazarPorAtributo
        ? d.reemplazarPorAtributo
        : undefined;
    // `html` vacío CON atributo es la edición que sólo quita: cambiar a «sin
    // tipografía», borrar una descripción, soltar una temática. Sin atributo no
    // es nada, y tirarla es lo correcto.
    if (!d.html && !porAtributo) return null;
    return {
      op: "cabeza",
      html: d.html ? stripEditorInstrumentationFragment(d.html) : "",
      ...(porAtributo ? { reemplazarPorAtributo: porAtributo } : {}),
    };
  }

  if (d.op === "atributos") {
    if (typeof d.path !== "string" || !d.path) return null;
    if (typeof d.tag !== "string" || !d.tag) return null;
    if (!Array.isArray(d.hijos)) return null;
    const attrs = leerAtributos(d.attrs);
    if (!attrs) return null;
    return {
      op: "atributos",
      path: d.path,
      tag: d.tag,
      hijos: d.hijos.filter((x): x is string => typeof x === "string"),
      attrs,
    };
  }

  if (d.op === "mover") {
    if (typeof d.path !== "string" || !d.path) return null;
    if (typeof d.destino !== "string" || !d.destino) return null;
    if (typeof d.tag !== "string" || typeof d.destinoTag !== "string") return null;
    if (!Array.isArray(d.hijos) || !Array.isArray(d.destinoHijos)) return null;
    return {
      op: "mover",
      path: d.path,
      tag: d.tag,
      hijos: d.hijos.filter((x): x is string => typeof x === "string"),
      destino: d.destino,
      destinoTag: d.destinoTag,
      destinoHijos: d.destinoHijos.filter((x): x is string => typeof x === "string"),
      posicion: d.posicion === "despues" ? "despues" : "antes",
    };
  }

  const op = d.op === undefined ? "replace" : d.op;
  if (op !== "replace" && op !== "insert_before" && op !== "insert_after" && op !== "delete") {
    return null;
  }
  if (typeof d.path !== "string" || !d.path) return null;
  if (typeof d.tag !== "string" || !d.tag) return null;
  if (!Array.isArray(d.hijos)) return null;
  if (op !== "delete" && typeof d.html !== "string") return null;
  return {
    op,
    path: d.path,
    tag: d.tag,
    hijos: d.hijos.filter((x): x is string => typeof x === "string"),
    ...(typeof d.html === "string"
      ? { html: stripEditorInstrumentationFragment(d.html) }
      : {}),
  };
}

/**
 * Un mapa de atributos del iframe, o `null` si no hay ninguno legible.
 *
 * `null` como VALOR significa «quítalo», así que se conserva; la cadena vacía
 * también viaja, porque `data-ol-reink=""` es como la re-tinta anota que un
 * elemento no tenía color propio. Cualquier otro tipo se descarta.
 */
function leerAtributos(v: unknown): Record<string, string | null> | null {
  if (!v || typeof v !== "object") return null;
  const limpios: Record<string, string | null> = {};
  for (const [k, valor] of Object.entries(v as Record<string, unknown>)) {
    if (valor === null || typeof valor === "string") limpios[k] = valor;
  }
  return Object.keys(limpios).length > 0 ? limpios : null;
}

/**
 * La clave por la que una edición SUSTITUYE a otra pendiente, o `null` si no
 * sustituye a ninguna.
 *
 * Sólo las idempotentes: reescribir el mismo elemento, volver a poner los
 * mismos atributos de la raíz, o los mismos atributos de un elemento. Una
 * inserción o un borrado sobre el mismo ancla son acciones distintas que se
 * acumulan.
 *
 * La cabeza NO se colapsa: `applyHeadOp` ya decide por nodo qué reemplaza y qué
 * añade, y dos turnos pueden traer cosas distintas (un título y una fuente).
 */
export function claveDeEdicion(e: Edicion): string | null {
  if (e.op === "replace") return "replace:" + e.path;
  // LOS NOMBRES FORMAN PARTE DE LA CLAVE, y no es un detalle. Una edición de
  // atributos sólo toca los que nombra, así que dos que nombran cosas
  // distintas no son la misma edición: el selector de tema escribe `style` y
  // `data-ol-mode` en la raíz, y las temáticas escriben `data-ol-tematica`.
  // Colapsarlas por la ruta se llevaría una de las dos por delante — elegir un
  // tema y luego una temática, y que el tema no se guardase.
  if (e.op === "attrs_raiz") return "attrs_raiz:" + nombresDe(e.attrs);
  // Con eso dicho: dos pasadas de re-tinta sobre el mismo elemento SÍ son el
  // mismo cambio, y la segunda lo deja como quedó. Sin colapsarlas, cambiar de
  // temática cinco veces mandaría cinco ediciones por elemento y una página
  // normal se comería el techo del lote ella sola.
  if (e.op === "atributos") return "atributos:" + e.path + ":" + nombresDe(e.attrs);
  return null;
}

/** Los nombres de un mapa de atributos, ordenados, para poder compararlos. */
function nombresDe(attrs: Readonly<Record<string, string | null>>): string {
  return Object.keys(attrs).sort().join(",");
}
