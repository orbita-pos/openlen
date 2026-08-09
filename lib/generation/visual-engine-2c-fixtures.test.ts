import { describe, expect, it } from "vitest";
import { buildSkeletonInventory } from "./skeleton-inventory";
import { VISUAL_ENGINE_2C_CASES } from "./visual-engine-2c-cohort";
import { buildVisualEngine2CDirection, buildVisualEngine2CFixtureHtml } from "./visual-engine-2c-fixtures";

describe("Visual Engine 2C synthetic fixtures", () => {
  it("renders recognizable, responsive and buildable pages for all 15 cases", () => {
    for (const row of VISUAL_ENGINE_2C_CASES) {
      const html = buildVisualEngine2CFixtureHtml(row);
      expect(html).toContain('<meta name="viewport"');
      expect(html).toContain("@media(max-width:700px)");
      expect(html).toContain('data-openlen-role="hero"');
      expect(html).toContain('class="visual-stage"');
      expect(html).not.toContain(">content_platform<");
      expect(html).not.toContain(">OpenLen synthetic pilot<");
      expect(() => buildSkeletonInventory(html, row.fixtureId)).not.toThrow();
      expect(() => buildVisualEngine2CDirection(row)).not.toThrow();
    }
  });

  it("keeps healthy fixtures clean and gives each repairable fixture one explicit visual defect", () => {
    for (const row of VISUAL_ENGINE_2C_CASES) {
      const html = buildVisualEngine2CFixtureHtml(row);
      if (row.class === "healthy_keep") expect(html).not.toContain("data-pilot-defect");
      if (row.class === "repairable") {
        expect(html).toContain(`data-pilot-defect="${row.issueCode}"`);
        expect(html.match(/data-pilot-defect=/g)).toHaveLength(1);
      }
      if (row.class === "nonrepairable_or_fallback") {
        expect(html).toContain('data-pilot-defect="nonrepairable"');
        expect(html).toContain("main{display:none!important}");
      }
    }
  });

  it("shows domain language and functional sections instead of taxonomy slugs", () => {
    const coloring = buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[0]!);
    expect(coloring).toMatch(/Color, play|Coloring pages|Mini games|Story studio/);
    const restaurant = buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[3]!);
    expect(restaurant).toMatch(/Seasonal table|Menu|Reserve|Visit us/);
    const developer = buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[8]!);
    expect(developer).toMatch(/Build, connect|Integrations|Developer flow/);
  });

  it("expresses repairable typography and geometry defects through compiler-owned tokens", () => {
    expect(buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[8]!)).toContain("--ol-text-scale:.18");
    expect(buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[9]!)).toContain("--ol-fg:#3B3D42");
    expect(buildVisualEngine2CFixtureHtml(VISUAL_ENGINE_2C_CASES[11]!)).toContain("--ol-r-scale:0");
  });
});
