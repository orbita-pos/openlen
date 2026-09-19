// lib/evals/page-scorecard.ts — qué cuenta como fallo, y cómo se compara una
// corrida con la anterior.
//
// Datos y funciones puras: sin I/O, sin nativo. Lo que las alimenta lo mide el
// motor y el navegador; aquí sólo se decide.

import type { EsfuerzoAgente } from "@/lib/agent/esfuerzo";

/** Cada motivo por el que una página puede fallar. Cerrado a propósito: un
 *  fallo que no está aquí no se puede contar, y eso obliga a nombrarlo. */
export const FAILURE_CODES = [
  /** Ni el intento inicial ni el reintento dieron un documento con forma. */
  "shape",
  /** La puerta rechazó: marcador reservado, saneo imposible, conducta muerta. */
  "gate",
  /** El brief pidió páginas SEPARADAS y el sitio no las tiene.
   *
   *  Va tan arriba porque no es un defecto de la página: es que el sitio no es
   *  el que se pidió. Se cuenta el NÚMERO, nunca los nombres — exigir
   *  `/equipo` en vez de `/nosotros` sería medirle al modelo nuestro
   *  vocabulario, que es exactamente como murieron `calc` y `prueba`. */
  "paginas",
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
  /** Un enlace interno que promete una sección que la página no tiene.
   *
   *  Añadido el 2026-09-07, y con el caso que lo pidió: `contradictorio` había
   *  puntuado LIMPIA en dos líneas base seguidas con SEIS botones de compra —el
   *  principal de 3.450 €— apuntando a `#comprar` sin que existiera. Salió en 6
   *  de las 48 páginas del corpus (13%) y ninguno de los otros ocho códigos
   *  puede verlo: la captura sale perfecta y el JavaScript no grita.
   *
   *  Cuenta SÓLO el ancla a un id inexistente. `href="#"` a secas salió 45
   *  veces en 12 de 16 páginas —es el idioma del modelo para un control— y
   *  contarlo repetiría, letra por letra, cómo murió el veredicto `prueba`. */
  "enlace",
  // ⚰️ AQUÍ ESTABA `prueba` (2026-09-04, la misma tarde que se añadió).
  //
  // Duró una corrida y la corrida la desmintió: acusó a 3 páginas de 11 y
  // acertó en 0. Se abrieron una por una — `quiz` usó `que:"estilo"` con
  // `disabled` porque no teníamos verbo para atributos; `una-seccion` y `saas`
  // pulsaban «enviar» sin rellenar campos `required`, así que el navegador ni
  // disparaba el `submit`. Las tres páginas funcionaban, y las «limpias»
  // bajaron de 14 a 12 por el medidor, no por las páginas.
  //
  // Al retirarle el voto quedó midiéndose como observación, y el 2026-09-05 se
  // retiró entera: la prueba existía porque al crear el modelo no puede mirar
  // su página, así que en el hueco de un diagnóstico pusimos una promesa. Su
  // consumidor —la reparación automática— ya se había ido el día anterior.
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
  /** Cuántos DESTINOS distintos prometen una sección que no existe, y el peor
   *  con su texto — para que el marcador diga cuál botón, no «hay uno». */
  readonly deadAnchors?: number;
  readonly deadAnchorWorst?: string;
  readonly lang?: string;
  readonly dir?: string;
  /** Fórmulas de una región `data-ol-calc` que compilaron. Se SIGUE midiendo
   *  —`compileCalcRegions` no se ha ido y una página vieja puede traerlas— pero
   *  ya no decide nada: ver la lápida del veredicto `calc`, más abajo. */
  readonly calcFormulas?: number;
  /** Fórmulas que NACIERON MUERTAS: no parsean, o leen un nombre inexistente. */
  readonly calcIssues?: number;
  // ⚰️ `pruebaPasos` y `pruebaFallos`, retirados con la prueba (2026-09-05).
  // El bloque que la pedía salió del prompt de crear, así que ninguna página
  // declara ya nada y estos dos campos no los escribía nadie.
  /** SÓLO EN UNA SUBPÁGINA: cuánto de ella ya estaba en la portada.
   *
   *  🔴 SE MIDE Y NO VOTA. No hay `FailureCode` para esto y es a propósito:
   *  `calc` y `prueba` nacieron con voto y hubo que retirárselo las dos veces,
   *  la segunda tras acusar a 3 páginas y acertar en 0. Claude Code tiene la
   *  figura de serie —un grader con `scored: false` corre y se
   *  reporta sin entrar en el score—. Primero el corpus; el voto después.
   *
   *  La SEÑAL es `repeatedRun`, no `repeatedFromHome`: una sección copiada deja
   *  los bloques seguidos (racha 10 medida), un dato verdadero que se repite
   *  entre páginas queda suelto (racha 1). */
  readonly repeatedFromHome?: number;
  readonly repeatedRun?: number;
  readonly repeatedWorst?: string;
  /** Cuántas páginas declaró la portada con una ruta relativa de un tramo.
   *  Sólo lo mira un caso que declare `expectPages`. */
  readonly declaredPages?: number;
  readonly bytes?: number;
  readonly ms: number;
}

