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

// ── barrido de fugas de plantilla ──────────────────────────────────────────
// El primer relleno deja copy de la plantilla a la vista; se dispara UNA
// segunda pasada, y solo se acepta si reduce las fugas.

const TPL_LEAKY = `<!doctype html><html><head><title>MORADA — Inmobiliaria</title></head><body>
  <h2>¿Por qué MORADA?</h2>
  <p>Selección curada esta temporada, visitada y fotografiada por nuestro equipo.</p>
</body></html>`;

/** Primer relleno pobre: se queda TODO el copy de la plantilla. */
const leakyFirst = async (): Promise<FillTemplateResult> => ({
  ok: true, filledHtml: TPL_LEAKY, appliedOps: 2, totalOps: 2,
  cascadeErrors: 0, finishReason: "stop", durationMs: 1, rawResponse: "",
});

const CLEAN = `<!doctype html><html><head><title>Residencias Monterrey</title></head><body>
  <h2>¿Por qué Residencias Monterrey?</h2>
  <p>Casas de autor en San Pedro, cada una verificada por nuestro equipo local.</p>
</body></html>`;

describe("fillAssembled — parche de copy heredado", () => {
  it("el relleno se pide SIEMPRE en modo clonado", async () => {
    let sawFlag: boolean | undefined;
    const fillFn = async (input: { clonedTemplate?: boolean }) => {
      sawFlag = input.clonedTemplate;
      return okFill();
    };
    await fillAssembled(STITCHED, FULL_COPY, { fillFn: fillFn as never });
    expect(sawFlag).toBe(true);
  });

  it("no gasta la llamada del parche cuando no hay fuga", async () => {
    let patches = 0;
    const r = await fillAssembled(STITCHED, FULL_COPY, {
      fillFn: okFill,
      patchFn: async () => { patches++; return ""; },
    });
    expect(patches).toBe(0);
    expect(r.leaksBefore).toBe(0);
  });

  it("parchea la fuga y la cuenta baja", async () => {
    let patches = 0;
    const r = await fillAssembled(TPL_LEAKY, FULL_COPY, {
      fillFn: leakyFirst,
      patchFn: async (prompt) => {
        patches++;
        const ids = [...prompt.matchAll(/<element id="([^"]+)"/g)].map((m) => m[1]);
        return `<edits>${ids
          .map((id, i) => `<edit op="replace" target="${id}"><new><p>Copy propio de Residencias Monterrey número ${i}.</p></new></edit>`)
          .join("")}</edits>`;
      },
    });
    expect(patches).toBe(1);
    expect(r.leaksBefore).toBeGreaterThan(0);
    expect(r.leaksAfter).toBeLessThan(r.leaksBefore!);
    expect(r.html).toContain("Residencias Monterrey");
  });

  it("si el parche no mejora, se conserva la primera pasada", async () => {
    const r = await fillAssembled(TPL_LEAKY, FULL_COPY, {
      fillFn: leakyFirst,
      patchFn: async () => "<edits></edits>", // ninguna op válida
    });
    expect(r.html).toBe(TPL_LEAKY);
    expect(r.appliedOps).toBe(2); // no se suman ops descartadas
  });

  it("si el parche revienta, se conserva la primera pasada", async () => {
    const r = await fillAssembled(TPL_LEAKY, FULL_COPY, {
      fillFn: leakyFirst,
      patchFn: async () => { throw new Error("Gemini 503"); },
    });
    expect(r.filled).toBe(true);
    expect(r.html).toBe(TPL_LEAKY);
  });
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
