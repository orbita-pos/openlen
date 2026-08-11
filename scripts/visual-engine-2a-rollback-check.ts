import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  calculateQuickDeliveryCredits,
  commitQuickVisualEngineDocument,
  launchShadowSkeletonCandidate,
  planQuickVisualEngineRoute,
} from "@/lib/curate/quick-visual-engine";
import { launchShadowVisualRepair, runQuickVisualRepair } from "@/lib/curate/quick-visual-repair";
import { finalizeCuratedDocument } from "@/lib/curate/build-curated-document";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";
import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import { visualEngineMode } from "@/lib/generation/visual-engine-mode";
import { visualRepairMode } from "@/lib/generation/visual-repair-mode";
import {
  buildRollbackEvidence,
  canonicalJsonSha256,
  captureVisualEngineRollbackModes,
  VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
} from "@/lib/generation/visual-engine-2a-eval";

export interface VisualEngine2CRollbackState {
  html: string;
  visualEngine: unknown;
  repairCalls: number;
}

interface VisualEngine2CRollbackGroup<T> {
  unset: T; off: T; shadow: T; onAccepted: T; onRejected: T;
}

export interface VisualEngine2CRollbackMatrix<T = VisualEngine2CRollbackState> {
  off: VisualEngine2CRollbackGroup<T>;
  skeleton: VisualEngine2CRollbackGroup<T>;
  composition: VisualEngine2CRollbackGroup<T>;
}

export async function captureVisualEngine2CRollbackMatrix<T>(
  deliver: (acceptRepair: boolean) => Promise<T>,
): Promise<VisualEngine2CRollbackMatrix<T>> {
  const previousMain = process.env.OPENLEN_VISUAL_ENGINE;
  const previousRepair = process.env.OPENLEN_VISUAL_ENGINE_REPAIR;
  const captureGroup = async (main: "off" | "skeleton" | "composition"): Promise<VisualEngine2CRollbackGroup<T>> => {
    process.env.OPENLEN_VISUAL_ENGINE = main;
    delete process.env.OPENLEN_VISUAL_ENGINE_REPAIR;
    const unset = await deliver(false);
    process.env.OPENLEN_VISUAL_ENGINE_REPAIR = "off";
    const off = await deliver(false);
    process.env.OPENLEN_VISUAL_ENGINE_REPAIR = "shadow";
    const shadow = await deliver(false);
    process.env.OPENLEN_VISUAL_ENGINE_REPAIR = "on";
    const onAccepted = await deliver(true);
    const onRejected = await deliver(false);
    return { unset, off, shadow, onAccepted, onRejected };
  };
  try {
    return { off: await captureGroup("off"), skeleton: await captureGroup("skeleton"), composition: await captureGroup("composition") };
  } finally {
    if (previousMain === undefined) delete process.env.OPENLEN_VISUAL_ENGINE; else process.env.OPENLEN_VISUAL_ENGINE = previousMain;
    if (previousRepair === undefined) delete process.env.OPENLEN_VISUAL_ENGINE_REPAIR; else process.env.OPENLEN_VISUAL_ENGINE_REPAIR = previousRepair;
  }
}

function deliveryOnly(state: VisualEngine2CRollbackState) { return { html: state.html, visualEngine: state.visualEngine }; }

export function buildVisualEngine2CRollbackEvidence(matrix: VisualEngine2CRollbackMatrix): {
  schemaVersion: "visual-engine-2c-rollback/1.0"; matrixSha256: string; verified: true;
} {
  const same = (left: VisualEngine2CRollbackState, right: VisualEngine2CRollbackState) =>
    canonicalJsonSha256(deliveryOnly(left)) === canonicalJsonSha256(deliveryOnly(right));
  for (const group of [matrix.off, matrix.skeleton, matrix.composition]) {
    if (!same(group.unset, group.off) || group.unset.repairCalls !== 0 || group.off.repairCalls !== 0) throw new Error("Visual Engine 2C rollback verification failed");
  }
  if (![matrix.off.unset, matrix.off.off, matrix.off.shadow, matrix.off.onAccepted, matrix.off.onRejected]
      .every((state) => same(state, matrix.off.off) && state.repairCalls === 0)) throw new Error("Visual Engine 2C rollback verification failed");
  for (const group of [matrix.skeleton, matrix.composition]) {
    if (!same(group.shadow, group.off) || !same(group.onRejected, group.off)
      || group.shadow.repairCalls !== 1 || group.onRejected.repairCalls !== 1 || group.onAccepted.repairCalls !== 1
      || group.onAccepted.html === group.off.html) throw new Error("Visual Engine 2C rollback verification failed");
    const accepted = group.onAccepted.visualEngine as { repair?: { accepted?: unknown } };
    const { repair, ...acceptedBase } = accepted;
    if (repair?.accepted !== true || canonicalJsonSha256(acceptedBase) !== canonicalJsonSha256(group.off.visualEngine)) {
      throw new Error("Visual Engine 2C rollback verification failed");
    }
  }
  return { schemaVersion: "visual-engine-2c-rollback/1.0", matrixSha256: canonicalJsonSha256(matrix), verified: true };
}

