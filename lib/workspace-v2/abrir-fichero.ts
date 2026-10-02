// LAS RUTAS DEL CHAT ABREN EL FICHERO EN EL TALLER (la #9 de
// plans/len-agente-2026/notas/fase-5-taller.md).
//
// Como el escritorio de Claude Code (una ruta del chat abre el fichero en su
// panel) y la web de DeepSeek (la tarjeta de una edición y las rutas entre
// comillas de código del texto final abren el fichero en la barra lateral).
// Aquí, el sitio es el lienzo:
//   · en «Cambios», si el fichero cambió en ESE turno (se ve qué hizo Len);
//   · si no, en «Código», con ese fichero elegido.
//
// Qué rutas: la de la tarjeta de `Read`, `Edit` y `Write`, y las que Len
// escribe entre comillas de código en su texto, PERO sólo si casan con un
// fichero que ese turno leyó o cambió. La regla de DeepSeek
// (`ui-deliverables/README.md`, «Inline-code links»): por la ruta exacta o por
// un nombre que sea de UNO solo; si dos lo comparten —aquí todas las páginas se
// llaman `index.html`— no se enlaza, para no abrir el equivocado. Lo que Len
// nombra sin haberlo tocado se queda en texto: no se enlaza a algo que quizá no
// existe.
//
// La petición de «Código» sigue el patrón de `cambios-en-vivo.ts`: el Chat la
// deja en un objeto de módulo y el lienzo —que es quien manda la lente— la
// atiende.

import type { CambiosEnVivo } from "./cambios-en-vivo";

export interface PeticionDeCodigo {
  /** La ruta absoluta del fichero (`/menu/index.html`). */
  readonly ruta: string;
  /** Sube con cada petición: pedir dos veces lo mismo también abre. */
  readonly n: number;
}

export interface AbrirEnElCodigo {
  subscribe(fn: () => void): () => void;
  abrir(projectId: string, ruta: string): void;
  peticion(projectId: string): PeticionDeCodigo | null;
}

export function createAbrirEnElCodigo(): AbrirEnElCodigo {
  const peticiones = new Map<string, PeticionDeCodigo>();
  const listeners = new Set<() => void>();
  let n = 0;
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    abrir(projectId, ruta) {
      peticiones.set(projectId, { ruta, n: ++n });
      for (const fn of listeners) {
        try {
          fn();
        } catch {
          // Un suscriptor que revienta no se lleva a los demás.
        }
      }
    },
    peticion(projectId) {
      return peticiones.get(projectId) ?? null;
    },
  };
}

/** La instancia que comparten el Chat y el lienzo. */
export const abrirEnElCodigo = createAbrirEnElCodigo();

/** Las herramientas cuya tarjeta empieza por la ruta del fichero (`herramientas-de-ficheros.ts`). */
const CON_RUTA = new Set(["Read", "Edit", "Write"]);

/**
 * La ruta de una tarjeta, o null. El resumen EMPIEZA por la ruta relativa:
 * `index.html`, `menu/index.html: «…» → «…»`, `clases/index.html (página nueva)`.
 * Las rutas del sitio no llevan espacios ni dos puntos.
 */
export function rutaDeLaTarjeta(action: { readonly tool: string; readonly summary: string }): string | null {
  if (!CON_RUTA.has(action.tool)) return null;
  const m = /^\/?([^\s:]+)/.exec(action.summary.trim());
  if (!m || !/[^/]\.[a-z0-9]+$/i.test(m[1]!)) return null;
  return `/${m[1]}`;
}

/**
 * Qué fichero nombra un trozo de código del texto de Len, entre los que el
 * turno leyó o cambió (`candidatas`, rutas absolutas). Acepta la ruta con o sin
 * la barra del principio y con `:línea` detrás. Null si no es ninguno o si el
 * nombre lo comparten varios.
 */
export function rutaMencionada(codigo: string, candidatas: readonly string[]): string | null {
  const limpio = codigo.trim().replace(/:\d+(?:[-–]\d+)?$/, "");
  if (!limpio || /\s/.test(limpio)) return null;
  const absoluta = limpio.startsWith("/") ? limpio : `/${limpio}`;
  if (candidatas.includes(absoluta)) return absoluta;
  if (limpio.includes("/")) return null;
  const mismoNombre = candidatas.filter((r) => r.slice(r.lastIndexOf("/") + 1) === limpio);
  return mismoNombre.length === 1 ? mismoNombre[0]! : null;
}

/** Las rutas que un turno leyó o cambió: las de sus tarjetas y las de su foto de cambios. */
export function rutasDelTurno(
  actions: readonly { readonly tool: string; readonly summary: string }[] | undefined,
  cambiadas: readonly string[],
): string[] {
  const rutas = new Set<string>(cambiadas);
  for (const a of actions ?? []) {
    const r = rutaDeLaTarjeta(a);
    if (r) rutas.add(r);
  }
  return [...rutas];
}

/** Abre el fichero donde toca: en «Cambios» si cambió en ese turno; si no, en «Código». */
export function abrirFicheroDelTurno(
  projectId: string,
  turnId: string,
  ruta: string,
  almacenes: { readonly cambios: CambiosEnVivo; readonly codigo: AbrirEnElCodigo },
): "cambios" | "codigo" {
  const turno = almacenes.cambios.turnos(projectId).find((t) => t.turnId === turnId);
  if (turno?.ficheros.some((f) => f.ruta === ruta)) {
    almacenes.cambios.abrir(projectId, turnId, ruta);
    return "cambios";
  }
  almacenes.codigo.abrir(projectId, ruta);
  return "codigo";
}
