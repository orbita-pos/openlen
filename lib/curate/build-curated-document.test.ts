import { describe, expect, it, vi } from "vitest";

import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";
import { sanitizeForPublish } from "@/lib/html-engine";
import { seedBrandIntoHtml } from "@/lib/business-profiles/seed-html";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import {
  fillAndNormalizeCuratedTemplate,
  finalizeCuratedDocument,
} from "./build-curated-document";

const SOURCE = "<!doctype html><html><head><title>Old</title></head><body><main><h1>Template</h1></main></body></html>";
const FILLED = "<!doctype html><html><head><title>Old</title></head><body><main><h1>New copy</h1></main></body></html>";
const COPY = { business_name: "Paintbox" } as ExtractedBusinessData;
const PROFILE = {
  business_name: "Paintbox",
  brand: { accent: "#A855F7", logoUrl: null },
  contact: { email: "hello@example.test" },
} as BusinessProfileData;

describe("curated document construction", () => {
  it("preserves get, fill, normalize, seed, meta, and sanitize order", async () => {
    const order: string[] = [];

    const built = await fillAndNormalizeCuratedTemplate({
      templateId: "safe",
      copy: COPY,
      onTemplateLoaded: () => order.push("loaded"),
    }, {
      getTemplateHtml: async () => { order.push("get"); return SOURCE; },
      fillAssembled: async () => {
        order.push("fill");
        return {
          html: FILLED,
          filled: true,
          appliedOps: 4,
          usage: { inputTokens: 12, outputTokens: 8 },
          durationMs: 20,
          leaksBefore: 2,
          leaksAfter: 0,
        };
      },
      normalizeBornCanonical: (html) => { order.push("normalize"); return `${html}<!--normalized-->`; },
    });
    expect(built).toMatchObject({
      ok: true,
      templateHtml: SOURCE,
      normalizedHtml: `${FILLED}<!--normalized-->`,
      filled: true,
      appliedOps: 4,
      usage: { inputTokens: 12, outputTokens: 8 },
      leaksBefore: 2,
      leaksAfter: 0,
    });
    if (!built.ok) throw new Error("fixture build failed");

    const finalized = finalizeCuratedDocument({
      normalizedHtml: built.normalizedHtml,
      profileData: PROFILE,
      title: "Paintbox",
      brandRecolor: false,
    }, {
      seedBrandIntoHtml: (html, _profile, opts) => { order.push(`seed:${String(opts?.recolor)}`); return `${html}<!--seed-->`; },
      ensurePageMeta: (html) => { order.push("meta"); return `${html}<!--meta-->`; },
      sanitizeForPublish: (html) => {
        order.push("sanitize");
        const result = sanitizeForPublish(html);
        return { ...result, html: `${html}<!--safe-->` };
      },
    });

    expect(order).toEqual(["get", "loaded", "fill", "normalize", "seed:false", "meta", "sanitize"]);
    expect(finalized).toEqual({
      ok: true,
      html: `${FILLED}<!--normalized--><!--seed--><!--meta--><!--safe-->`,
    });
  });

  it("returns a typed unavailable-template failure without filling", async () => {
    const fill = vi.fn();
    await expect(fillAndNormalizeCuratedTemplate({ templateId: "missing", copy: COPY }, {
      getTemplateHtml: async () => null,
      fillAssembled: fill,
    })).resolves.toEqual({ ok: false, kind: "template-unavailable", templateId: "missing" });
    expect(fill).not.toHaveBeenCalled();
  });

  it("returns a typed failure when publish sanitization rejects the document", () => {
    const result = finalizeCuratedDocument({
      normalizedHtml: FILLED,
      profileData: PROFILE,
      title: "Paintbox",
      brandRecolor: true,
    }, { sanitizeForPublish: (html) => ({ ...sanitizeForPublish(html), html: null }) });

    expect(result).toEqual({ ok: false, kind: "editor-marker-leak" });
  });

  it("is byte-equivalent to the legacy off sequence with the same dependencies", async () => {
    const fillResult = {
      html: FILLED,
      filled: true,
      appliedOps: 1,
      usage: { inputTokens: 5, outputTokens: 3 },
      durationMs: 7,
      leaksBefore: 0,
      leaksAfter: 0,
    };
    const fill = vi.fn(async () => fillResult);

    const legacyNormalized = normalizeBornCanonical(fillResult.html);
    const legacyThemed = seedBrandIntoHtml(legacyNormalized, PROFILE);
    const legacyMeta = ensurePageMeta(legacyThemed, {
      title: "Paintbox",
      logoUrl: undefined,
      ogImage: undefined,
      replaceStaleMeta: true,
    });
    const legacy = sanitizeForPublish(legacyMeta).html;

    const built = await fillAndNormalizeCuratedTemplate({ templateId: "weighted", copy: COPY }, {
      getTemplateHtml: async () => SOURCE,
      fillAssembled: fill,
    });
    if (!built.ok) throw new Error("fixture build failed");
    const current = finalizeCuratedDocument({
      normalizedHtml: built.normalizedHtml,
      profileData: PROFILE,
      title: "Paintbox",
      brandRecolor: true,
    });

    expect(current).toEqual({ ok: true, html: legacy });
    expect(current.ok && current.html).toBe(legacy);
  });
});
