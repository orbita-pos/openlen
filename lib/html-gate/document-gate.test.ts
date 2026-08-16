import { describe, expect, it, vi } from "vitest";

import { passHtmlGate, type HtmlGateDeps, type HtmlGatePolicy } from "./document-gate";

const OK_HTML = "<!doctype html><html><head></head><body><section>hola</section></body></html>";
const MARKED_HTML = '<!doctype html><html><head></head><body><section data-slot-path="a">x</section></body></html>';
const LIGHTBOX_MISSING_IMG_HTML = '<!doctype html><html><head></head><body><a data-ol-lightbox href="https://images.openlen.com/x.jpg">no img here</a></body></html>';

function deps(over: Partial<HtmlGateDeps> = {}): HtmlGateDeps {
  return {
    sanitize: (html) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    seal: (html) => ({ html, sealed: true }),
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    ...over,
  };
}

const BLOCKING_POLICY: HtmlGatePolicy = { render: true, seal: true, behaviors: "block" };

describe("passHtmlGate", () => {
  it("returns sealed html when every guarantee holds", async () => {
    await expect(passHtmlGate(OK_HTML, deps(), BLOCKING_POLICY))
      .resolves.toMatchObject({ ok: true, warnings: [] });
  });

  it("refuses the reserved editor marker before anything else runs", async () => {
    const sanitize = vi.fn();
    const result = await passHtmlGate(
      MARKED_HTML,
      deps({ sanitize: sanitize as never }),
      BLOCKING_POLICY,
    );
    // The marker must never reach disk or the database, so it is refused
    // before any pass that could rewrite it out of sight.
    expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
    expect(sanitize).not.toHaveBeenCalled();
  });

  it("refuses a document sanitization cannot save", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ sanitize: () => ({ html: null, errors: ["x"], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }) }), BLOCKING_POLICY))
      .resolves.toMatchObject({ ok: false, code: "sanitization_failed" });
  });

  it("refuses a document the sealer will not seal", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ seal: (html) => ({ html, sealed: false }) }), BLOCKING_POLICY))
      .resolves.toMatchObject({ ok: false, code: "seal_failed" });
  });

  it("refuses a document that renders broken", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ render: async () => ({ mobileOverflow: true, invalidGeometry: false }) }), BLOCKING_POLICY))
      .resolves.toMatchObject({ ok: false, code: "render_failed" });
  });

  it("skips the browser when the caller's policy says so", async () => {
    const render = vi.fn(async () => ({ mobileOverflow: true, invalidGeometry: true }));
    // An interactive edit cannot pay twenty seconds. The cheap invariants
    // still ran; only the expensive verification is deferred to publish.
    await expect(passHtmlGate(OK_HTML, deps({ render }), { ...BLOCKING_POLICY, render: false }))
      .resolves.toMatchObject({ ok: true });
    expect(render).not.toHaveBeenCalled();
  });

  it("reports what sanitization stripped so a caller can warn the user", async () => {
    const result = await passHtmlGate(OK_HTML, deps({
      sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 1, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    }), { ...BLOCKING_POLICY, render: false });
    expect(result).toMatchObject({ ok: true, removed: { scripts: 2, eventHandlers: 1 } });
  });

  it("normalizes and completes the head, which the Agent did and creation did not", async () => {
    const result = await passHtmlGate(
      "<!doctype html><html><head></head><body><section>hola</section></body></html>",
      deps(),
      { ...BLOCKING_POLICY, render: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ensurePageMeta only adds metadata when the document is missing it, but
    // a document reaching the gate with an empty <head> always is — verified
    // directly against ensurePageMeta before writing this assertion.
    expect(result.html).toMatch(/<meta/i);
  });

  it("refuses a document whose behaviors do not validate under behaviors:\"block\"", async () => {
    // data-ol-behavior/data-ol-target (the brief's original fixture) isn't a
    // real marker — no registered behavior produces an issue from it. A
    // lightbox link missing its required <img> does: confirmed directly
    // against validateBehaviors before writing this test.
    const result = await passHtmlGate(
      LIGHTBOX_MISSING_IMG_HTML,
      deps(),
      { ...BLOCKING_POLICY, render: false },
    );
    expect(result).toMatchObject({ ok: false, code: "behaviors_invalid" });
    if (result.ok) return;
    // The reason must survive: a caller that only learns "invalid" cannot
    // tell the model what to change.
    expect(result.detail).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(result.detail).toBe("lightbox");
  });

  it("turns the same behaviour issue into a bounded warning under behaviors:\"warn\" instead of refusing", async () => {
    const result = await passHtmlGate(
      LIGHTBOX_MISSING_IMG_HTML,
      deps(),
      { render: false, seal: true, behaviors: "warn" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    // Bounded exactly like a refusal detail — no user-facing prose from
    // describeBehaviorIssues is allowed to leak into a machine-read reason.
    expect(result.warnings[0]).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(result.warnings[0]).toBe("lightbox");
  });

  it("returns the canonical html unsealed under seal:false and never calls the seal dep", async () => {
    const seal = vi.fn((html: string) => ({ html: `SEALED(${html})`, sealed: true }));
    const result = await passHtmlGate(OK_HTML, deps({ seal }), { render: false, seal: false, behaviors: "block" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seal).not.toHaveBeenCalled();
    expect(result.html).not.toMatch(/^SEALED\(/);
    expect(result.html).toMatch(/<section>hola<\/section>/);
  });

  it("refuses seal_failed/sealer_unavailable when the policy asks to seal but no sealer is wired", async () => {
    const { seal: _seal, ...withoutSeal } = deps();
    const result = await passHtmlGate(OK_HTML, withoutSeal, { render: false, seal: true, behaviors: "block" });
    expect(result).toMatchObject({ ok: false, code: "seal_failed", detail: "sealer_unavailable" });
  });

  describe("the reserved marker refuses under every policy combination", () => {
    const sealPolicies = [true, false] as const;
    const behaviorPolicies = ["block", "warn"] as const;
    const renderPolicies = [true, false] as const;

    for (const seal of sealPolicies) {
      for (const behaviors of behaviorPolicies) {
        for (const render of renderPolicies) {
          it(`seal=${seal} behaviors=${behaviors} render=${render}`, async () => {
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
            const result = await passHtmlGate(MARKED_HTML, testDeps, { seal, behaviors, render });
            expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
            expect(sanitize).not.toHaveBeenCalled();
          });
        }
      }
    }
  });
});
