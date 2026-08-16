import { describe, expect, it, vi } from "vitest";

import { passHtmlGate, type HtmlGateDeps, type HtmlGatePolicy } from "./document-gate";
import { describeBehaviorIssues, validateBehaviors } from "@/lib/behaviors/validate";
import type { BehaviorIssue } from "@/lib/behaviors/types";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";

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

  it("carries the raw behaviour issues on the refusal so a caller keeps its own prose", async () => {
    // ai-design and the Agent both put describeBehaviorIssues' Spanish prose
    // in front of the model. Once the gate owns the decision they can no
    // longer compute it — the canonical bytes it validated are not returned
    // on a refusal — and re-running normalize+meta in the caller to get them
    // back is the exact drift this gate exists to delete. So the refusal
    // carries the issues themselves: `detail` stays the bounded machine slug,
    // `issues` is what the human-facing sentence is built from.
    const result = await passHtmlGate(
      LIGHTBOX_MISSING_IMG_HTML,
      deps(),
      { ...BLOCKING_POLICY, render: false },
    );
    if (result.ok) throw new Error("expected a refusal");
    expect(result.issues).toBeDefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.behavior).toBe("lightbox");
    expect(describeBehaviorIssues(result.issues as BehaviorIssue[])).toBe(
      describeBehaviorIssues(validateBehaviors(ensurePageMeta(normalizeBornCanonical(LIGHTBOX_MISSING_IMG_HTML)))),
    );
  });

  it("hands back the behaviour issues it warned about, not just the slug", async () => {
    // Under behaviors:"warn" the document is kept, so the caller has to be
    // able to record WHAT was wrong and HOW MANY — the ingestion journal
    // stores a count. `warnings` is one bounded slug by design and cannot
    // carry that, and re-running validateBehaviors caller-side to recover it
    // is the drift this gate deletes. Symmetric with the refusal branch: if
    // the gate saw issues, it hands them back either way.
    const result = await passHtmlGate(
      LIGHTBOX_MISSING_IMG_HTML,
      deps(),
      { render: false, seal: true, behaviors: "warn" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.behavior).toBe("lightbox");
  });

  it("leaves issues absent on a clean document under warn", async () => {
    const result = await passHtmlGate(OK_HTML, deps(), { render: false, seal: true, behaviors: "warn" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.issues).toBeUndefined();
  });

  it("still reports what sanitization stripped when a LATER stage refuses", async () => {
    // A single Agent turn can lose a <script> AND carry a mis-wired conducta.
    // The behaviour refusal must not swallow the fact that the JS was
    // deleted, or the model fixes the conducta and resends the same doomed
    // script. Sanitize succeeded here — what it removed is true regardless of
    // which later stage said no.
    const result = await passHtmlGate(
      LIGHTBOX_MISSING_IMG_HTML,
      deps({
        sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 1, dangerousUrls: 0, iframes: 3, metaRefresh: 0 } }),
      }),
      { ...BLOCKING_POLICY, render: false },
    );
    if (result.ok) throw new Error("expected a refusal");
    expect(result.code).toBe("behaviors_invalid");
    expect(result.removed).toEqual({ scripts: 2, eventHandlers: 1, iframes: 3, dangerousUrls: 0 });
  });

  it("has no removed counters on a refusal that fires before sanitize runs", async () => {
    const result = await passHtmlGate(MARKED_HTML, deps(), { ...BLOCKING_POLICY, render: false });
    if (result.ok) throw new Error("expected a refusal");
    // The marker is refused before any pass that could rewrite it out of
    // sight, so there is nothing truthful to report here.
    expect(result.removed).toBeUndefined();
  });

  it("leaves issues absent on refusals that are not about behaviours", async () => {
    const marker = await passHtmlGate(MARKED_HTML, deps(), { ...BLOCKING_POLICY, render: false });
    if (marker.ok) throw new Error("expected a refusal");
    expect(marker.issues).toBeUndefined();

    const unsealed = await passHtmlGate(OK_HTML, deps({ seal: (html) => ({ html, sealed: false }) }), {
      ...BLOCKING_POLICY,
      render: false,
    });
    if (unsealed.ok) throw new Error("expected a refusal");
    expect(unsealed.issues).toBeUndefined();
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

  it("pins Task 1's choice: under seal:false render:true, the renderer receives the same unsealed bytes returned as html — no caller relies on this yet", async () => {
    const seal = vi.fn((html: string) => ({ html: `SEALED(${html})`, sealed: true }));
    let renderedWith: string | undefined;
    const render = vi.fn(async (html: string) => {
      renderedWith = html;
      return { mobileOverflow: false, invalidGeometry: false };
    });
    const result = await passHtmlGate(OK_HTML, deps({ seal, render }), { seal: false, render: true, behaviors: "block" });
    expect(seal).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(renderedWith).toBe(result.html);
    expect(renderedWith).not.toMatch(/^SEALED\(/);
  });

  describe("the beforeMeta / policy.meta seam", () => {
    it("stays byte-for-byte identical to today when neither beforeMeta nor policy.meta is supplied", async () => {
      // The exact chain the gate ran before this seam existed, computed
      // independently here rather than assumed.
      const expected = ensurePageMeta(normalizeBornCanonical(OK_HTML));
      const result = await passHtmlGate(OK_HTML, deps(), { ...BLOCKING_POLICY, render: false });
      expect(result).toMatchObject({ ok: true, html: expected });
    });

    it("runs beforeMeta on the normalized document, before ensurePageMeta, and forwards policy.meta", async () => {
      let sawNormalizedInput = false;
      const beforeMeta = vi.fn((html: string) => {
        // Proves beforeMeta receives normalizeBornCanonical's output, not the
        // raw sanitized bytes — the exact slot seedBrandIntoHtml occupies.
        sawNormalizedInput = html.includes("data-ol-radius");
        return html.replace("<section>hola</section>", '<section data-seeded="1">hola</section>');
      });
      const result = await passHtmlGate(OK_HTML, deps({ beforeMeta }), {
        render: false,
        seal: false,
        behaviors: "block",
        meta: { title: "Mi Negocio" },
      });
      expect(beforeMeta).toHaveBeenCalledTimes(1);
      expect(sawNormalizedInput).toBe(true);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // beforeMeta's injection survived into the final document...
      expect(result.html).toContain('data-seeded="1"');
      // ...and ensurePageMeta ran AFTER it, honoring policy.meta's title.
      expect(result.html).toMatch(/<title>Mi Negocio<\/title>/);
    });

    it("refuses reserved_marker when beforeMeta introduces the marker, even though the input never carried it", async () => {
      const sanitize = vi.fn((html: string) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }));
      const beforeMeta = (html: string) => `${html}<div data-slot-path="injected">x</div>`;
      const result = await passHtmlGate(OK_HTML, deps({ sanitize, beforeMeta }), BLOCKING_POLICY);
      expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
      // sanitize DID run — the input itself was clean; only beforeMeta's own
      // output carried the marker, so the gate's own re-check must be what
      // caught it, not deps.sanitize.
      expect(sanitize).toHaveBeenCalledTimes(1);
    });

    describe("a beforeMeta-introduced marker refuses under every policy combination", () => {
      const sealPolicies = [true, false] as const;
      const behaviorPolicies = ["block", "warn"] as const;
      const renderPolicies = [true, false] as const;

      for (const seal of sealPolicies) {
        for (const behaviors of behaviorPolicies) {
          for (const render of renderPolicies) {
            it(`seal=${seal} behaviors=${behaviors} render=${render}`, async () => {
              const beforeMeta = (html: string) => `${html}<div data-slot-path="injected">x</div>`;
              const testDeps: HtmlGateDeps = {
                sanitize: (html: string) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
                beforeMeta,
                ...(seal ? { seal: (html: string) => ({ html, sealed: true }) } : {}),
                ...(render ? { render: async () => ({ mobileOverflow: false, invalidGeometry: false }) } : {}),
              };
              const result = await passHtmlGate(OK_HTML, testDeps, { seal, behaviors, render });
              expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
            });
          }
        }
      }
    });
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
