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

export type AdvisoryReviewExit =
  | "accepted"
  | "rounds_exhausted"
  | "render_failed"
  | "critic_failed"
  | "repair_failed"
  | "repair_unchanged"
  | "repair_regressed";

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
  /** Por qué terminó el bucle. Sin esto, "se rindió en la ronda 1 de 3" no
   *  distingue un crítico caído de una reparación que empeoró la página, y son
   *  arreglos opuestos. */
  readonly exit: AdvisoryReviewExit;
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
  const unchanged = { candidate: input.candidate, reviewed: false, repaired: false, rounds: 0, accepted: false, exit: "render_failed" as AdvisoryReviewExit };

  let current = input.candidate;
  let reviewedAny = false;
  let repairedAny = false;
  let accepted = false;
  let rounds = 0;
  let exit: AdvisoryReviewExit = "rounds_exhausted";

  for (let round = 0; round < profile.reviewRounds; round += 1) {
    let baseline: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
    try { baseline = await deps.render(current.html); } catch { exit = "render_failed"; break; }
    if (!baseline) { exit = "render_failed"; break; }

    let verdict: Awaited<ReturnType<AdvisoryReviewDeps["review"]>>;
    try { verdict = await deps.review({ html: current.html, brief: input.brief }); } catch { exit = "critic_failed"; break; }
    if (!verdict.ok || typeof verdict.accepted !== "boolean" || !Array.isArray(verdict.issues)) { exit = "critic_failed"; break; }

    reviewedAny = true;
    rounds += 1;
    if (verdict.accepted) { accepted = true; exit = "accepted"; break; }

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
    } catch { exit = "repair_failed"; break; }
    if (!repair.changed) { exit = "repair_unchanged"; break; }

    // The repaired page must clear the same deterministic bar as the one it
    // replaces, or the previous last-known-good stands.
    let after: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
    try { after = await deps.render(repair.candidate.html); } catch { exit = "repair_regressed"; break; }
    if (!after || after.mobileOverflow || after.invalidGeometry) { exit = "repair_regressed"; break; }

    current = repair.candidate;
    repairedAny = true;
  }

  // El motivo real viaja también por la salida temprana: si no, un crítico
  // caído se reporta como un render caído y se investiga lo que no es.
  if (!reviewedAny) return { ...unchanged, exit };
  return { candidate: current, reviewed: true, repaired: repairedAny, rounds, accepted, exit };
}
