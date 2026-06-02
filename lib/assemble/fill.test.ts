import { describe, it, expect } from "vitest";
import { fillAssembled, hasFillableCopy } from "./fill";
import type { ExtractedBusinessData } from "../style-match/autofill/types";
import type { FillTemplateResult } from "../style-match/autofill/fill-template";

const STITCHED = "<!doctype html><html><body><h1>Generic</h1></body></html>";

const FULL_COPY: ExtractedBusinessData = {
  business_name: "Helm",
  industry: "devtools",
  tagline_es: null,
  tagline_en: "Ship analytics your team trusts",
  pitch: "Governed metrics in under a second.",
  hero_keyword: "analytics",
  features: [{ title: "Realtime", desc: "Spans in under a second." }],
  pricing: [],
  testimonials: [],
  cta_primary: "Start free",
  cta_secondary: null,
  faq_questions: [],
  language_detected: "en",
};

const EMPTY_COPY: ExtractedBusinessData = {
  business_name: null,
  industry: null,
  tagline_es: null,
  tagline_en: null,
  pitch: null,
  hero_keyword: null,
  features: [],
  pricing: [],
  testimonials: [],
  cta_primary: null,
  cta_secondary: null,
  faq_questions: [],
  language_detected: null,
};

const okFill = async (): Promise<FillTemplateResult> => ({
  ok: true,
  filledHtml: "<!doctype html><html><body><h1>Helm</h1></body></html>",
  appliedOps: 5,
  totalOps: 5,
  cascadeErrors: 0,
  finishReason: "stop",
  durationMs: 1,
  rawResponse: "",
});

const errFill = async (): Promise<FillTemplateResult> => ({
  ok: false,
  error: { kind: "api", message: "Together 500" },
  durationMs: 1,
});

describe("hasFillableCopy", () => {
  it("true when the recipe invented real copy", () => {
    expect(hasFillableCopy(FULL_COPY)).toBe(true);
  });
  it("false for an all-null/empty copy", () => {
    expect(hasFillableCopy(EMPTY_COPY)).toBe(false);
  });
});

describe("fillAssembled", () => {
  it("returns the filled HTML when the model succeeds", async () => {
    const r = await fillAssembled(STITCHED, FULL_COPY, { fillFn: okFill });
    expect(r.filled).toBe(true);
    expect(r.appliedOps).toBe(5);
    expect(r.html).toContain("Helm");
  });

  it("degrades to the unfilled stitched page when the model errors", async () => {
    const r = await fillAssembled(STITCHED, FULL_COPY, { fillFn: errFill });
    expect(r.filled).toBe(false);
    expect(r.html).toBe(STITCHED); // coherent page still ships
    expect(r.reason).toContain("Together 500");
  });

  it("skips the fill (no model call) when there's no copy", async () => {
    let called = false;
    const spy = async (): Promise<FillTemplateResult> => {
      called = true;
      return okFill();
    };
    const r = await fillAssembled(STITCHED, EMPTY_COPY, { fillFn: spy });
    expect(called).toBe(false);
    expect(r.filled).toBe(false);
    expect(r.html).toBe(STITCHED);
  });
});
