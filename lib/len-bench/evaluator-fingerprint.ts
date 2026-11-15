// lib/len-bench/evaluator-fingerprint.ts — THE EVALUATOR'S FINGERPRINT.
//
// Spec local 2026-11-12-len-3-1-ruta, §5 piece 5: «la huella del evaluador, que no deja correr si cambió sin
// aprobarlo». The 3.1 table compares two columns (2e05b6df1 and the candidate); they are comparable only if
// the same evaluator graded both — the same cases, graders, weights, judge and code. Claude Code's harness
// integrity gate is «a change detector, not a security boundary», and «never pass --approve-harness from an
// unattended round» (§3.1): so is this, and so is `--aprobar-evaluador`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Encargo } from "./tipos";

/** The code that grades and measures a run: its text is part of the evaluator. */
export const EVALUATOR_SOURCES: readonly string[] = [
  "lib/len-bench/graders.ts",
  "lib/len-bench/juez.ts",
  "lib/len-bench/puntuar.ts",
  "lib/len-bench/extraer.ts",
  "lib/len-bench/honestidad.ts",
  "lib/len-bench/pasos.ts",
  "lib/len-bench/steps-of-run.ts",
];

const EVALUATOR_FILE = "evaluador.json";

export interface GraderIdentity {
  readonly nombre: string;
  readonly peso: number;
  readonly puntua: boolean;
  /** The judge's criterion and focus (juez.ts); absent for a deterministic grader. */
  readonly criterio?: string;
  readonly foco?: string;
}

export interface EvaluatorParts {
  readonly caseIds: readonly string[];
  readonly graders: readonly GraderIdentity[];
  readonly judgeModel: string;
  readonly judgePrompt: string;
  readonly votes: number;
  /** The text of the code that grades (graders.ts, juez.ts, puntuar.ts…): a grader whose code changed
   *  between two columns is another evaluator. */
  readonly sources: readonly string[];
}

/** sha256 of the evaluator, 16 hex. The order of the cases does not count; everything else does. */
export function evaluatorFingerprint(p: EvaluatorParts): string {
  const canonical = JSON.stringify({
    caseIds: [...p.caseIds].sort(),
    graders: p.graders.map((g) => [g.nombre, g.peso, g.puntua, g.criterio ?? null, g.foco ?? null]),
    judgeModel: p.judgeModel,
    judgePrompt: p.judgePrompt,
    votes: p.votes,
    sources: p.sources,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** The evaluator of a suite, from its cases. Each grader is named with its case: the same grader in two cases
 *  counts twice, as it votes twice. */
export function evaluatorPartsOf(
  encargos: readonly Pick<Encargo, "id" | "graders">[],
  judge: { readonly model: string; readonly prompt: string; readonly votes: number },
  sources: readonly string[],
): EvaluatorParts {
  return {
    caseIds: encargos.map((e) => e.id),
    graders: encargos.flatMap((e) =>
      e.graders.map((g) => ({
        nombre: `${e.id}/${g.nombre}`,
        peso: g.peso,
        puntua: g.puntua !== false,
        ...(g.criterio !== undefined ? { criterio: g.criterio } : {}),
        ...(g.foco !== undefined ? { foco: g.foco } : {}),
      })),
    ),
    judgeModel: judge.model,
    judgePrompt: judge.prompt,
    votes: judge.votes,
    sources,
  };
}

/** Written when a column STARTS, so a column that dies half way still says who graded it. */
export function writeEvaluatorFile(dir: string, o: { readonly huella: string; readonly judgeModel: string; readonly cases: number }): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, EVALUATOR_FILE), JSON.stringify({ ...o, at: new Date().toISOString() }, null, 2));
}

/** The fingerprint a column was graded with, or `undefined` if it has none. */
export function readEvaluatorFile(dir: string): string | undefined {
  const file = path.join(dir, EVALUATOR_FILE);
  if (!fs.existsSync(file)) return undefined;
  const huella = (JSON.parse(fs.readFileSync(file, "utf8")) as { huella?: unknown }).huella;
  return typeof huella === "string" ? huella : undefined;
}

/** Why a column may not be graded by this evaluator, or `null`. */
export function fingerprintProblem(o: { readonly expected?: string; readonly actual: string; readonly approved: boolean }): string | null {
  if (o.expected === undefined || o.expected === o.actual || o.approved) return null;
  return (
    `the evaluator changed (fingerprint ${o.expected} → ${o.actual}): the two columns would not be comparable. ` +
    `If the change is on purpose, a person runs it again with --aprobar-evaluador (never from an unattended run).`
  );
}