export async function writeVisualEngine2ARollbackEvidence(evidence: unknown, cwd = process.cwd()): Promise<string> {
  const evidencePath = join(cwd, "scratch", "visual-engine-2a", "rollback-evidence.json");
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeJsonAtomic(evidencePath, evidence);
  return evidencePath;
}

async function delivery() {
  const mode = visualEngineMode();
  const safeResult = mode === "shadow" || mode === "skeleton" || mode === "composition" ? ({
    ok: true as const,
    intent: {} as never,
    decision: mode === "composition"
      ? { route: "section_composition" as const, reasonCodes: [] }
      : { route: "template_skeleton" as const, templateId: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.skeletonTemplateId, reasonCodes: [] },
    ranked: [], promptVersion: "intent-prompt/1.8" as const, policyVersion: "generation-decision/1.0" as const,
    modelId: "rollback-fixture", durationMs: 0,
  } as unknown as SafeSelectionResult) : null;
  const plan = planQuickVisualEngineRoute({
    mode,
    weightedTemplateId: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.weightedTemplateId,
    safeResult,
  });
  const document = finalizeCuratedDocument({
    normalizedHtml: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.normalizedHtml,
    profileData: normalizeProfileData({ business_name: "Rollback Fixture", links: [] }),
    title: "Rollback Fixture",
    brandRecolor: true,
  });
  if (!document.ok) throw new Error("rollback fixture finalization failed");
  const previewSequence: unknown[] = [];
  let projectData: unknown;
  await commitQuickVisualEngineDocument({ html: document.html }, {
    emitPreview: (html) => previewSequence.push({ type: "preview", html }),
    persist: async (data) => { projectData = structuredClone(data); },
  });
  let creativeCalls = 0;
  let pilotReserveCalls = 0;
  let pilotCompleteCalls = 0;
  let candidateJobs = 0;
  const shadowTemplateId = plan.shadowCandidate?.kind === "template_skeleton"
    ? plan.shadowCandidate.templateId
    : null;
  const deliveryTemplateId = plan.delivery.templateId
    ?? VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.weightedTemplateId;
  await launchShadowSkeletonCandidate(shadowTemplateId ? ({
    mode: "shadow",
    candidateTemplateId: shadowTemplateId,
    fallbackTemplateId: deliveryTemplateId,
    candidateTitle: "Rollback Candidate",
    fallbackTitle: "Rollback Fixture",
    copy: { business_name: "Rollback Fixture" } as never,
    profileData: normalizeProfileData({ business_name: "Rollback Fixture", links: [] }),
    intent: {} as never,
    templateMetadata: {} as never,
    policyVersion: "rollback-fixture/1",
  }) : null, {
    fillAndNormalizeCuratedTemplate: async ({ templateId }) => ({
      ok: true, templateId, templateHtml: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.normalizedHtml,
      normalizedHtml: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.normalizedHtml,
      filled: false, appliedOps: 0, durationMs: 0, leaksBefore: 0, leaksAfter: 0,
    }),
    reserveVisualEnginePilotRun: async () => {
      pilotReserveCalls += 1; candidateJobs += 1;
      return { ok: true, id: "rollback-isolated", ordinal: 1 };
    },
    adaptTemplateSkeleton: async () => {
      creativeCalls += 1;
      return {
        ok: true, status: "adapted", html: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.normalizedHtml,
        creativeDirectionVersion: "creative-direction/1.0", planVersion: "skeleton-adaptation-plan/1.0",
        creativeDirection: {} as never, promptVersion: "rollback-fixture/1", modelId: "rollback-fixture",
        structuralFingerprintBefore: "sha256:" + "a".repeat(64), structuralFingerprintAfter: "sha256:" + "a".repeat(64),
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 }, durationMs: 0,
      };
    },
    finalizeCuratedDocument: () => ({ ok: true, html: document.html }),
    completeVisualEnginePilotRun: async () => { pilotCompleteCalls += 1; },
    captureException: () => undefined,
  });
  const creditDelta = calculateQuickDeliveryCredits(
    { pickUsage: { inputTokens: 1, outputTokens: 1 }, filled: true },
    () => 2,
    1,
  );
  return {
    selectedTemplateId: deliveryTemplateId,
    finalizedHtml: document.html,
    previewSequence,
    projectData,
    creditDelta,
    creativeCalls,
    pilotReserveCalls,
    pilotCompleteCalls,
    candidateJobs,
    deliveryKind: plan.delivery.kind,
    shadowCandidateKind: plan.shadowCandidate?.kind ?? null,
  };
}