/** Una subpágina medida por separado dentro del caso que la pidió.
 *
 *  NO es una fila del marcador. Visto de Claude Code (`plugin
 *  eval`): la tabla lleva UNA fila por caso —`CASE SCORE PASS% RUNS
 *  COST NOTES`— y lo que se mide dentro son `graders`, cada uno con nombre,
 *  peso y explicación. Hacer fila a cada subpágina movería el recuento de
 *  páginas cada vez que un brief pida una más. */
export interface SubpageVerdict {
  readonly slug: string;
  readonly failures: readonly FailureCode[];
  readonly measurement: PageMeasurement;
}

export interface PageVerdict {
  readonly id: string;
  readonly failures: readonly FailureCode[];
  readonly measurement: PageMeasurement;
  /** Las subpáginas que la portada declaró, ya medidas. Ausente en un caso de
   *  una sola página, que son casi todos. */
  readonly subpages?: readonly SubpageVerdict[];
}

export interface Expectation {
  readonly expectLang: string;
  readonly expectRtl?: true;
  /** Cuántas páginas separadas pide el brief, AL MENOS. El caso declara lo que
   *  espera —como un `grader` de `plugin eval`, que lo declara el caso y no
   *  el arnés—: sin esto, una portada que no declara ninguna saldría LIMPIA y
   *  el camino de las subpáginas seguiría siendo invisible. */
  readonly expectPages?: number;
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
  if (expect.expectPages !== undefined && (m.declaredPages ?? 0) < expect.expectPages) {
    failures.push("paginas");
  }
  if ((m.deadAnchors ?? 0) > 0) failures.push("enlace");
  if (m.lang !== undefined && !m.lang.toLowerCase().startsWith(expect.expectLang)) failures.push("lang");
  if (expect.expectRtl && m.dir?.toLowerCase() !== "rtl") failures.push("rtl");
  // ⚰️ AQUÍ SE EXIGÍA UNA REGIÓN `data-ol-calc` (2026-09-04). Era la 9ª
  // CONDUCTA, y las conductas se retiraron el 2026-08-23: desde entonces
  // ninguna de las cuatro superficies le nombra `data-ol-calc` al modelo — 0
  // apariciones en los cuatro prompts de producción, comprobado. O sea que la
  // comprobación pedía un marcador que el modelo NO PUEDE conocer, y no había
  // página capaz de pasarla. `quiz` la fallaba desde la línea base del
  // 2026-08-21 por esto, no por la página: el modelo construye el test con
  // JavaScript, que es lo que el contrato de hoy sí le pide, y funciona.
  //
  // Se sustituyó el 2026-09-04 por la PRUEBA QUE EL MODELO DECLARA, y ésa se
  // retiró entera el 2026-09-05. Las dos cayeron por la misma razón, escrita
  // dos veces con distinta letra: pedirle al modelo un vocabulario nuestro
  // —un marcador `data-ol-calc`, un JSON de promesas— y después medirlo por
  // cómo lo usa. Lo que queda midiendo aquí no le pide NADA al modelo: son
  // hechos del navegador sobre la página que escribió.

  return { id: m.id, failures, measurement: m };
}

/** ¿Falló ALGO de este caso? La portada o cualquiera de sus subpáginas.
 *
 *  Un caso con la portada impecable y `/servicios` desbordando NO está limpio:
 *  el usuario pagó una llamada y un crédito por esa página. */
export function caseClean(v: PageVerdict): boolean {
  return v.failures.length === 0 && (v.subpages ?? []).every((s) => s.failures.length === 0);
}

/** Lo que la corrida IMPRIME de un caso que falló: el peor de sus fallos, con
 *  su sitio y, si lo hay, su porqué.
 *
 *  Copiado de Claude Code, donde la
 *  columna NOTES de la tabla es exactamente esto:
 *
 *      return `${peor.name}: ${peor.explanation}`;
 *
 *  UNO, no la lista: la fila tiene que caber y el que más pesa es el que hay
 *  que mirar. Ellos tienen `weight` porque cada caso escribe sus propios
 *  graders en markdown; nuestros diez códigos son fijos y universales, así que
 *  el peso es el ORDEN de `FAILURE_CODES` —que ya empieza por las
 *  catastróficas— en vez de una jerarquía inventada a ojo.
 *
 *  El SITIO sólo se escribe cuando el caso tiene subpáginas: en los diecisiete
 *  de una sola página no hay ambigüedad que resolver y "portada:" sería ruido.
 */
