import { describe, expect, it, vi } from "vitest";
import { CreativeDirectionSchema, SkeletonAdaptationPlanSchema } from "./creative-contracts";
import { applyVisualRepairPlan } from "./apply-visual-repair";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";

const HTML = '<!doctype html><html><head></head><body><header data-openlen-role="header"></header><main><section data-openlen-role="hero"></section></main><footer data-openlen-role="footer"></footer></body></html>';
const PLAN = SkeletonAdaptationPlanSchema.parse({ schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets: [] });
const HASH = `sha256:${"a".repeat(64)}`;
const INVENTORY = { schemaVersion: "skeleton-inventory/1.0" as const, templateId: "fixture", availableTokens: [], styleHooks: [], assetSlots: [], structuralFingerprint: HASH };

describe("applyVisualRepairPlan", () => {
  it("runs inventory, compiler, assets, sanitizer, fingerprint, roles and render atomically", async () => {
    const order: string[] = [];
    const result = await applyVisualRepairPlan({ html: HTML, sourceId: "fixture", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), plan: PLAN }, {
      buildInventory: () => { order.push("inventory"); return INVENTORY; },
      compileIdentity: (input) => { order.push("compile"); expect(input.inventory).toBe(INVENTORY); return { ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }; },
      resolveAssets: async (input) => { order.push("assets"); return { ok: true, html: input.html, applied: 0, assigned: [] }; },
      sanitize: (html) => { order.push("sanitize"); return { html }; },
      fingerprint: () => { order.push("fingerprint"); return HASH; },
      technicalRender: async () => { order.push("render"); return true; },
    });
    expect(result).toMatchObject({ ok: true, structuralFingerprintBefore: HASH, structuralFingerprintAfter: HASH });
    expect(result.ok && result.html).not.toBe(HTML);
    expect(order).toEqual(["inventory", "compile", "assets", "sanitize", "fingerprint", "render"]);
  });

  it.each(["compile", "assets", "sanitize", "fingerprint", "render"])("returns no candidate on %s failure", async (stage) => {
    const result = await applyVisualRepairPlan({ html: HTML, sourceId: "fixture", direction: CreativeDirectionSchema.parse(COLORING_DIRECTION), plan: PLAN }, {
      buildInventory: () => INVENTORY,
      compileIdentity: () => stage === "compile" ? { ok: false, code: "invalid_input", message: "private" } : { ok: true, html: HTML.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] },
      resolveAssets: async (input) => stage === "assets" ? { ok: false, code: "required_asset_unavailable", slotIndex: 0 } : { ok: true, html: input.html, applied: 0, assigned: [] },
      sanitize: (html) => ({ html: stage === "sanitize" ? null : html }),
      fingerprint: () => stage === "fingerprint" ? `sha256:${"b".repeat(64)}` : HASH,
      technicalRender: vi.fn(async () => stage !== "render"),
    });
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty("html");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
