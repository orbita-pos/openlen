import { describe, expect, it, vi } from "vitest";
import { CreativeDirectionSchema } from "@/lib/generation/creative-contracts";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import { COLORING_DIRECTION, COLORING_INTENT } from "@/lib/generation/creative-fixtures.test-support";
import { launchShadowVisualRepair, runQuickVisualRepair } from "./quick-visual-repair";

const direction = CreativeDirectionSchema.parse(COLORING_DIRECTION);
const intent = IntentAnalysisSchema.parse(COLORING_INTENT);
const visualEngine = {
  schemaVersion: "visual-engine-project/1.0" as const, route: "template_skeleton" as const, templateId: "fixture",
  creativeDirection: direction, promptVersion: "creative-prompt/1.0", policyVersion: "template-policy/1.0", contractVersion: "creative-direction/1.0" as const,
  structuralFingerprintBefore: `sha256:${"a".repeat(64)}`, structuralFingerprintAfter: `sha256:${"a".repeat(64)}`,
};
const input = { html: "<html>original</html>", visualEngine, intent, brandAccent: null };
const accepted = {
  html: "<html>repaired</html>", metadata: {}, accepted: true as const,
  trace: {
    resultCode: "accepted", promptVersion: "visual-repair-prompt/1.0", criticVersion: "visual-quality-verdict/2.0" as const,
    issueCodesBefore: ["palette_mismatch" as const], issueCodesAfter: [],
    scoresBefore: { themeRecognition: 5, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 6, briefAdherence: 5 },
    scoresAfter: { themeRecognition: 7, visualHierarchy: 7, componentCoherence: 7, mobileReadability: 8, imageryRelevance: 7, briefAdherence: 7 },
    outputHashBefore: `sha256:${"b".repeat(64)}`, outputHashAfter: `sha256:${"c".repeat(64)}`, usage: [],
  },
};

describe("quick visual repair", () => {
  it("off returns original references without invoking the loop", async () => {
    const runRepair = vi.fn();
    const result = await runQuickVisualRepair(input, { mode: "off", runRepair });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine); expect(runRepair).not.toHaveBeenCalled();
  });

  it("on persists only accepted redacted repair metadata", async () => {
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue(accepted) });
    expect(result.html).toBe(accepted.html);
    expect(result.visualEngine).not.toBe(visualEngine);
    expect(result.visualEngine.repair).toEqual({
      schemaVersion: "visual-repair-metadata/1.0", accepted: true, promptVersion: "visual-repair-prompt/1.0",
      criticVersion: "visual-quality-verdict/2.0", compilerVersion: "creative-direction/1.0",
      issueCodesBefore: ["palette_mismatch"], issueCodesAfter: [], scoresBefore: accepted.trace.scoresBefore,
      scoresAfter: accepted.trace.scoresAfter, outputHashBefore: accepted.trace.outputHashBefore, outputHashAfter: accepted.trace.outputHashAfter,
    });
    expect(JSON.stringify(result.visualEngine)).not.toMatch(/usage|explanation|dataBase64/i);
  });

  it("on failure preserves original HTML and metadata reference", async () => {
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockResolvedValue({ html: input.html, metadata: visualEngine, accepted: false, trace: { resultCode: "not_improved", usage: [] } }) });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine);
  });

  it("on catches unexpected dependency exceptions and preserves original references", async () => {
    const captureException = vi.fn();
    const result = await runQuickVisualRepair(input, { mode: "on", runRepair: vi.fn().mockRejectedValue(new Error("private")), captureException });
    expect(result.html).toBe(input.html); expect(result.visualEngine).toBe(visualEngine);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { route: "curate", stage: "visual-repair-on" });
    expect(JSON.stringify(captureException.mock.calls)).not.toContain("private");
  });

  it("shadow exposes no preview or persistence capability and catches internally", async () => {
    const runRepair = vi.fn().mockRejectedValue(new Error("private"));
    await expect(launchShadowVisualRepair(input, { runRepair, captureException: vi.fn() })).resolves.toBeUndefined();
    expect(runRepair).toHaveBeenCalledTimes(1);
    expect(runRepair.mock.calls[0]).toHaveLength(1);
  });
});
