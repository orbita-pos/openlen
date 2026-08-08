import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  canonicalJsonSha256,
  sha256,
  type VisualEngine2AEvidenceManifest,
} from "./visual-engine-2a-eval";

export type BlindSideDecision = "left" | "right" | "tie" | "invalid";
export type SemanticComparisonVerdict = "candidate" | "baseline" | "tie" | "invalid";

export interface ReviewEvidencePair {
  comparisonId: string;
  pilotRunId: string;
  baseline: { normal: string; neutral: string };
  candidate: { normal: string; neutral: string };
  hashes: {
    baseline: { normal: string; neutral: string };
    candidate: { normal: string; neutral: string };
  };
}

interface ReviewComparison {
  comparisonId: string;
  pilotRunId: string;
  left: "baseline" | "candidate";
  right: "baseline" | "candidate";
  evidence: ReviewEvidencePair;
}

export interface VisualEngine2AReviewDecision {
  comparisonId: string;
  decision: BlindSideDecision;
  verdict: SemanticComparisonVerdict;
  requiredSignalsPresent: boolean;
  forbiddenSignalsPresent: boolean;
  acceptedForbiddenSignalCount: number;
  note: string;
  decidedAt: string;
}

export interface VisualEngine2AReviewSession {
  schemaVersion: "visual-engine-2a-review-session/1.0";
  sourceSha256: string;
  comparisons: ReviewComparison[];
  decisions: VisualEngine2AReviewDecision[];
  completedAt: string | null;
}

function validSha(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

function safeEvidencePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || /[:?#]/.test(normalized)) {
    throw new Error("unsafe evidence path");
  }
  return normalized;
}

const EVIDENCE_MANIFEST_KEYS = [
  "baselineNeutralSha256", "baselineNormalSha256", "candidateNeutralSha256", "candidateNormalSha256",
  "caseId", "pilotRunId", "scenarioId", "schemaVersion",
] as const;

function parseEvidenceManifest(serialized: string): VisualEngine2AEvidenceManifest {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid evidence manifest");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).sort().join("\0") !== [...EVIDENCE_MANIFEST_KEYS].sort().join("\0")) {
    throw new Error("invalid evidence manifest fields");
  }
  if (object.schemaVersion !== "visual-engine-2a-evidence/1.0"
    || typeof object.caseId !== "string" || !object.caseId
    || typeof object.scenarioId !== "string" || !object.scenarioId
    || typeof object.pilotRunId !== "string" || !object.pilotRunId
    || typeof object.baselineNormalSha256 !== "string" || !validSha(object.baselineNormalSha256)
    || typeof object.baselineNeutralSha256 !== "string" || !validSha(object.baselineNeutralSha256)
    || typeof object.candidateNormalSha256 !== "string" || !validSha(object.candidateNormalSha256)
    || typeof object.candidateNeutralSha256 !== "string" || !validSha(object.candidateNeutralSha256)) {
    throw new Error("invalid evidence manifest");
  }
  return object as unknown as VisualEngine2AEvidenceManifest;
}

/** Loads one immutable source snapshot and rejects any path/content substitution before review. */
export async function loadVisualEngine2AReviewSource(root: string): Promise<{
  rows: ReviewEvidencePair[];
  sourceSha: string;
}> {
  const resolvedRoot = resolve(root);
  const entries = await readdir(resolvedRoot, { recursive: true, withFileTypes: true });
  const manifests = entries.filter((entry) => entry.isFile() && entry.name === "manifest.json");
  const descriptors: Array<{ directory: string; manifest: VisualEngine2AEvidenceManifest; evidenceHashes: string[] }> = [];
  const rows: ReviewEvidencePair[] = [];
  for (const entry of manifests) {
    const parent = resolve(entry.parentPath);
    const directory = relative(resolvedRoot, parent).replace(/\\/g, "/");
    if (!/^[a-f0-9]{64}$/.test(directory)) throw new Error("unsafe evidence directory");
    const manifest = parseEvidenceManifest(await readFile(resolve(parent, entry.name), "utf8"));
    const manifestDirectory = canonicalJsonSha256(manifest).slice("sha256:".length);
    if (directory !== manifestDirectory) throw new Error("evidence manifest directory hash mismatch");
    const assets = [
      ["baselineNormal", manifest.baselineNormalSha256],
      ["baselineNeutral", manifest.baselineNeutralSha256],
      ["candidateNormal", manifest.candidateNormalSha256],
      ["candidateNeutral", manifest.candidateNeutralSha256],
    ] as const;
    const actualHashes: string[] = [];
    for (const [name, expectedHash] of assets) {
      const actualHash = sha256(await readFile(resolve(parent, `${name}.jpg`)));
      if (actualHash !== expectedHash) throw new Error(`evidence hash mismatch: ${name}`);
      actualHashes.push(actualHash);
    }
    rows.push({
      comparisonId: sha256(`${manifest.caseId}/${manifest.scenarioId}`).slice("sha256:".length, "sha256:".length + 24),
      pilotRunId: manifest.pilotRunId,
      baseline: { normal: `${directory}/baselineNormal.jpg`, neutral: `${directory}/baselineNeutral.jpg` },
      candidate: { normal: `${directory}/candidateNormal.jpg`, neutral: `${directory}/candidateNeutral.jpg` },
      hashes: {
        baseline: { normal: manifest.baselineNormalSha256, neutral: manifest.baselineNeutralSha256 },
        candidate: { normal: manifest.candidateNormalSha256, neutral: manifest.candidateNeutralSha256 },
      },
    });
    descriptors.push({ directory, manifest, evidenceHashes: actualHashes });
  }
  rows.sort((left, right) => left.comparisonId.localeCompare(right.comparisonId));
  descriptors.sort((left, right) => left.directory.localeCompare(right.directory));
  return { rows, sourceSha: canonicalJsonSha256(descriptors) };
}

