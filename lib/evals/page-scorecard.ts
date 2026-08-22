// lib/evals/page-scorecard.ts — qué cuenta como fallo, y cómo se compara una
// corrida con la anterior.
//
// Datos y funciones puras: sin I/O, sin nativo. Lo que las alimenta lo mide el
// motor y el navegador; aquí sólo se decide.

/** Cada motivo por el que una página puede fallar. Cerrado a propósito: un
 *  fallo que no está aquí no se puede contar, y eso obliga a nombrarlo. */
export const FAILURE_CODES = [
  /** Ni el intento inicial ni el reintento dieron un documento con forma. */
  "shape",
  /** La puerta rechazó: marcador reservado, saneo imposible, conducta muerta. */
  "gate",
  /** El navegador midió que algo se sale de la pantalla en móvil. */
  "overflow",
  /** Cajas con geometría imposible. */
  "geometry",
  /** Titular ausente, duplicado o que no domina. */
  "typography",
  /** Texto que la página pinta y nadie puede leer. */
  "unreadable",
  /** `<html lang>` no coincide con el idioma del brief. */
  "lang",
  /** Falta `dir="rtl"` en una escritura de derecha a izquierda. */
  "rtl",
  /** El brief pedía calcular y la página no calcula — o su fórmula no compila. */
  "calc",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface PageMeasurement {
  readonly id: string;
  /** Cuántos intentos hicieron falta. 0 = falló los dos. */
  readonly attempts: number;
  /** Basura del modelo que `extractDocument` tuvo que recortar. */
  readonly trimmed: number;
  readonly gateCode?: string;
  readonly mobileOverflow?: boolean;
  readonly invalidGeometry?: boolean;
  readonly typographyRule?: string | null;
  readonly unreadable?: number;
  readonly h1Count?: number;
  readonly lang?: string;
  readonly dir?: string;
  /** Fórmulas de una región `data-ol-calc` que compilaron. `undefined` = no se midió. */
  readonly calcFormulas?: number;
  /** Fórmulas que NACIERON MUERTAS: no parsean, o leen un nombre inexistente. */
  readonly calcIssues?: number;
  readonly bytes?: number;
  readonly ms: number;
}

export interface PageVerdict {
  readonly id: string;
  readonly failures: readonly FailureCode[];
  readonly measurement: PageMeasurement;
}

export interface Expectation {
  readonly expectLang: string;
  readonly expectRtl?: true;
  readonly expectCalc?: true;
}

/** Todo lo que salió mal en una página, no sólo lo primero. Un turno puede a la
 *  vez desbordar Y salir en otro idioma, y contar sólo uno esconde el otro. */
export function judgePage(m: PageMeasurement, expect: Expectation): PageVerdict {
  const failures: FailureCode[] = [];
  if (m.attempts === 0) return { id: m.id, failures: ["shape"], measurement: m };
  if (m.gateCode) return { id: m.id, failures: ["gate"], measurement: m };

  if (m.mobileOverflow === true) failures.push("overflow");
  if (m.invalidGeometry === true) failures.push("geometry");
  // Un titular ausente o duplicado es un defecto de estructura aunque el render
  // no llegue a medir la jerarquía.
  if (m.typographyRule || (m.h1Count !== undefined && m.h1Count !== 1)) failures.push("typography");
  if ((m.unreadable ?? 0) > 0) failures.push("unreadable");
  if (m.lang !== undefined && !m.lang.toLowerCase().startsWith(expect.expectLang)) failures.push("lang");
  if (expect.expectRtl && m.dir?.toLowerCase() !== "rtl") failures.push("rtl");
  // Determinista como todo lo demás de este marcador: o hay una región de
  // cálculo y sus fórmulas compilan, o no la hay. No se juzga si el cálculo es
  // el "correcto" —eso sería gusto, y el juez LLM ya se descartó por ruidoso
  // ([[llm-judge-is-not-a-ship-gate]])— sino si la página que el brief pidió
  // calcular de verdad calcula algo que la puerta acepta.
  if (expect.expectCalc && ((m.calcFormulas ?? 0) === 0 || (m.calcIssues ?? 0) > 0)) {
    failures.push("calc");
  }

  return { id: m.id, failures, measurement: m };
}

export interface Scorecard {
  readonly cohortVersion: string;
  readonly revision: string;
  readonly at: string;
  readonly pages: number;
  readonly clean: number;
  /** Cuántas páginas fallaron por cada código. Una página puede sumar en varios. */
  readonly byCode: Readonly<Record<string, number>>;
  /** Páginas que necesitaron un reintento — el modelo escribió algo inservible. */
  readonly retried: number;
  /** Páginas de las que hubo que recortar basura del modelo. */
  readonly trimmed: number;
  readonly costMxn: number;
  /** La corrida se cortó (tope de gasto): NO es una foto del conjunto y no
   *  debe pisar la línea base ni compararse por totales. */
  readonly partial: boolean;
  readonly verdicts: readonly PageVerdict[];
}

export function buildScorecard(input: {
  cohortVersion: string;
  revision: string;
  at: string;
  verdicts: readonly PageVerdict[];
  costMxn: number;
  partial?: boolean;
}): Scorecard {
  const byCode: Record<string, number> = {};
  for (const v of input.verdicts) for (const f of v.failures) byCode[f] = (byCode[f] ?? 0) + 1;
  return {
    cohortVersion: input.cohortVersion,
    revision: input.revision,
    at: input.at,
    pages: input.verdicts.length,
    clean: input.verdicts.filter((v) => v.failures.length === 0).length,
    byCode,
    retried: input.verdicts.filter((v) => v.measurement.attempts > 1).length,
    trimmed: input.verdicts.filter((v) => v.measurement.trimmed > 0).length,
    costMxn: input.costMxn,
    partial: input.partial === true,
    verdicts: input.verdicts,
  };
}

/**
 * Contra la corrida anterior. Una tasa suelta no dice nada; lo que importa es si
 * SUBIÓ o BAJÓ, y qué páginas concretas cambiaron de lado.
 */
export function compareScorecards(prev: Scorecard | null, next: Scorecard): {
  readonly regressed: readonly string[];
  readonly fixed: readonly string[];
  readonly delta: number | null;
  /** Falso cuando el conjunto cambió: las tasas dejan de ser comparables. */
  readonly comparable: boolean;
} {
  if (!prev || prev.cohortVersion !== next.cohortVersion) {
    return { regressed: [], fixed: [], delta: null, comparable: false };
  }
  const before = new Map(prev.verdicts.map((v) => [v.id, v.failures.length === 0]));
  const regressed: string[] = [];
  const fixed: string[] = [];
  // Sólo sobre las páginas que corrieron en AMBAS. Restar los totales de una
  // corrida cortada contra una completa inventa una caída que no ocurrió.
  let shared = 0;
  let cleanBefore = 0;
  let cleanNow = 0;
  for (const v of next.verdicts) {
    const wasClean = before.get(v.id);
    if (wasClean === undefined) continue;
    shared += 1;
    const isClean = v.failures.length === 0;
    if (wasClean) cleanBefore += 1;
    if (isClean) cleanNow += 1;
    if (wasClean && !isClean) regressed.push(v.id);
    if (!wasClean && isClean) fixed.push(v.id);
  }
  if (shared === 0) return { regressed: [], fixed: [], delta: null, comparable: false };
  return { regressed, fixed, delta: cleanNow - cleanBefore, comparable: true };
}
