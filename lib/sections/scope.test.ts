import { describe, it, expect } from "vitest";
import { scopeSectionDocument, backfillRootSelfVariants } from "./scope";

// Regression: generated sections put a wrapper class (.sec / .lc07 / .hero…) on
// the ROOT <section> and key every rule off it. The pre-fix scoper turned those
// into pure descendant selectors (`[data-sec] .sec`) which never match the root
// itself → the wrapper's background + inherited text color silently dropped,
// leaving headings as default black on a dark surface.
describe("scopeSectionDocument — wrapper class on the root", () => {
  const doc = `<!doctype html><html><head><style>
      .sec{background:#0a0e14;color:#eaf1f6}
      .sec .title{font-weight:700}
      .soft{color:#888}
    </style></head><body>
      <section class="sec"><h1 class="title">Hi <span class="soft">there</span></h1></section>
    </body></html>`;

  it("emits a root-or-self variant alongside the descendant one", () => {
    const { html } = scopeSectionDocument(doc, "hero-x");
    expect(html).toContain('[data-sec="hero-x"].sec'); // matches the root itself
    expect(html).toContain('[data-sec="hero-x"] .sec'); // still matches descendants
  });

  it("resolves rules nested under the wrapper class via the self variant", () => {
    const { html } = scopeSectionDocument(doc, "hero-x");
    expect(html).toContain('[data-sec="hero-x"].sec .title');
  });
});

describe("backfillRootSelfVariants — repairing already-scoped fragments", () => {
  it("adds the self variant to descendant-scoped wrapper rules", () => {
    const css = `[data-sec="logos-07"] .lc07{background:#0a0f0d;color:#e9f1ec}
[data-sec="logos-07"] .lc07 .eyebrow{color:#7d8d86}`;
    const out = backfillRootSelfVariants(css, "logos-07");
    expect(out).toContain('[data-sec="logos-07"].lc07'); // bare wrapper now hits root
    expect(out).toContain('[data-sec="logos-07"].lc07 .eyebrow'); // nested resolves
    expect(out).toContain('[data-sec="logos-07"] .lc07'); // original kept
  });

  it("is idempotent", () => {
    const once = backfillRootSelfVariants(`[data-sec="x"] .sec{color:#fff}`, "x");
    const twice = backfillRootSelfVariants(once, "x");
    expect(twice).toBe(once);
  });

  it("leaves direct-child and root forms untouched", () => {
    const css = `[data-sec="x"]{--a:1}
[data-sec="x"]>.child{color:red}`;
    const out = backfillRootSelfVariants(css, "x");
    expect(out).not.toContain('[data-sec="x"].child'); // no spurious self for `>` child
  });
});