export function createVisualEngine2AReviewSession(
  sourceSha256: string,
  source: readonly ReviewEvidencePair[],
  random: () => number = Math.random,
): VisualEngine2AReviewSession {
  if (!validSha(sourceSha256)) throw new Error("invalid source SHA");
  const ids = new Set<string>();
  const comparisons = source.map((row): ReviewComparison => {
    if (!row.comparisonId || ids.has(row.comparisonId)) throw new Error("duplicate comparison ID");
    ids.add(row.comparisonId);
    const evidence: ReviewEvidencePair = {
      comparisonId: row.comparisonId,
      pilotRunId: row.pilotRunId,
      baseline: { normal: safeEvidencePath(row.baseline.normal), neutral: safeEvidencePath(row.baseline.neutral) },
      candidate: { normal: safeEvidencePath(row.candidate.normal), neutral: safeEvidencePath(row.candidate.neutral) },
      hashes: structuredClone(row.hashes),
    };
    for (const hash of [evidence.hashes.baseline.normal, evidence.hashes.baseline.neutral, evidence.hashes.candidate.normal, evidence.hashes.candidate.neutral]) {
      if (!validSha(hash)) throw new Error("invalid evidence hash");
    }
    const candidateOnLeft = random() >= 0.5;
    return {
      comparisonId: row.comparisonId,
      pilotRunId: row.pilotRunId,
      left: candidateOnLeft ? "candidate" : "baseline",
      right: candidateOnLeft ? "baseline" : "candidate",
      evidence,
    };
  });
  return {
    schemaVersion: "visual-engine-2a-review-session/1.0",
    sourceSha256,
    comparisons,
    decisions: [],
    completedAt: null,
  };
}

export function resumeVisualEngine2AReviewSession(
  session: VisualEngine2AReviewSession,
  sourceSha256: string,
  source: readonly ReviewEvidencePair[],
): VisualEngine2AReviewSession {
  if (!validSha(sourceSha256) || session.sourceSha256 !== sourceSha256) {
    throw new Error("review source SHA mismatch");
  }
  if (session.schemaVersion !== "visual-engine-2a-review-session/1.0" || session.comparisons.length !== source.length) {
    throw new Error("review source/session mismatch");
  }
  const expected = new Map(source.map((row) => [row.comparisonId, row]));
  const seen = new Set<string>();
  for (const comparison of session.comparisons) {
    const row = expected.get(comparison.comparisonId);
    if (!row || seen.has(comparison.comparisonId)
      || comparison.pilotRunId !== row.pilotRunId
      || canonicalJsonSha256(comparison.evidence) !== canonicalJsonSha256(row)
      || comparison.left === comparison.right
      || ![comparison.left, comparison.right].includes("baseline")
      || ![comparison.left, comparison.right].includes("candidate")) {
      throw new Error("review evidence/source mismatch");
    }
    seen.add(comparison.comparisonId);
  }
  return structuredClone(session);
}

export interface BlindDecisionCommand {
  comparisonId: string;
  decision: BlindSideDecision;
  requiredSignalsPresent: boolean;
  forbiddenSignalsPresent: boolean;
  note: string;
}

