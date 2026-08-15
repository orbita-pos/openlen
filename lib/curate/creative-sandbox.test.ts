import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { createCreativeSandbox, safeCreativeCss, safeCreativeUrl, type CreativeSandboxDeps } from "./creative-sandbox";

const BASE_HTML = `<!doctype html><html><head></head><body>
<header data-openlen-role="header" data-openlen-edit-id="ol-header-0"><a href="#top">Marca</a></header>
<section data-openlen-role="hero" data-openlen-edit-id="ol-hero-1"><h1>Hola</h1><a href="#cta">Empezar</a></section>
<section data-openlen-role="features" data-openlen-edit-id="ol-features-2"><h2>Qué hay</h2></section>
<footer data-openlen-role="footer" data-openlen-edit-id="ol-footer-3"><p>© Marca</p></footer>
</body></html>`;

const CANDIDATE: SafeCreativeCandidate = {
  html: BASE_HTML,
  title: "Marca",
  visualEngine: { schemaVersion: "visual-engine-project/1.0", route: "section_composition", templateId: null } as never,
  filled: true,
  appliedOps: 4,
  source: "baseline",
};

function makeDeps(over: Partial<CreativeSandboxDeps> = {}): CreativeSandboxDeps {
  return {
    sanitize: (html) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    seal: (html) => ({ html, sealed: true }) as never,
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    ...over,
  };
}

const REPLACE_HERO = {
  operations: [{
    op: "replace_section" as const,
    targetId: "ol-hero-1",
    html: '<section data-openlen-role="hero" data-openlen-edit-id="ol-hero-1"><h1>Nuevo hero</h1></section>',
  }],
};

describe("safeCreativeUrl", () => {
  it.each(["#top", "/precios", "./a", "../b", "https://x.com/a", "http://x.com", "mailto:a@b.com", "tel:+52551234"])(
    "keeps the ordinary user link %s", (url) => expect(safeCreativeUrl(url)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "vbscript:x",
    "file:///etc/passwd",
    "data:text/html,<script>x</script>",
    "//evil.com",
    "https://user:pass@x.com",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
  ])("rejects the executable or private target %s", (url) => expect(safeCreativeUrl(url)).toBe(false));
});

describe("safeCreativeCss", () => {
  it("allows the expressive CSS a distinctive page needs", () => {
    expect(safeCreativeCss(`
      @media (max-width: 700px) { .hero { grid-template-columns: 1fr } }
      @container (min-width: 40rem) { .card { gap: 1rem } }
      :root { --accent: #f06 }
      .hero { background: linear-gradient(135deg,#0f172a,#1e293b); transform: rotate(-2deg) }
      @keyframes drift { from { opacity: 0 } to { opacity: 1 } }
      .grain { animation: drift 2s ease-in-out infinite }
      svg .stroke { stroke: currentColor; stroke-width: 2 }
    `).ok).toBe(true);
  });

  it.each([
    ["@import", '@import url("https://evil.com/x.css"); .a{color:red}'],
    ["expression", ".a { width: expression(alert(1)) }"],
    ["javascript url", ".a { background: url(javascript:alert(1)) }"],
    ["executable data url", ".a { background: url(\"data:text/html,<script>x</script>\") }"],
    ["behavior", ".a { behavior: url(#default#time2) }"],
    ["moz-binding", ".a { -moz-binding: url(http://evil.com/x.xml#e) }"],
    ["unvalidated external url", ".a { background: url(https://evil.com/pixel.png) }"],
  ])("rejects %s", (_name, css) => expect(safeCreativeCss(css).ok).toBe(false));

  it("allows an external url that is already a validated asset", () => {
    expect(safeCreativeCss('.a{background:url("https://images.openlen.com/a.avif")}', ["https://images.openlen.com/a.avif"]).ok).toBe(true);
  });

  it("rejects CSS it cannot parse rather than passing it through", () => {
    expect(safeCreativeCss(".a { color: red").ok).toBe(false);
  });
});

