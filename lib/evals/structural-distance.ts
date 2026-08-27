// ¿DOS PÁGINAS TIENEN LA MISMA FORMA?
//
// CONGELADA el 2026-08-21, ANTES de correr la ablación del contrato mínimo.
// Cambiarla después de ver resultados invalida la corrida — si hace falta
// cambiarla, la corrida se repite entera.
//
// POR QUÉ NO EL "ATRACTOR" DE SEIS BOOLEANOS. La primera métrica preguntaba si
// la página traía navegación + héroe centrado + rejilla de tres + testimonios +
// llamada + pie. No mide parecido: dos páginas pueden sacar 3/6 sin compartir
// un solo componente. Tampoco mide orden, anidamiento ni densidad. Y quitar un
// pie legítimo MEJORABA la puntuación.
//
// LO QUE SÍ SE PERSIGUE. No "páginas distintas" en abstracto: que la forma
// RESPONDA al encargo. Dos ejecuciones del mismo brief deberían parecerse; un
// ensayo, una carta y un portafolio no. De ahí la lectura:
//
//     W = distancia media entre dos páginas del MISMO brief
//     B = distancia media entre páginas de briefs DISTINTOS
//     R = B − W   ← la variedad que explica el CONTENIDO, descontado el azar
//
// Un R alto significa que la forma sigue al encargo. Un R cercano a cero
// significa que el modelo tira la misma página pase lo que pase — que es
// exactamente la queja.
//
// Ignora a propósito: texto, colores, nombres de clase, tipografías y marcas.
// Sólo mira el esqueleto.

/** Los rasgos del esqueleto. Todos derivados del marcado, sin renderizar. */
export interface StructuralFeatures {
  /** La secuencia ORDENADA de landmarks — el rasgo con más peso. */
  readonly landmarks: readonly string[];
  /** Cuántos bloques de primer nivel. */
  readonly blocks: number;
  /** La rejilla más ancha que usa (0 = ninguna). */
  readonly gridMax: number;
  /** Fracción de bloques que contienen una rejilla. */
  readonly gridShare: number;
  /** Peso de la lista frente al párrafo: 1 = todo listas, 0 = todo prosa. */
  readonly listShare: number;
  /** Grupos de 3+ hermanos con la misma etiqueta — la rejilla de tarjetas. */
  readonly repeats: number;
  /** Huecos de fotografía. */
  readonly photos: number;
  /** Profundidad de encabezados usada (1 = sólo h1, 4 = hasta h4). */
  readonly headingDepth: number;
  /** ¿Declara un ancho de lectura acotado? */
  readonly readingWidth: boolean;
  /** ¿Tiene navegación? */
  readonly nav: boolean;
}

const LANDMARK = /<(nav|header|main|section|article|aside|footer)\b/gi;

/** Texto plano de una etiqueta, para pesar prosa contra lista. */
function countTag(html: string, tag: string): number {
  return [...html.matchAll(new RegExp(`<${tag}\\b`, "gi"))].length;
}

export function extractFeatures(html: string): StructuralFeatures {
  const bodyAt = html.search(/<body[^>]*>/i);
  const body = bodyAt === -1 ? html : html.slice(bodyAt);

  const landmarks = [...body.matchAll(LANDMARK)].map((m) => m[1]!.toLowerCase());
  const blocks = landmarks.filter((l) => l === "section" || l === "article").length;

  const grids = [...body.matchAll(/\b(?:sm:|md:|lg:|xl:)?grid-cols-(\d+)\b/g)].map((m) => Number(m[1]));
  const gridMax = grids.length ? Math.max(...grids) : 0;

  const li = countTag(body, "li");
  const p = countTag(body, "p");

  // Repeticiones: 3+ etiquetas iguales seguidas sin otra etiqueta de bloque en
  // medio. Es la firma de la rejilla de tarjetas sin depender de las clases.
  let repeats = 0;
  for (const tag of ["article", "div", "li", "figure"]) {
    const seq = [...body.matchAll(new RegExp(`<(${tag}|section|main|footer)\\b`, "gi"))].map((m) => m[1]!.toLowerCase());
    let run = 0;
    for (const t of seq) {
      if (t === tag) { run++; if (run === 3) repeats++; } else run = 0;
    }
  }

  const headings = [1, 2, 3, 4, 5, 6].filter((n) => new RegExp(`<h${n}\\b`, "i").test(body));

  return {
    landmarks,
    blocks,
    gridMax,
    gridShare: blocks === 0 ? 0 : Math.min(1, grids.length / blocks),
    listShare: li + p === 0 ? 0 : li / (li + p),
    repeats,
    photos: [...body.matchAll(/data-ol-photo=/g)].length,
    headingDepth: headings.length ? Math.max(...headings) : 0,
    readingWidth: /\bmax-w-(prose|2xl|3xl|4xl)\b/.test(body),
    nav: landmarks.includes("nav"),
  };
}

/** Levenshtein normalizado sobre la secuencia de landmarks. 0 = idéntica. */
function seqDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]! / Math.max(m, n);
}

/** Escalas de normalización, fijadas por lo observado en 30 páginas reales. */
const ESCALA = { blocks: 8, gridMax: 4, repeats: 4, photos: 8, headingDepth: 4 } as const;

/**
 * Distancia entre dos páginas, en [0, 1]. La secuencia de landmarks pesa la
 * mitad porque es lo que una persona reconoce como "la misma forma"; el resto
 * de rasgos se reparten la otra mitad por igual.
 */
export function structuralDistance(a: StructuralFeatures, b: StructuralFeatures): number {
  const seq = seqDistance(a.landmarks, b.landmarks);
  const num = (x: number, y: number, escala: number) => Math.min(1, Math.abs(x - y) / escala);
  const rasgos = [
    num(a.blocks, b.blocks, ESCALA.blocks),
    num(a.gridMax, b.gridMax, ESCALA.gridMax),
    Math.abs(a.gridShare - b.gridShare),
    Math.abs(a.listShare - b.listShare),
    num(a.repeats, b.repeats, ESCALA.repeats),
    num(a.photos, b.photos, ESCALA.photos),
    num(a.headingDepth, b.headingDepth, ESCALA.headingDepth),
    a.readingWidth === b.readingWidth ? 0 : 1,
    a.nav === b.nav ? 0 : 1,
  ];
  const media = rasgos.reduce((s, x) => s + x, 0) / rasgos.length;
  return 0.5 * seq + 0.5 * media;
}

export const distanceOf = (a: string, b: string): number =>
  structuralDistance(extractFeatures(a), extractFeatures(b));