async function repairDelivery(acceptRepair: boolean): Promise<VisualEngine2CRollbackState> {
  const mainMode = visualEngineMode();
  const repairMode = visualRepairMode();
  const originalHtml = "<!doctype html><html><body><main data-openlen-role=\"hero\"><h1>Rollback 2C original</h1></main></body></html>";
  if (mainMode !== "skeleton" && mainMode !== "composition") {
    return { html: originalHtml, visualEngine: { route: "weighted" }, repairCalls: 0 };
  }
  const visualEngine = {
    schemaVersion: "visual-engine-project/1.0", route: mainMode === "skeleton" ? "template_skeleton" : "section_composition",
    templateId: mainMode === "skeleton" ? "rollback-skeleton" : null, creativeDirection: {},
    promptVersion: "rollback-fixture/1", policyVersion: "rollback-fixture/1", contractVersion: "creative-direction/1.0",
    structuralFingerprintBefore: "sha256:" + "a".repeat(64), structuralFingerprintAfter: "sha256:" + "a".repeat(64),
  } as never;
  const input = { html: originalHtml, visualEngine, intent: {} as never };
  let repairCalls = 0;
  const runRepair = async () => {
    repairCalls += 1;
    if (!acceptRepair) return { html: originalHtml, metadata: visualEngine, accepted: false as const, trace: { resultCode: "not_improved", usage: [] } };
    return {
      html: originalHtml.replace("original", "repaired"), metadata: visualEngine, accepted: true as const,
      trace: {
        resultCode: "accepted", usage: [], promptVersion: "visual-repair-prompt/1.1", criticVersion: "visual-quality-verdict/2.1" as const,
        issueCodesBefore: ["theme_mismatch" as const], issueCodesAfter: [],
        scoresBefore: { themeRecognition: 4, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 7, imageryRelevance: 6, briefAdherence: 4 },
        scoresAfter: { themeRecognition: 8, visualHierarchy: 8, componentCoherence: 8, mobileReadability: 8, imageryRelevance: 8, briefAdherence: 8 },
        outputHashBefore: "sha256:" + "b".repeat(64), outputHashAfter: "sha256:" + "c".repeat(64),
      },
    };
  };
  if (repairMode === "shadow") {
    await launchShadowVisualRepair(input, { runRepair: runRepair as never });
    return { html: originalHtml, visualEngine, repairCalls };
  }
  const result = await runQuickVisualRepair(input, { mode: repairMode, runRepair: runRepair as never, captureException: () => undefined });
  return { html: result.html, visualEngine: result.visualEngine, repairCalls };
}

async function main() {
  const { unset, off, shadow, skeleton, composition } = await captureVisualEngineRollbackModes(delivery);
  if (unset.deliveryKind !== "weighted" || off.deliveryKind !== "weighted"
    || shadow.deliveryKind !== "weighted" || shadow.shadowCandidateKind !== "template_skeleton"
    || skeleton.deliveryKind !== "template_skeleton" || skeleton.shadowCandidateKind !== null
    || composition.deliveryKind !== "section_composition" || composition.shadowCandidateKind !== null) {
    throw new Error("Visual Engine 2B rollback mode verification failed");
  }
  const evidence = buildRollbackEvidence({
    fixture: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
    unset, off, shadow,
  });
  const visualEngine2C = buildVisualEngine2CRollbackEvidence(await captureVisualEngine2CRollbackMatrix(repairDelivery));
  await writeVisualEngine2ARollbackEvidence({ ...evidence, visualEngine2C });
  console.log(JSON.stringify({ event: "visual_engine_2a_rollback", verified: true, fixtureSha256: evidence.fixtureSha256, visualEngine2CSha256: visualEngine2C.matrixSha256 }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2A rollback verification failed."); process.exitCode = 1; });
}
