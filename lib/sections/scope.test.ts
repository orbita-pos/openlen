import { describe, it, expect } from "vitest";
import {
  scopeSectionDocument,
  backfillRootSelfVariants,
  applyHostAdoption,
} from "./scope";

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

// Sections carry their own palette + standalone-document shell. applyHostAdoption
// makes them adopt the host page deterministically (bug 3) and drops the shell
// artifacts that produce a white block + nav overlap (bug 4).
describe("applyHostAdoption — host palette + shell neutralization", () => {
  const slug = "about-x";
  const tokenBlock = `[data-sec="${slug}"]{--accent:#4F46E5;--surface:#FFFFFF;--surface-2:#F5F5F2;--ink:#16161A;--ink-2:#5C5C68;--line:rgba(20,20,30,.10);--radius:20px}`;

  it("does NOT forward-remap the section's tokens (keeps authored literals)", () => {
    // Remapping --ink → host --fg inverted dark fills (a dark announcement bar
    // went white-on-white on a dark host). Tokens must keep their authored values.
    const out = applyHostAdoption(tokenBlock, slug);
    expect(out).toContain("--surface:#FFFFFF");
    expect(out).toContain("--ink:#16161A");
    expect(out).toContain("--accent:#4F46E5");
    expect(out).toContain("--radius:20px");
    expect(out).not.toMatch(/--surface:\s*var\(/);
    expect(out).not.toMatch(/--ink:\s*var\(/);
  });

  it("repairs a prior forward-remap by unwrapping it back to the literal", () => {
    const remapped = `[data-sec="${slug}"]{--surface:var(--bg, #FFFFFF);--ink:var(--fg, #16161A);--line:var(--border, rgba(20,20,30,.10));--accent:#4F46E5}`;
    const out = applyHostAdoption(remapped, slug);
    expect(out).toContain("--surface:#FFFFFF");
    expect(out).toContain("--ink:#16161A");
    expect(out).toContain("--line:rgba(20,20,30,.10)");
    expect(out).not.toContain("var(--bg");
    expect(out).not.toContain("var(--fg");
    expect(out).not.toContain("var(--border");
  });

  it("neutralizes a viewport-height preview shell on the root (bug 4)", () => {
    const css = `[data-sec="${slug}"]{margin:0;background:#f1f1f4;min-height:100vh;display:grid;place-items:center}`;
    const out = applyHostAdoption(css, slug);
    expect(out).not.toMatch(/min-height:\s*100vh/);
    expect(out).not.toContain("#f1f1f4"); // full-bleed gutter background dropped
    expect(out).not.toMatch(/place-items:\s*center/);
  });

  it("drops a light gutter background when the root is a body-reset (margin:0)", () => {
    const css = `[data-sec="${slug}"]{margin:0;background:#e9e9ee;padding:48px}`;
    const out = applyHostAdoption(css, slug);
    expect(out).not.toContain("#e9e9ee");
    expect(out).toContain("padding:48px"); // non-shell props preserved
  });

  it("keeps an intentional var-driven / non-light root background", () => {
    const css = `[data-sec="${slug}"]{margin:0;background:var(--surface)}`;
    const out = applyHostAdoption(css, slug);
    expect(out).toContain("background:var(--surface)");
  });

  it("de-sticks a page-level nav (z-index ≥ 20) but keeps low-z table sticky", () => {
    const css = `[data-sec="${slug}"] .nav-root{position:sticky;top:0;z-index:50}
[data-sec="${slug}"] .ptable thead th{position:sticky;top:0;z-index:3}`;
    const out = applyHostAdoption(css, slug);
    expect(out).toMatch(/\.nav-root\{[^}]*position:static/);
    expect(out).toMatch(/thead th\{[^}]*position:sticky/);
  });

  it("appends a scoped utility shim that beats a literal root background", () => {
    const out = applyHostAdoption(tokenBlock, slug);
    expect(out).toContain(`[data-sec="${slug}"].bg-surface, [data-sec="${slug}"] .bg-surface{background:var(--surface)}`);
    expect(out).toContain(`[data-sec="${slug}"].text-ink, [data-sec="${slug}"] .text-ink{color:var(--ink)}`);
  });

  it("is idempotent — re-running adds no second shim and no double-wrap", () => {
    const once = applyHostAdoption(tokenBlock, slug);
    const twice = applyHostAdoption(once, slug);
    expect(twice).toBe(once);
  });
});
