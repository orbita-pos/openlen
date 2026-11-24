// lib/len-bench/evaluator-fingerprint.ts — THE EVALUATOR'S FINGERPRINT.
//
// Spec local 2026-11-12-len-3-1-ruta, §5 piece 5: «la huella del evaluador, que no deja correr si cambió sin
// aprobarlo». The 3.1 table compares two columns (92f4f7e21 and the candidate); they are comparable only if
// the same evaluator graded both — the same cases, graders, weights, judge and code. Claude Code's harness
// integrity gate only detects changes and is no security boundary, and an unattended run never passes its
// approval (§3.1): so is this, and so is `--aprobar-evaluador`.
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
  // The simulated owner and the conductor decide what Len is told and when (review I7).
  "lib/len-bench/cliente-simulado.ts",
  "lib/len-bench/sesion.ts",
  "lib/len-bench/conductor.ts",
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
  /** What each case IS — the page it starts from, the owner's ficha, the script, what the run allows — by id
   *  (review I7): a customer case fetched again between two columns keeps its id and may change. */
  readonly caseContents?: Readonly<Record<string, string>>;
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
    caseContents: Object.entries(p.caseContents ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
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
  encargos: readonly Encargo[],
  judge: { readonly model: string; readonly prompt: string; readonly votes: number },
  sources: readonly string[],
): EvaluatorParts {
  return {
    caseIds: encargos.map((e) => e.id),
    caseContents: Object.fromEntries(encargos.map((e) => [e.id, caseContentHash(e)])),
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

/** What Len is given and allowed in a case, hashed: the starting page, the ficha, the script, publishing, the
 *  case's web, how it is born and the owner's zone. A regular expression in the case's web counts by its text. */
function caseContentHash(e: Encargo): string {
  const material = { inicio: e.inicio, ficha: e.ficha, guion: e.guion, publicaLen: e.publicaLen ?? false, web: e.web ?? null, naceComo: e.naceComo ?? null, zona: e.zona ?? null };
  const text = JSON.stringify(material, (_k, v: unknown) => (v instanceof RegExp ? v.toString() : v));
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
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
