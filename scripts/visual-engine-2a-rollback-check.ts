import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import { planQuickVisualEngineRoute } from "@/lib/curate/quick-visual-engine";
import { finalizeCuratedDocument } from "@/lib/curate/build-curated-document";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";
import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import {
  buildRollbackEvidence,
  VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
} from "@/lib/generation/visual-engine-2a-eval";

function delivery(mode: "off" | "shadow") {
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
  return { plan, html: document.html };
}

async function main() {
  const unset = delivery("off");
  const off = delivery("off");
  const shadow = delivery("shadow");
  const evidence = buildRollbackEvidence({
    fixture: VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
    unset: unset.html,
    off: off.html,
    shadow: shadow.html,
    candidateJobs: shadow.plan.shadowTemplateId ? 1 : 0,
  });
  await writeJsonAtomic(join(process.cwd(), "scratch", "visual-engine-2a", "rollback-evidence.json"), evidence);
  console.log(JSON.stringify({ event: "visual_engine_2a_rollback", verified: true, fixtureSha256: evidence.fixtureSha256 }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2A rollback verification failed."); process.exitCode = 1; });
}
