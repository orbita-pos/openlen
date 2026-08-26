import type { ModelRuntimeCapsule } from "./model-runtime";

/**
 * QUÉ CÁPSULA ES DE QUÉ PÁGINA.
 *
 * El JavaScript del modelo vivía sólo en la Home. No por una regla de producto
 * sino por una de almacenamiento: la cápsula ata el código a UN documento
 * exacto (`projectId + html + code`), y había UNA sola columna, así que sólo
 * podía autorizar un documento — `data.html`.
 *
 * El efecto para el usuario era peor de lo que suena, y está MEDIDO: no es que
 * `/precios` no tuviera interactividad. Es que **en cuanto añadías una segunda
 * página, la Home también la perdía** (la puerta `varias_paginas` del
 * publicador), y un dominio propio la apagaba igual con una sola página.
 *
 * DECISIÓN de Jesús (2026-08-25): JavaScript libre en todas las páginas. El
 * único «no puedo» que queda es lo que de verdad necesita un servidor.
 *
 * Este módulo es el ÚNICO sitio que sabe dónde vive cada cápsula. Es a
 * propósito: la regla anterior estaba escrita en cuatro capas a la vez —la
 * ruta, el catálogo, la herramienta y la persistencia— y ése fue justo el
 * defecto del hallazgo 1. Una sola fuente, y las cuatro la leen.
 *
 * Puro: sin `server-only`, sin base de datos, sin Node. La decisión se prueba
 * entera sin levantar nada.
 */

/**
 * Las dos columnas donde puede vivir una cápsula.
 *
 * LOS DOS CAMPOS SON OBLIGATORIOS, y esa es la parte importante. Nacieron
 * opcionales y costó caro: `publishProject` leía la fila con un `select` de
 * columnas explícitas y se dejó `pageRuntimes` fuera. No dio error de tipos
 * —una fila sin el campo era un `FilaConRuntimes` válido— ni error en
 * ejecución: TODAS las subpáginas se publicaban sin su JavaScript, y ni
 * siquiera quedaba el log de omisión, porque ése también pregunta por la
 * cápsula que nunca se había leído. Cuatro superficies más tenían el mismo
 * agujero.
 *
 * Con los campos obligatorios, olvidar la columna es un error de compilación.
 * `unknown` sigue siendo lo correcto para el VALOR —quien lo reciba tiene que
 * pasarlo por `verifyCapsule` igual—, pero su PRESENCIA ya no es opcional.
 */
export interface FilaConRuntimes {
  /** `projects.generatedRuntime` — el de la Home. */
  readonly generatedRuntime: unknown;
  /** `projects.pageRuntimes` — uno por slug de subpágina. */
  readonly pageRuntimes: unknown;
}

/**
 * La cápsula que le toca a `page`, sin verificar. Quien la reciba tiene que
 * pasarla igualmente por `verifyCapsule`: esto dice DÓNDE mirar, no si vale.
 *
 * `page` nulo o indefinido es la Home — el contrato histórico, y el que llega
 * desde una sesión que nunca cambió de documento.
 */
export function capsulaDePagina(
  row: FilaConRuntimes | null | undefined,
  page: string | null | undefined,
): unknown {
  if (!row) return null;
  if (!page) return row.generatedRuntime ?? null;
  const porSlug = row.pageRuntimes;
  if (!porSlug || typeof porSlug !== "object") return null;
  return (porSlug as Record<string, unknown>)[page] ?? null;
}

/**
 * El fragmento del `.set()` que guarda —o borra— la cápsula de `page`.
 *
 * `undefined` significa NO TOCAR la columna, y por eso el objeto sale vacío:
 * un `{ pageRuntimes: undefined }` en Drizzle sí escribe. Esa distinción entre
 * «no tocar» y «vaciar» es la misma que ya paga `columnaRuntime` para la Home,
 * y confundirlas era el defecto que hacía imposible «quítame el carrito».
 *
 * Para una subpágina hay que fusionar sobre el mapa que ya existe: escribir
 * sólo `{ [slug]: capsula }` borraría el JavaScript de todas las demás páginas
 * de una sentada. Por eso hace falta el mapa actual.
 */
export function columnasDeRuntime(args: {
  readonly page: string | null | undefined;
  readonly runtime: ModelRuntimeCapsule | null | undefined;
  /** `row.pageRuntimes` tal cual se leyó. Sólo se usa para subpáginas. */
  readonly actuales?: unknown;
}): {
  generatedRuntime?: ModelRuntimeCapsule | null;
  pageRuntimes?: Record<string, ModelRuntimeCapsule>;
} {
  if (args.runtime === undefined) return {};
  if (!args.page) return { generatedRuntime: args.runtime };

  const base: Record<string, ModelRuntimeCapsule> =
    args.actuales && typeof args.actuales === "object"
      ? { ...(args.actuales as Record<string, ModelRuntimeCapsule>) }
      : {};
  if (args.runtime === null) delete base[args.page];
  else base[args.page] = args.runtime;
  return { pageRuntimes: base };
}

/**
 * El mapa slug → cápsula, ya saneado. `{}` cuando la columna está vacía o trae
 * algo que no es un objeto.
 *
 * Existe para que borrar una página no tenga que adivinar la forma de la
 * columna en el sitio donde borra. Toda la aritmética de este mapa vive aquí,
 * que es la razón de ser del módulo.
 */
export function runtimeMapDe(pageRuntimes: unknown): Record<string, ModelRuntimeCapsule> {
  if (!pageRuntimes || typeof pageRuntimes !== "object") return {};
  return { ...(pageRuntimes as Record<string, ModelRuntimeCapsule>) };
}
