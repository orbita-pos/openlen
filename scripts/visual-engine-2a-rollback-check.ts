import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  calculateQuickDeliveryCredits,
  commitQuickVisualEngineDocument,
  launchShadowSkeletonCandidate,
  planQuickVisualEngineRoute,
} from "@/lib/curate/quick-visual-engine";
import { finalizeCuratedDocument } from "@/lib/curate/build-curated-document";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";
import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import { visualEngineMode } from "@/lib/generation/visual-engine-mode";
import {
  buildRollbackEvidence,
  captureVisualEngine2ARollbackModes,
  VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
} from "@/lib/generation/visual-engine-2a-eval";

async function delivery() {
  const mode = visualEngineMode();
  const safeResult = mode === "shadow" ? ({
    ok: true as const,
    intent: {} as never,
    decision: { route: "template_skeleton" as const, templateId: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE.skeletonTemplateId, reasonCodes: [] },
    ranked: [], promptVersion: "intent-prompt/1.5" as const, policyVersion: "generation-decision/1.0" as const,
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
  let pilotCalls = 0;
  let candidateJobs = 0;
  await launchShadowSkeletonCandidate(plan.shadowTemplateId ? ({
    mode: "shadow",
    candidateTemplateId: plan.shadowTemplateId,
    fallbackTemplateId: plan.delivery.templateId,
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
      pilotCalls += 1; candidateJobs += 1;
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
    completeVisualEnginePilotRun: async () => undefined,
    captureException: () => undefined,
  });
  const creditDelta = calculateQuickDeliveryCredits(
    { pickUsage: { inputTokens: 1, outputTokens: 1 }, filled: true },
    () => 2,
    1,
  );
  return {
    selectedTemplateId: plan.delivery.templateId,
    finalizedHtml: document.html,
    previewSequence,
    projectData,
    creditDelta,
    creativeCalls,
    pilotCalls,
    candidateJobs,
  };
}

async function main() {
  const { unset, off, shadow } = await captureVisualEngine2ARollbackModes(delivery);
  const evidence = buildRollbackEvidence({
    fixture: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
    unset, off, shadow,
  });
  await writeJsonAtomic(join(process.cwd(), "scratch", "visual-engine-2a", "rollback-evidence.json"), evidence);
  console.log(JSON.stringify({ event: "visual_engine_2a_rollback", verified: true, fixtureSha256: evidence.fixtureSha256 }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2A rollback verification failed."); process.exitCode = 1; });
}
