// In-memory quality metrics for the vision critic (Quality S3).
//
// Process-local counters, no DB — enough to tell us whether the regen
// threshold is calibrated once we have ~100 generations. Reset on restart;
// under multiple Next workers each keeps its own counters. That's fine: this
// is a calibration signal, not billing. If we ever want to mine verdicts for
// prompt tuning we'll add a table then (not speculatively now).

export interface QualityMetricsSnapshot {
  /** Generations that reached the critic stage (critic enabled + valid first
   *  pass). Includes runs where the critic fell back. */
  totalGens: number;
  /** Verdicts where shouldRegenerate was true (a regen fired). */
  regensTriggered: number;
  /** Regens that produced a valid page that shipped (vs fell back to the
   *  first pass). */
  regensSucceeded: number;
  /** Critic runs that returned the no-critique fallback (timeout / render
   *  miss / malformed verdict / API error). Surfaced so a high fallback rate
   *  doesn't masquerade as a healthy low regen rate. */
  criticFallbacks: number;
  /** regensTriggered / totalGens. Null until at least one gen is recorded. */
  regenRate: number | null;

  // ── Los OJOS DEL AGENTE (verify.ts) ──────────────────────────────────────
  //
  // Contador propio y NO `recordCriticRun`: aquélla mide el crítico de
  // CREACIÓN, y sus tasas (`regenRate`) se calculan sobre `totalGens`. Meter
  // aquí los turnos del Agente daría una tasa sobre una mezcla de dos
  // superficies, que es peor que no tener número.
  //
  // POR QUÉ HACEN FALTA: los ojos fallan ABIERTOS por diseño (sin Chrome, sin
  // key, timeout, JSON ilegible → veredicto "ok" con fallback=true). La ruta
  // del Agente sólo miraba `verdict.broken` y tiraba el flag, así que nada
  // dentro del producto distinguía «miré y está bien» de «no pude mirar». Con
  // Chrome caído en el box, la verificación aprobaba TODO en silencio y la
  // única forma de saberlo era grepear el journal.
  /** Turnos del Agente que llegaron a la verificación visual. */
  agentEyes: number;
  /** De ésos, los que NO pudieron mirar (render/API/timeout/parse). */
  agentEyesFallbacks: number;
  /** Los que sí miraron y vieron rotura objetiva. */
  agentEyesBroken: number;
  /** agentEyesFallbacks / agentEyes. Null hasta el primer turno verificado.
   *  Si esto se acerca a 1, los ojos están ciegos. */
  agentEyesFallbackRate: number | null;
}

interface Counters {
  totalGens: number;
  regensTriggered: number;
  regensSucceeded: number;
  criticFallbacks: number;
  agentEyes: number;
  agentEyesFallbacks: number;
  agentEyesBroken: number;
}

const counters: Counters = {
  totalGens: 0,
  regensTriggered: 0,
  regensSucceeded: 0,
  criticFallbacks: 0,
  agentEyes: 0,
  agentEyesFallbacks: 0,
  agentEyesBroken: 0,
};

/** Record one completed critic evaluation. */
export function recordCriticRun(opts: {
  shouldRegenerate: boolean;
  fallback: boolean;
}): void {
  counters.totalGens += 1;
  if (opts.fallback) counters.criticFallbacks += 1;
  if (opts.shouldRegenerate) counters.regensTriggered += 1;
}

/** Una verificación visual del Agente que terminó. `fallback` = no se pudo
 *  mirar; `broken` = se miró y había rotura objetiva. Los dos son excluyentes
 *  en la práctica, pero se cuentan por separado a propósito: un fallback NO es
 *  una página sana, y sumarlos escondería justo eso. */
export function recordAgentEyes(opts: { fallback: boolean; broken: boolean }): void {
  counters.agentEyes += 1;
  if (opts.fallback) counters.agentEyesFallbacks += 1;
  if (opts.broken) counters.agentEyesBroken += 1;
}

/** Record the outcome of a regen that fired — `succeeded` = a valid regen
 *  page shipped (false = fell back to the first pass). */
export function recordRegenOutcome(succeeded: boolean): void {
  if (succeeded) counters.regensSucceeded += 1;
}

export function getQualityMetrics(): QualityMetricsSnapshot {
  return {
    totalGens: counters.totalGens,
    regensTriggered: counters.regensTriggered,
    regensSucceeded: counters.regensSucceeded,
    criticFallbacks: counters.criticFallbacks,
    regenRate:
      counters.totalGens > 0
        ? counters.regensTriggered / counters.totalGens
        : null,
    agentEyes: counters.agentEyes,
    agentEyesFallbacks: counters.agentEyesFallbacks,
    agentEyesBroken: counters.agentEyesBroken,
    agentEyesFallbackRate:
      counters.agentEyes > 0 ? counters.agentEyesFallbacks / counters.agentEyes : null,
  };
}

/** Test-only reset. */
export function __resetQualityMetrics(): void {
  counters.totalGens = 0;
  counters.regensTriggered = 0;
  counters.regensSucceeded = 0;
  counters.criticFallbacks = 0;
  counters.agentEyes = 0;
  counters.agentEyesFallbacks = 0;
  counters.agentEyesBroken = 0;
}
