// BUSCAR EN LOS FICHEROS de la lente «Código» (la #11 de
// plans/len-agente-2026/notas/fase-5-taller.md).
//
// Como los constructores: v0 busca en nombres y contenido y un resultado de
// contenido lleva a su línea; Lovable separa «Files» de «In files». Aquí igual:
// primero los ficheros cuyo NOMBRE casa, después las LÍNEAS que casan, agrupadas
// por fichero.
//
// Sin mayúsculas ni acentos: quien escribe «menu» busca también «Menú». Se
// normaliza letra a letra (cada una a UNA), así las posiciones de la línea
// original siguen valiendo para resaltar lo que casó.
//
// Los ficheros que se calculan al abrirlos (`/resultados`, `/bandeja`…) llegan
// sin contenido hasta que alguien los abre: se buscan por nombre y se cuenta
// cuántos no se pudieron buscar por dentro, para decirlo en vez de callarlo.
// Puro: lo prueba vitest.

export interface FicheroBuscable {
  readonly ruta: string;
  /** Null: todavía no se calculó (se busca sólo por nombre). */
  readonly contenido: string | null;
}

export interface LineaQueCasa {
  readonly linea: number;
  /** El trozo de la línea que se enseña (cortada alrededor de lo que casó). */
  readonly antes: string;
  readonly casa: string;
  readonly despues: string;
}

export interface FicheroConLineas {
  readonly ruta: string;
  readonly lineas: readonly LineaQueCasa[];
}

export interface ResultadosDeBusqueda {
  readonly porNombre: readonly string[];
  readonly enFicheros: readonly FicheroConLineas[];
  /** Líneas que casaban y no se enseñan, por el tope. */
  readonly mas: number;
  /** Ficheros sin contenido todavía: no se buscaron por dentro. */
  readonly sinContenido: number;
}

/** Más líneas que esto es una lista que nadie lee: se dice cuántas faltan. */
export const TOPE_DE_LINEAS = 200;

/** Caracteres de la línea que se enseñan antes y después de lo que casó. Pocos
 *  antes, como VS Code: la lista es estrecha y se corta por la derecha, y con
 *  40 delante lo que casó quedaba fuera de la vista. */
const ANTES = 12;
const DESPUES = 60;

/** Cada carácter a uno solo, sin acento y en minúscula: las posiciones no se mueven. */
export function normalizar(texto: string): string {
  let out = "";
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    const n = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += n.length === 1 ? n : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
  }
  return out;
}

function trozo(linea: string, desde: number, largo: number): Omit<LineaQueCasa, "linea"> {
  const inicio = Math.max(0, desde - ANTES);
  const fin = Math.min(linea.length, desde + largo + DESPUES);
  return {
    antes: (inicio > 0 ? "…" : "") + linea.slice(inicio, desde).trimStart(),
    casa: linea.slice(desde, desde + largo),
    despues: linea.slice(desde + largo, fin).trimEnd() + (fin < linea.length ? "…" : ""),
  };
}

export function buscarEnFicheros(
  ficheros: readonly FicheroBuscable[],
  consulta: string,
  tope: number = TOPE_DE_LINEAS,
): ResultadosDeBusqueda {
  const q = normalizar(consulta.trim());
  if (!q) return { porNombre: [], enFicheros: [], mas: 0, sinContenido: 0 };

  const porNombre = ficheros.filter((f) => normalizar(f.ruta).includes(q)).map((f) => f.ruta);
  const enFicheros: FicheroConLineas[] = [];
  let mostradas = 0;
  let mas = 0;
  let sinContenido = 0;
  for (const f of ficheros) {
    if (f.contenido === null) {
      sinContenido += 1;
      continue;
    }
    const lineas: LineaQueCasa[] = [];
    f.contenido.split("\n").forEach((texto, i) => {
      const desde = normalizar(texto).indexOf(q);
      if (desde < 0) return;
      if (mostradas >= tope) {
        mas += 1;
        return;
      }
      mostradas += 1;
      lineas.push({ linea: i + 1, ...trozo(texto, desde, q.length) });
    });
    if (lineas.length > 0) enFicheros.push({ ruta: f.ruta, lineas });
  }
  return { porNombre, enFicheros, mas, sinContenido };
}
