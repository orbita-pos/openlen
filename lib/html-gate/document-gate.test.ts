import { describe, expect, it, vi } from "vitest";

import { passHtmlGate, type HtmlGateDeps, type HtmlGatePolicy } from "./document-gate";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";

const OK_HTML = "<!doctype html><html><head></head><body><section>hola</section></body></html>";
const MARKED_HTML = '<!doctype html><html><head></head><body><section data-slot-path="a">x</section></body></html>';

function deps(over: Partial<HtmlGateDeps> = {}): HtmlGateDeps {
  return {
    sanitize: (html) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    seal: (html) => ({ html, sealed: true }),
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    ...over,
  };
}

const FULL_POLICY: HtmlGatePolicy = { render: true, seal: true };

describe("passHtmlGate", () => {
  it("returns sealed html when every guarantee holds", async () => {
    await expect(passHtmlGate(OK_HTML, deps(), FULL_POLICY))
      .resolves.toMatchObject({ ok: true });
  });

  it("refuses the reserved editor marker before anything else runs", async () => {
    const sanitize = vi.fn();
    const result = await passHtmlGate(
      MARKED_HTML,
      deps({ sanitize: sanitize as never }),
      FULL_POLICY,
    );
    // The marker must never reach disk or the database, so it is refused
    // before any pass that could rewrite it out of sight.
    expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
    expect(sanitize).not.toHaveBeenCalled();
  });

  it("refuses a document sanitization cannot save", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ sanitize: () => ({ html: null, errors: ["x"], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }) }), FULL_POLICY))
      .resolves.toMatchObject({ ok: false, code: "sanitization_failed" });
  });

  it("refuses a document the sealer will not seal", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ seal: (html) => ({ html, sealed: false }) }), FULL_POLICY))
      .resolves.toMatchObject({ ok: false, code: "seal_failed" });
  });

  it("refuses a document that renders broken", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ render: async () => ({ mobileOverflow: true, invalidGeometry: false }) }), FULL_POLICY))
      .resolves.toMatchObject({ ok: false, code: "render_failed" });
  });

  it("skips the browser when the caller's policy says so", async () => {
    const render = vi.fn(async () => ({ mobileOverflow: true, invalidGeometry: true }));
    // An interactive edit cannot pay twenty seconds. The cheap invariants
    // still ran; only the expensive verification is deferred to publish.
    await expect(passHtmlGate(OK_HTML, deps({ render }), { ...FULL_POLICY, render: false }))
      .resolves.toMatchObject({ ok: true });
    expect(render).not.toHaveBeenCalled();
  });

  it("reports what sanitization stripped so a caller can warn the user", async () => {
    const result = await passHtmlGate(OK_HTML, deps({
      sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 1, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    }), { ...FULL_POLICY, render: false });
    expect(result).toMatchObject({ ok: true, removed: { scripts: 2, eventHandlers: 1 } });
  });

  it("normalizes and completes the head, which the Agent did and creation did not", async () => {
    const result = await passHtmlGate(
      "<!doctype html><html><head></head><body><section>hola</section></body></html>",
      deps(),
      { ...FULL_POLICY, render: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ensurePageMeta only adds metadata when the document is missing it, but
    // a document reaching the gate with an empty <head> always is — verified
    // directly against ensurePageMeta before writing this assertion.
    expect(result.html).toMatch(/<meta/i);
  });

  // ⚰️ Las pruebas de `behaviors` («block»/«warn», `behaviors_invalid`, las
  // `issues` y los `warnings`) se fueron con las conductas `data-ol-*`, el
  // 2026-10-04.

  it("still reports what sanitization stripped when a LATER stage refuses", async () => {
    // A later refusal must not swallow the fact that sanitize deleted
    // something, or the caller resends the same doomed markup. Sanitize
    // succeeded here — what it removed is true regardless of which later
    // stage said no (the seal, in this case).
    const result = await passHtmlGate(
      OK_HTML,
      deps({
        sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 1, dangerousUrls: 0, iframes: 3, metaRefresh: 0 } }),
        seal: (html) => ({ html, sealed: false }),
      }),
      { ...FULL_POLICY, render: false },
    );
    if (result.ok) throw new Error("expected a refusal");
    expect(result.code).toBe("seal_failed");
    expect(result.removed).toEqual({ scripts: 2, eventHandlers: 1, iframes: 3, dangerousUrls: 0 });
  });

  it("has no removed counters on a refusal that fires before sanitize runs", async () => {
    const result = await passHtmlGate(MARKED_HTML, deps(), { ...FULL_POLICY, render: false });
    if (result.ok) throw new Error("expected a refusal");
    // The marker is refused before any pass that could rewrite it out of
    // sight, so there is nothing truthful to report here.
    expect(result.removed).toBeUndefined();
  });

  it("returns the canonical html unsealed under seal:false and never calls the seal dep", async () => {
    const seal = vi.fn((html: string) => ({ html: `SEALED(${html})`, sealed: true }));
    const result = await passHtmlGate(OK_HTML, deps({ seal }), { render: false, seal: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seal).not.toHaveBeenCalled();
    expect(result.html).not.toMatch(/^SEALED\(/);
    expect(result.html).toMatch(/<section>hola<\/section>/);
  });

  it("refuses seal_failed/sealer_unavailable when the policy asks to seal but no sealer is wired", async () => {
    const { seal: _seal, ...withoutSeal } = deps();
    const result = await passHtmlGate(OK_HTML, withoutSeal, { render: false, seal: true });
    expect(result).toMatchObject({ ok: false, code: "seal_failed", detail: "sealer_unavailable" });
  });

  it("pins Task 1's choice: under seal:false render:true, the renderer receives the same unsealed bytes returned as html — no caller relies on this yet", async () => {
    const seal = vi.fn((html: string) => ({ html: `SEALED(${html})`, sealed: true }));
    let renderedWith: string | undefined;
    const render = vi.fn(async (html: string) => {
      renderedWith = html;
      return { mobileOverflow: false, invalidGeometry: false };
    });
    const result = await passHtmlGate(OK_HTML, deps({ seal, render }), { seal: false, render: true });
    expect(seal).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderedWith).toBe(result.html);
    expect(renderedWith).not.toMatch(/^SEALED\(/);
  });

  describe("the policy.meta seam", () => {
    it("stays byte-for-byte identical to today when policy.meta is not supplied", async () => {
      // The exact chain the gate runs, computed independently here rather
      // than assumed.
      const expected = ensurePageMeta(normalizeBornCanonical(OK_HTML));
      const result = await passHtmlGate(OK_HTML, deps(), { ...FULL_POLICY, render: false });
      expect(result).toMatchObject({ ok: true, html: expected });
    });

    it("forwards policy.meta to ensurePageMeta", async () => {
      const result = await passHtmlGate(OK_HTML, deps(), { render: false, seal: false, meta: { title: "Mi Negocio" } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.html).toMatch(/<title>Mi Negocio<\/title>/);
    });

    // ⚰️ Las de `beforeMeta` (la costura que corría entre normalizar y los
    // metadatos) se fueron con ella el 2026-10-04: su último usuario fue la
    // calculadora de `data-ol-calc`.
  });

  describe("the reserved marker refuses under every policy combination", () => {
    const sealPolicies = [true, false] as const;
    const renderPolicies = [true, false] as const;

    for (const seal of sealPolicies) {
      for (const render of renderPolicies) {
        it(`seal=${seal} render=${render}`, async () => {
          const sanitize = vi.fn();
          // Deps deliberately omit seal/render when the policy doesn't ask
          // for them, so a combination that skipped straight to the seal
          // or render dep (instead of refusing on the marker first) would
          // throw on a missing function rather than quietly pass.
          const testDeps: HtmlGateDeps = {
            sanitize: sanitize as never,
            ...(seal ? { seal: (html: string) => ({ html, sealed: true }) } : {}),
            ...(render ? { render: async () => ({ mobileOverflow: false, invalidGeometry: false }) } : {}),
          };
          const result = await passHtmlGate(MARKED_HTML, testDeps, { seal, render });
          expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
          expect(sanitize).not.toHaveBeenCalled();
        });
      }
    }
  });
});

/**
 * 🔴 LA CADENA BORN-CANONICAL, SEGÚN DE DÓNDE VENGA EL DOCUMENTO.
 *
 * Es la misma línea que ya separa `sanitize`: `sanitizeForPublish` para el
 * HTML ajeno, `gateReservedMarker` para el del modelo.
 *
 * AJENO —lo que pega el usuario, una plantilla, el autofill— se normaliza:
 * viene de fuera y los controles de Tema tienen que poder conducirlo.
 *
 * DEL MODELO, no. Decisión de Jesús (2026-09-04): el modelo decide sus
 * colores. La cadena le reescribía «radius, spacing, type scale, display
 * font, accent, background + text color» y su paleta sobre tokens `--ol-*`.
 */
describe("la cadena born-canonical se aplica segun la procedencia", () => {
  const CON_COLOR_PROPIO =
    "<!doctype html><html><head><style>:root{--marca:#c0392b}h1{color:#c0392b}</style></head>" +
    "<body><h1>Aurora</h1></body></html>";

  it("con normalize:false no le inyecta nuestros tokens al modelo", async () => {
    const out = await passHtmlGate(CON_COLOR_PROPIO, deps(), {
      ...FULL_POLICY,
      normalize: false,
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.html, "le reescribio el diseño sobre tokens --ol-").not.toContain("--ol-");
    expect(out.html, "le cambio el color de marca").toContain("#c0392b");
  });

  it("pero al HTML ajeno SI — es el brazo de control", async () => {
    // Sin esto, «no inyecta tokens» pasaria tambien si la cadena estuviera
    // rota o desconectada del todo, y la prueba de arriba no probaria nada.
    const out = await passHtmlGate(CON_COLOR_PROPIO, deps(), FULL_POLICY);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.html, "la cadena no corrio para el HTML ajeno").toContain("--ol-");
  });
});