function normalizeCommand(command: BlindDecisionCommand): BlindDecisionCommand {
  if (!["left", "right", "tie", "invalid"].includes(command.decision)) throw new Error("invalid decision");
  const note = command.note.trim();
  if (!note || note.length > 200 || /[\r\n]/.test(note)) throw new Error("note must be one short line");
  if (typeof command.requiredSignalsPresent !== "boolean" || typeof command.forbiddenSignalsPresent !== "boolean") {
    throw new Error("signal checks are required");
  }
  return { ...command, note };
}

function sameCommand(existing: VisualEngine2AReviewDecision, command: BlindDecisionCommand): boolean {
  return existing.comparisonId === command.comparisonId
    && existing.decision === command.decision
    && existing.requiredSignalsPresent === command.requiredSignalsPresent
    && existing.forbiddenSignalsPresent === command.forbiddenSignalsPresent
    && existing.note === command.note;
}

export function appendVisualEngine2ADecision(
  session: VisualEngine2AReviewSession,
  input: BlindDecisionCommand,
  decidedAt: string,
): VisualEngine2AReviewSession {
  if (session.completedAt !== null) throw new Error("review session is completed");
  const command = normalizeCommand(input);
  const comparison = session.comparisons.find((row) => row.comparisonId === command.comparisonId);
  if (!comparison) throw new Error("unknown comparison");
  const existing = session.decisions.find((row) => row.comparisonId === command.comparisonId);
  if (existing) {
    if (sameCommand(existing, command)) return structuredClone(session);
    throw new Error("comparison already decided");
  }
  if (!Number.isFinite(Date.parse(decidedAt))) throw new Error("invalid decision time");
  const verdict: SemanticComparisonVerdict = command.decision === "left"
    ? comparison.left
    : command.decision === "right" ? comparison.right : command.decision;
  return {
    ...structuredClone(session),
    decisions: [...session.decisions, {
      ...command,
      verdict,
      acceptedForbiddenSignalCount: command.forbiddenSignalsPresent && verdict === "candidate" ? 1 : 0,
      decidedAt,
    }],
  };
}

export function completeVisualEngine2AReview(
  session: VisualEngine2AReviewSession,
  completedAt: string,
): VisualEngine2AReviewSession {
  if (session.completedAt !== null) return structuredClone(session);
  if (session.decisions.length !== session.comparisons.length) throw new Error("review is incomplete");
  if (!Number.isFinite(Date.parse(completedAt))) throw new Error("invalid completion time");
  return { ...structuredClone(session), completedAt };
}

function evidenceUrl(comparisonId: string, side: "left" | "right", variant: "normal" | "neutral"): string {
  return `/evidence/${encodeURIComponent(comparisonId)}/${side}/${variant}`;
}

export interface BlindReviewDto {
  progress: { decided: number; total: number };
  current: null | {
    comparisonId: string;
    left: { normalUrl: string; neutralUrl: string };
    right: { normalUrl: string; neutralUrl: string };
  };
  complete: boolean;
}

export function buildBlindReviewDto(session: VisualEngine2AReviewSession): BlindReviewDto {
  const decided = new Set(session.decisions.map((row) => row.comparisonId));
  const current = session.comparisons.find((row) => !decided.has(row.comparisonId));
  const side = (comparison: ReviewComparison, name: "left" | "right") => {
    return {
      normalUrl: evidenceUrl(comparison.comparisonId, name, "normal"),
      neutralUrl: evidenceUrl(comparison.comparisonId, name, "neutral"),
    };
  };
  return {
    progress: { decided: session.decisions.length, total: session.comparisons.length },
    current: current ? {
      comparisonId: current.comparisonId,
      left: side(current, "left"),
      right: side(current, "right"),
    } : null,
    complete: session.completedAt !== null,
  };
}

/** Server-only mapping from opaque browser route to an internal relative evidence path. */
export function resolveBlindEvidencePath(
  session: VisualEngine2AReviewSession,
  comparisonId: string,
  side: "left" | "right",
  kind: "normal" | "neutral",
): { path: string; sha256: string } | null {
  const comparison = session.comparisons.find((row) => row.comparisonId === comparisonId);
  if (!comparison) return null;
  const semanticSide = comparison[side];
  return {
    path: comparison.evidence[semanticSide][kind],
    sha256: comparison.evidence.hashes[semanticSide][kind],
  };
}

export async function persistVisualEngine2AReviewSession(
  path: string,
  session: VisualEngine2AReviewSession,
): Promise<void> {
  await writeJsonAtomic(path, session);
}
