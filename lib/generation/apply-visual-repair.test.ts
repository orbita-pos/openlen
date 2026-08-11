import { describe, expect, it, vi } from "vitest";
import { CreativeDirectionSchema, SkeletonAdaptationPlanSchema } from "./creative-contracts";
import { applyVisualRepairPlan } from "./apply-visual-repair";
import { COLORING_DIRECTION } from "./creative-fixtures.test-support";
import { VISUAL_ENGINE_2C_CASES } from "./visual-engine-2c-cohort";
import { buildVisualEngine2CDirection, buildVisualEngine2CFixtureHtml } from "./visual-engine-2c-fixtures";

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

  it("adds one fixed mobile containment preset for a validated mobile_overflow issue", async () => {
    const row = VISUAL_ENGINE_2C_CASES[10]!;
    const original = buildVisualEngine2CFixtureHtml(row);
    let rendered = "";
    const result = await applyVisualRepairPlan({
      html: original,
      sourceId: row.fixtureId,
      direction: buildVisualEngine2CDirection(row),
      plan: PLAN,
      issueCodes: ["mobile_overflow"],
    }, {
      technicalRender: async (html) => { rendered = html; return true; },
    });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.structuralFingerprintAfter).toBe(result.ok ? result.structuralFingerprintBefore : "");
    expect(rendered).toContain("@media(max-width:700px)");
    expect(rendered).toContain("body>:first-child{width:100%!important;max-width:100%!important");
    expect(rendered).toContain('[data-openlen-role="hero"],[data-openlen-role="features"]{grid-template-columns:minmax(0,1fr)!important');
    expect(rendered.match(/data-openlen-visual-engine=/g)).toHaveLength(1);
  });

  it.each([
    ["another issue", ["palette_mismatch"]],
    ["a case-variant lookalike", ["MOBILE_OVERFLOW"]],
  ])("does not add mobile containment for %s", async (_name, issueCodes) => {
    let compiledForAssets = "";
    const result = await applyVisualRepairPlan({
      html: HTML,
      sourceId: "fixture",
      direction: CreativeDirectionSchema.parse(COLORING_DIRECTION),
      plan: PLAN,
      issueCodes: issueCodes as never,
    }, {
      buildInventory: () => INVENTORY,
      compileIdentity: (input) => ({ ok: true, html: input.html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>'), tokens: {}, mode: "light", enforcedConstraints: [] }),
      resolveAssets: async (input) => { compiledForAssets = input.html; return { ok: true, html: input.html, applied: 0, assigned: [] }; },
      sanitize: (html) => ({ html }),
      fingerprint: () => HASH,
      technicalRender: async () => true,
    });
    expect(result).toMatchObject({ ok: true });
    expect(compiledForAssets).not.toContain("body>:first-child{width:100%!important");
  });
});