export function worstFailure(v: PageVerdict): string | null {
  interface Candidato {
    readonly code: FailureCode;
    readonly slug: string | null;
    readonly m: PageMeasurement;
  }
  // La portada primero, para que un empate lo gane ella.
  const candidatos: Candidato[] = [
    ...v.failures.map((code) => ({ code, slug: null, m: v.measurement })),
    ...(v.subpages ?? []).flatMap((sp) =>
      sp.failures.map((code) => ({ code, slug: sp.slug, m: sp.measurement })),
    ),
  ];
  if (candidatos.length === 0) return null;
  const peso = (c: Candidato) => FAILURE_CODES.indexOf(c.code);
  const { code, slug, m } = candidatos.reduce((a, b) => (peso(b) < peso(a) ? b : a));
  const donde = v.subpages === undefined ? "" : slug === null ? "portada: " : `/${slug}: `;
  // El «explanation» de Claude Code. Sólo `enlace` sabe hoy decir cuál fue.
  const porque = code === "enlace" && m.deadAnchorWorst ? ` → ${m.deadAnchorWorst}` : "";
  return `${donde}${code}${porque}`;
}

/** QUÉ BRAZO FUE una corrida: la postura y el recorte con que se lanzó.
 *
 *  🔴 Va DENTRO del marcador, no sólo en su nombre. Los brazos de un
 *  experimento se comparan entre sí, y un fichero que sabe qué brazo es sólo por
 *  cómo se llama deja de saberlo en cuanto alguien lo renombra, lo copia o lo
 *  pega en un informe. Los `null` se escriben: «sin postura» es un dato —el
 *  control—, no un campo que falta. */
export interface BrazoDeCorrida {
  /** `null` = sin postura: el esfuerzo lo pone la tabla de política (control). */
  readonly esfuerzo: EsfuerzoAgente | null;
  /** `null` = sin fijar: quién escribe lo decide la imagen, que es lo que corre
   *  producción. Un papel = el brazo de la comparación entre escritores.
   *
   *  🔴 VA EN EL BRAZO, y no es cosmético: el nombre del marcador se deriva de
   *  aquí (`descriptorDeBrazo`). Sin este campo las dos mitades de la
   *  comparación producirían el MISMO descriptor y no habría forma de saber
   *  cuál era cuál — que es la forma del fallo que perdió el brazo de control
   *  del experimento de esfuerzo. */
  readonly escritor?: string | null;
  readonly tag: string | null;
  readonly solo: readonly string[] | null;
  /** Muestras por caso; 1 = una sola. */
  readonly repeat: number;
}

export interface Scorecard {
  readonly cohortVersion: string;
  readonly revision: string;
  readonly at: string;
  /** Ausente en los marcadores anteriores al 2026-09-13, que no lo guardaban. */
  readonly brazo?: BrazoDeCorrida;
  readonly pages: number;
  readonly clean: number;
  /** Cuántos CASOS fallaron por cada código. Un caso puede sumar en varios, y
   *  suma UNA vez por código aunque el fallo salga en la portada y en dos
   *  subpáginas: el denominador sigue siendo `pages`, que son las filas. */
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
  /** Obligatorio al construir: todo marcador NUEVO dice qué brazo es. */
  brazo: BrazoDeCorrida;
  verdicts: readonly PageVerdict[];
  costMxn: number;
  partial?: boolean;
}): Scorecard {
  const byCode: Record<string, number> = {};
  for (const v of input.verdicts) {
    const codigos = new Set<FailureCode>(v.failures);
    for (const sp of v.subpages ?? []) for (const f of sp.failures) codigos.add(f);
    for (const f of codigos) byCode[f] = (byCode[f] ?? 0) + 1;
  }
  return {
    cohortVersion: input.cohortVersion,
    revision: input.revision,
    at: input.at,
    brazo: input.brazo,
    pages: input.verdicts.length,
    clean: input.verdicts.filter(caseClean).length,
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
  const before = new Map(prev.verdicts.map((v) => [v.id, caseClean(v)]));
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
    const isClean = caseClean(v);
    if (wasClean) cleanBefore += 1;
    if (isClean) cleanNow += 1;
    if (wasClean && !isClean) regressed.push(v.id);
    if (!wasClean && isClean) fixed.push(v.id);
  }
  if (shared === 0) return { regressed: [], fixed: [], delta: null, comparable: false };
  return { regressed, fixed, delta: cleanNow - cleanBefore, comparable: true };
}
