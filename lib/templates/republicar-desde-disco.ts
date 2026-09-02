/**
 * Qué plantillas del disco han dejado de coincidir con la galería.
 *
 * POR QUÉ EXISTE (2026-09-02). El 01/09 se limpiaron a mano los `on*` de 19
 * plantillas del corpus (`c6c3e6d2` + `defc7e68`). Los ficheros quedaron SÓLO
 * en el disco de Jesús: la galería sirve desde R2, así que hasta republicar,
 * los clones seguían saliendo con los `on*` y el trabajo no le llegaba a nadie.
 *
 * Y NO SE PODÍA REPUBLICAR DESDE ESE DISCO. Medido: su `DATABASE_URL` apunta a
 * `127.0.0.1:5432/openlen` (PostgreSQL 17.4 **on x86_64-windows**), y
 * `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` no están puestas, así que el store
 * cae al adaptador de disco. `templates:republish-one` habría escrito la fila en
 * la base local y el HTML en `public/template-objects/`, habría impreso `ok` y
 * producción no habría cambiado nada. Un no-op que parece un éxito.
 *
 * TAMPOCO SE PODÍA BUNDLEAR LA CLI. `upsertTemplate` → `findTemplateHtmlIssue`
 * → `sanitizeForPublish` arrastra el crate nativo, el mismo muro que
 * `scripts/build-cron.mjs` documenta para `live-republish.ts`: esbuild no puede
 * empaquetar un `.node` en un `.mjs` standalone.
 *
 * La salida es la que ya se usó allí: correr EN PROCESO con la app, donde los
 * crates están cargados y el entorno es el de producción. Este módulo es la
 * mitad PURA de eso —decidir qué hay que republicar— para que se pueda probar
 * sin base, sin red y sin binding nativo.
 */

import { createHash } from "node:crypto";

/** Idéntico al `sha256` de store.ts. Si aquél cambia, esto miente. */
export function hashDeContenido(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

export interface PlantillaEnDisco {
  id: string;
  html: string;
}

export interface FilaDeGaleria {
  id: string;
  contentHash: string;
}

export interface Deriva {
  id: string;
  hashDisco: string;
  hashGaleria: string;
  bytes: number;
}

export interface PlanDeRepublicacion {
  /** Están en las dos partes y el contenido NO coincide: hay que republicar. */
  cambiadas: Deriva[];
  /** Coinciden byte a byte. Republicarlas sería un no-op caro. */
  iguales: string[];
  /** En el disco pero sin fila en la galería. NO se dan de alta aquí: alta y
   *  actualización son cosas distintas, y una alta necesita nombre, familia,
   *  acento y descripción que un `.html` suelto no trae. Se listan para que se
   *  vean, no para actuar sobre ellas. */
  soloEnDisco: string[];
  /** En la galería y sin fichero en el disco. Normal: el disco es una copia
   *  parcial. Se listan porque un hueco inesperado aquí es la señal de que
   *  alguien borró una fuente. */
  soloEnGaleria: string[];
}

/**
 * NO decide nada por su cuenta: sólo compara. Quien llame elige qué aplicar, y
 * la ruta lo hace en seco por defecto — una herramienta que escribe en la
 * galería de producción sin que se lo pidan dos veces es una que acaba
 * escribiendo cuando no debía.
 */
export function planificarRepublicacion(
  disco: readonly PlantillaEnDisco[],
  galeria: readonly FilaDeGaleria[],
): PlanDeRepublicacion {
  const porId = new Map(galeria.map((f) => [f.id, f.contentHash]));
  const vistos = new Set<string>();

  const cambiadas: Deriva[] = [];
  const iguales: string[] = [];
  const soloEnDisco: string[] = [];

  for (const p of disco) {
    const hashGaleria = porId.get(p.id);
    if (hashGaleria === undefined) {
      soloEnDisco.push(p.id);
      continue;
    }
    vistos.add(p.id);
    const hashDisco = hashDeContenido(p.html);
    if (hashDisco === hashGaleria) {
      iguales.push(p.id);
    } else {
      cambiadas.push({
        id: p.id,
        hashDisco,
        hashGaleria,
        bytes: Buffer.byteLength(p.html, "utf8"),
      });
    }
  }

  const soloEnGaleria = galeria
    .map((f) => f.id)
    .filter((id) => !vistos.has(id) && !soloEnDisco.includes(id));

  return {
    cambiadas: cambiadas.sort((a, b) => a.id.localeCompare(b.id)),
    iguales: iguales.sort(),
    soloEnDisco: soloEnDisco.sort(),
    soloEnGaleria: soloEnGaleria.sort(),
  };
}

/**
 * Qué se va a republicar de verdad, dada una petición.
 *
 * `ids` vacío o ausente = todas las cambiadas. Un id que se pide pero NO ha
 * cambiado se devuelve en `ignorados`, no se republica: reescribir una fila que
 * ya está bien crea un objeto huérfano en R2 a cambio de nada. Y un id que ni
 * siquiera está en el plan se devuelve en `desconocidos` en vez de fallar en
 * silencio.
 */
export function seleccionar(
  plan: PlanDeRepublicacion,
  ids?: readonly string[],
): { republicar: Deriva[]; ignorados: string[]; desconocidos: string[] } {
  if (!ids || ids.length === 0) {
    return { republicar: plan.cambiadas, ignorados: [], desconocidos: [] };
  }
  const cambiadaPorId = new Map(plan.cambiadas.map((c) => [c.id, c]));
  const conocidos = new Set([
    ...plan.cambiadas.map((c) => c.id),
    ...plan.iguales,
    ...plan.soloEnDisco,
    ...plan.soloEnGaleria,
  ]);

  const republicar: Deriva[] = [];
  const ignorados: string[] = [];
  const desconocidos: string[] = [];

  for (const id of ids) {
    const c = cambiadaPorId.get(id);
    if (c) republicar.push(c);
    else if (conocidos.has(id)) ignorados.push(id);
    else desconocidos.push(id);
  }

  return { republicar, ignorados, desconocidos };
}
