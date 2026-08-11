import { canonicalJsonSha256 } from "./visual-engine-2a-eval";
import { VISUAL_ENGINE_2C_CASES, type VisualEngine2CCase, type VisualEngine2CCaseClass } from "./visual-engine-2c-cohort";

export interface VisualEngine2CQualificationRow {
  caseId: string; route: VisualEngine2CCase["route"]; class: VisualEngine2CCaseClass;
  resultCode: VisualEngine2CCaseClass; inputHash: string; outputHash: string; callCeiling: 1 | 3;
}
export interface VisualEngine2CQualificationManifest {
  schemaVersion: "visual-engine-2c-qualification/1.0"; commitSha: string;
  criticVersion: "visual-quality-verdict/2.1"; repairVersion: "visual-repair-prompt/1.1";
  caseIds: string[]; rows: VisualEngine2CQualificationRow[];
  counts: { total: 15; keep: number; repairable: number; nonrepairable: number };
  manifestSha256: string;
}
export interface QualifyVisualEngine2CDeps {
  cases?: readonly VisualEngine2CCase[]; commitSha: string;
  evaluate: (row: VisualEngine2CCase) => Promise<{ resultCode: VisualEngine2CCaseClass; inputHash: string; outputHash: string }>;
}
const HASH = /^sha256:[a-f0-9]{64}$/;

export async function qualifyVisualEngine2CCohort(deps: QualifyVisualEngine2CDeps) {
  const cases = deps.cases ?? VISUAL_ENGINE_2C_CASES;
  if (cases.length !== 15 || !/^[a-f0-9]{40}$/i.test(deps.commitSha)) throw new Error("invalid_qualification_input");
  const rows: VisualEngine2CQualificationRow[] = [];
  for (const row of cases) {
    const evaluated = await deps.evaluate(row);
    rows.push({ caseId: row.id, route: row.route, class: row.class, resultCode: evaluated.resultCode, inputHash: evaluated.inputHash, outputHash: evaluated.outputHash, callCeiling: row.expectedCallCeiling });
  }
  const unsigned = {
    schemaVersion: "visual-engine-2c-qualification/1.0" as const, commitSha: deps.commitSha,
    criticVersion: "visual-quality-verdict/2.1" as const, repairVersion: "visual-repair-prompt/1.1" as const,
    caseIds: cases.map((row) => row.id), rows,
    counts: { total: 15 as const, keep: rows.filter((row) => row.class === "healthy_keep").length, repairable: rows.filter((row) => row.class === "repairable").length, nonrepairable: rows.filter((row) => row.class === "nonrepairable_or_fallback").length },
  };
  const manifest = { ...unsigned, manifestSha256: canonicalJsonSha256(unsigned) };
  const ok = rows.every((row, index) => row.resultCode === cases[index]!.class && HASH.test(row.inputHash) && HASH.test(row.outputHash))
    && unsigned.counts.keep === 6 && unsigned.counts.repairable === 6 && unsigned.counts.nonrepairable === 3;
  return { ok, manifest };
}

export function verifyVisualEngine2CQualification(manifest: VisualEngine2CQualificationManifest, current: { commitSha: string }): boolean {
  const { manifestSha256, ...unsigned } = manifest;
  return manifest.schemaVersion === "visual-engine-2c-qualification/1.0" && manifest.commitSha === current.commitSha
    && manifest.criticVersion === "visual-quality-verdict/2.1" && manifest.repairVersion === "visual-repair-prompt/1.1"
    && manifest.caseIds.length === 15 && manifest.rows.length === 15
    && manifest.caseIds.every((id, index) => id === VISUAL_ENGINE_2C_CASES[index]!.id)
    && manifest.rows.every((row, index) => row.caseId === manifest.caseIds[index] && row.resultCode === VISUAL_ENGINE_2C_CASES[index]!.class && HASH.test(row.inputHash) && HASH.test(row.outputHash))
    && manifest.counts.total === 15 && manifest.counts.keep === 6 && manifest.counts.repairable === 6 && manifest.counts.nonrepairable === 3
    && manifestSha256 === canonicalJsonSha256(unsigned);
}