describe("transactional creative sandbox", () => {
  it("exposes the outline and stable targets OpenLen owns", () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    const inspection = sandbox.inspect();
    expect(inspection.outline.map((entry) => entry.targetId)).toEqual(["ol-header-0", "ol-hero-1", "ol-features-2", "ol-footer-3"]);
    expect(inspection.outline[1]).toMatchObject({ role: "hero", tag: "section" });
  });

  it("replaces a section and makes the result the new last-known-good", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch(REPLACE_HERO)).resolves.toMatchObject({ ok: true });
    expect(sandbox.current().html).toContain("Nuevo hero");
    expect(sandbox.current().html).not.toContain("<h1>Hola</h1>");
    expect(sandbox.current().source).toBe("deepseek");
  });

  it.each([
    ["sanitization strips the document", makeDeps({ sanitize: () => ({ html: null, errors: ["slot path"], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }) }), "sanitization_failed"],
    ["the release will not seal", makeDeps({ seal: (html) => ({ html, sealed: false }) as never }), "seal_failed"],
    ["the page overflows on mobile", makeDeps({ render: async () => ({ mobileOverflow: true, invalidGeometry: false }) }), "render_failed"],
    ["the geometry is invalid", makeDeps({ render: async () => ({ mobileOverflow: false, invalidGeometry: true }) }), "render_failed"],
    ["it does not render at all", makeDeps({ render: async () => null }), "render_failed"],
  ])("rolls the whole mutation back when %s", async (_name, deps, code) => {
    const sandbox = createCreativeSandbox(CANDIDATE, deps);
    await expect(sandbox.applyPatch(REPLACE_HERO)).resolves.toMatchObject({ ok: false, code });
    expect(sandbox.current().html).toBe(BASE_HTML);
    expect(sandbox.current().source).toBe("baseline");
  });

  it("rejects a patch aimed at a target that does not exist", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ ...REPLACE_HERO.operations[0], targetId: "ol-ghost-9" }] }))
      .resolves.toMatchObject({ ok: false, code: "unknown_target" });
    expect(sandbox.current().html).toBe(BASE_HTML);
  });

  it("rejects a malformed patch before touching the canvas", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ op: "replace" }] } as never))
      .resolves.toMatchObject({ ok: false, code: "invalid_patch" });
    expect(sandbox.current().html).toBe(BASE_HTML);
  });

  it("refuses a section body carrying the reserved editor marker", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    const result = await sandbox.applyPatch({
      operations: [{ op: "replace_section", targetId: "ol-hero-1", html: '<section data-slot-path="hero.title">x</section>' }],
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_patch" });
    expect(sandbox.current().html).toBe(BASE_HTML);
  });

  it("refuses an unsafe link and an unsafe stylesheet without mutating anything", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ op: "set_link", targetId: "ol-hero-1", url: "javascript:alert(1)" }] }))
      .resolves.toMatchObject({ ok: false, code: "unsafe_url" });
    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: '@import url("https://evil.com/x.css")' }] }))
      .resolves.toMatchObject({ ok: false, code: "unsafe_css", detail: "css_import" });
    expect(sandbox.current().html).toBe(BASE_HTML);
  });

  it("tells the model which of the four css rules refused it", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    // The refusal a real design turn hits: an external image the sandbox was
    // never told to allow. Indistinguishable from an @import without a detail.
    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: ".hero{background-image:url(https://images.unsplash.com/photo-1.jpg)}" }] }))
      .resolves.toMatchObject({ ok: false, code: "unsafe_css", detail: "css_external_fetch" });
    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: ".hero{width:expression(alert(1))}" }] }))
      .resolves.toMatchObject({ ok: false, code: "unsafe_css", detail: "css_execution_primitive" });
    expect(sandbox.current().html).toBe(BASE_HTML);
  });

  it.each([
    "html{scroll-behavior:smooth}",
    ".panel{overscroll-behavior:contain}",
    ".panel{overscroll-behavior-y:none}",
  ])("does not read ordinary scrolling css as an execution primitive: %s", (css) => {
    expect(safeCreativeCss(css)).toEqual({ ok: true });
  });

  it.each([
    ".x{behavior:url(evil.htc)}",
    ".x{-ms-behavior:url(evil.htc)}",
    ".x{-moz-binding:url(evil.xml)}",
    ".x{width:expression(alert(1))}",
    ".x{background:url(javascript:alert(1))}",
  ])("still refuses %s", (css) => {
    expect(safeCreativeCss(css)).toMatchObject({ ok: false, detail: "css_execution_primitive" });
  });

  it("keeps a data-uri background and a relative asset path", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: ".a{background-image:url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)}.b{background-image:url(/assets/paper.png)}" }] }))
      .resolves.toMatchObject({ ok: true });
  });

  it("keeps an ordinary user link", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ op: "set_link", targetId: "ol-hero-1", url: "https://wa.me/52551234", label: "Escríbenos" }] }))
      .resolves.toMatchObject({ ok: true });
    expect(sandbox.current().html).toContain("https://wa.me/52551234");
  });

  it("tells the model exactly what sanitization removed so it can use CSS instead", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps({
      sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 3, dangerousUrls: 0, iframes: 1, metaRefresh: 0 } }),
    }));
    const result = await sandbox.applyPatch(REPLACE_HERO);
    expect(result.ok && result.warnings.join(" ")).toMatch(/script/i);
    expect(result.ok && result.warnings.join(" ")).toMatch(/handler/i);
    expect(result.ok && result.warnings.join(" ")).toMatch(/iframe/i);
  });

  it("applies a whole batch or none of it", async () => {
    const render = vi.fn(async () => ({ mobileOverflow: true, invalidGeometry: false }));
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps({ render }));
    await sandbox.applyPatch({
      operations: [
        REPLACE_HERO.operations[0],
        { op: "remove_section", targetId: "ol-features-2" },
      ],
    });
    expect(sandbox.current().html).toBe(BASE_HTML);
    expect(sandbox.current().html).toContain("ol-features-2");
  });

  it("removes, moves and inserts sections against real targets", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    await expect(sandbox.applyPatch({ operations: [{ op: "remove_section", targetId: "ol-features-2" }] })).resolves.toMatchObject({ ok: true });
    expect(sandbox.current().html).not.toContain("ol-features-2");

    await expect(sandbox.applyPatch({
      operations: [{ op: "insert_section", afterTargetId: "ol-hero-1", role: "gallery", html: "<section>galería</section>" }],
    })).resolves.toMatchObject({ ok: true });
    expect(sandbox.current().html).toContain("galería");

    await expect(sandbox.applyPatch({ operations: [{ op: "move_section", targetId: "ol-hero-1", afterTargetId: null }] })).resolves.toMatchObject({ ok: true });
  });

  it("reports render diagnostics without leaking browser internals", async () => {
    const sandbox = createCreativeSandbox(CANDIDATE, makeDeps());
    const preview = await sandbox.renderPreview();
    expect(preview).toMatchObject({ ok: true });
    expect(JSON.stringify(preview)).not.toMatch(/puppeteer|chrome|devtools/i);
  });
});
