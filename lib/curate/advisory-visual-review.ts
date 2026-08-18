import type { SafeCreativeCandidate } from "./creative-baseline";
import type { CreativeSessionResult } from "./deepseek-creative-session";
import { DEFAULT_PAGE_EFFORT, effortProfile, type PageEffort } from "./page-effort";

export interface AdvisoryReviewInput {
  readonly requestId: string;
  readonly brief: string;
  readonly candidate: SafeCreativeCandidate;
  /** Cuántos ciclos de crítica -> reparación compra el nivel elegido. */
  readonly effort?: PageEffort;
}

export interface AdvisoryReviewDeps {
  readonly render: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  readonly review: (input: { html: string; brief: string }) => Promise<{ ok: true; accepted: boolean; issues: readonly string[] } | { ok: false }>;
  /** `candidate` viaja en cada llamada y no se captura fuera: con varias
   *  rondas, la segunda reparación tiene que partir de la página que dejó la
   *  primera, o cada ronda deshace la anterior en silencio. */
  readonly repair: (input: {
    requestId: string;
    brief: string;
    issueSummary: string;
    maxTurns: number;
    candidate: SafeCreativeCandidate;
  }) => Promise<CreativeSessionResult>;
}

export interface AdvisoryReviewResult {
  readonly candidate: SafeCreativeCandidate;
  readonly reviewed: boolean;
  readonly repaired: boolean;
  /** Cuántos ciclos llegó a gastar. Sin esto, un nivel alto que se rindió en la
   *  primera ronda y uno que agotó las tres son el mismo resultado. */
  readonly rounds: number;
  /** Si el crítico llegó a firmar la página. Salir pronto porque aceptó es
   *  éxito; salir pronto porque algo se rompió, no — y sin este campo las dos
   *  salidas son idénticas. */
  readonly accepted: boolean;
}

/** Qwen advises; deterministic checks decide. Every branch here returns a
 * candidate — an advisory reviewer must never be able to cost a safe page.
 *
 * Varias rondas, no una: el crítico juzga la página que de verdad quedó
 * después de reparar, así que una reparación que rompió otra cosa se ve. Cada
 * ronda es una crítica más y, si hace falta, una reparación más; se sale en
 * cuanto el crítico acepta, así que un nivel caro sobre una página que ya está
 * bien cuesta exactamente lo mismo que uno barato. */
export async function runAdvisoryVisualReview(
  input: AdvisoryReviewInput,
  deps: AdvisoryReviewDeps,
): Promise<AdvisoryReviewResult> {
  const profile = effortProfile(input.effort ?? DEFAULT_PAGE_EFFORT);
  const unchanged = { candidate: input.candidate, reviewed: false, repaired: false, rounds: 0, accepted: false };

  let current = input.candidate;
  let reviewedAny = false;
  let repairedAny = false;
  let accepted = false;
  let rounds = 0;

  for (let round = 0; round < profile.reviewRounds; round += 1) {
    let baseline: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
    try { baseline = await deps.render(current.html); } catch { break; }
    if (!baseline) break;

    let verdict: Awaited<ReturnType<AdvisoryReviewDeps["review"]>>;
    try { verdict = await deps.review({ html: current.html, brief: input.brief }); } catch { break; }
    if (!verdict.ok || typeof verdict.accepted !== "boolean" || !Array.isArray(verdict.issues)) break;

    reviewedAny = true;
    rounds += 1;
    if (verdict.accepted) { accepted = true; break; }

    let repair: CreativeSessionResult;
    try {
      repair = await deps.repair({
        // Sin sufijo de ronda a propósito: aguas abajo este id ES el projectId
        // con el que se resuelven las imágenes, así que decorarlo mandaría las
        // fotos de la segunda ronda a un proyecto que no existe.
        requestId: input.requestId,
        brief: input.brief,
        issueSummary: verdict.issues.slice(0, 6).join("; ").slice(0, 600),
        maxTurns: profile.repairTurns,
        candidate: current,
      });
    } catch { break; }
    if (!repair.changed) break;

    // The repaired page must clear the same deterministic bar as the one it
    // replaces, or the previous last-known-good stands.
    let after: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
    try { after = await deps.render(repair.candidate.html); } catch { break; }
    if (!after || after.mobileOverflow || after.invalidGeometry) break;

    current = repair.candidate;
    repairedAny = true;
  }

  if (!reviewedAny) return unchanged;
  return { candidate: current, reviewed: true, repaired: repairedAny, rounds, accepted };
}
