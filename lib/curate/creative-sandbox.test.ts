import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./ai-creation-contracts";
import type { CreativeSandboxDeps } from "./creative-sandbox";
import type { CreativePatchInput } from "./creative-sandbox-contracts";
import { createCreativeSandbox, safeCreativeCss, safeCreativeUrl } from "./creative-sandbox";

const HTML = '<!doctype html><html><head><style>.base{display:block}</style></head><body><main><section data-openlen-role="hero"><a href="/start">Start</a></section><section data-openlen-role="features"><p>Old</p></section></main></body></html>';

function candidate(html = HTML): SafeCreativeCandidate {
  return {
    html,
    title: "Mundo Pincel",
    visualEngine: { route: "section_composition" } as SafeCreativeCandidate["visualEngine"],
    filled: true,
    appliedOps: 3,
    source: "baseline",
  };
}

const goodRender = async () => ({
  desktop: { mimeType: "image/jpeg" as const, dataBase64: "aGVsbG8=" },
  mobile: { mimeType: "image/jpeg" as const, dataBase64: "aGVsbG8=" },
  mobileOverflow: false,
  weakTypographyHierarchy: false,
  invalidGeometry: false,
});

function deps(overrides: Partial<CreativeSandboxDeps> = {}): CreativeSandboxDeps {
  return {
    sanitize: (html) => ({
      html,
      errors: [],
      removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 },
    }),
    seal: (html) => ({ html, sealed: true, errors: [] }),
    render: goodRender,
    validateFetchedImage: async (raw) => ({
      ok: true,
      value: { url: new URL(raw), hostname: new URL(raw).hostname, resolvedIp: "203.0.113.10" },
    }),
    ...overrides,
  };
}

describe("creative URL and CSS policy", () => {
  it.each([
    "#faq", "/pricing", "./about", "../home", "https://example.com/a", "http://example.com", "mailto:hello@example.com", "tel:+525551234567",
  ])("allows an ordinary creative URL: %s", (url) => {
    expect(safeCreativeUrl(url)).toBe(true);
  });

  it.each([
    "//evil.example/x", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
    "https://user:secret@example.com/private", "http://user@example.com/private", "not a url",
  ])("rejects an executable, credentialed, or malformed URL: %s", (url) => {
    expect(safeCreativeUrl(url)).toBe(false);
  });

  it("allows expressive CSS and only already-validated external assets", () => {
    const css = '@container (min-width:30rem){.card{--tilt:4deg;transform:rotate(var(--tilt));background:linear-gradient(#fff,#f06);animation:float 2s ease}} @keyframes float{to{translate:0 -4px}} .art{background-image:url("https://cdn.example/art.jpg")}';
    expect(safeCreativeCss(css, new Set(["https://cdn.example/art.jpg"]))).toBe(true);
    expect(safeCreativeCss(".pixel{background:url(data:image/png;base64,iVBORw0KGgo=)}")).toBe(true);
  });

  it.each([
    ['@import "https://evil.example/x.css"', new Set<string>()],
    ['a{width:expression(alert(1))}', new Set<string>()],
    ['a{background:url(javascript:alert(1))}', new Set<string>()],
    ['a{behavior:url(x.htc)}', new Set<string>()],
    ['a{-moz-binding:url(x.xml)}', new Set<string>()],
    ['a{background:url("data:image/svg+xml,<svg onload=alert(1)>")}', new Set<string>()],
    ['a{background:url("https://cdn.example/unvalidated.jpg")}', new Set<string>()],
    ['a{color:red', new Set<string>()],
    ['a{width:exp/**/ression(alert(1))}', new Set<string>()],
    ['@\\69mport "https://evil.example/x.css"', new Set<string>()],
  ])("rejects unsafe CSS %s", (css, assets) => {
    expect(safeCreativeCss(css, assets)).toBe(false);
  });
});

describe("transactional creative sandbox", () => {
  it("provides stable bounded targets without changing the baseline candidate", () => {
    const sandbox = createCreativeSandbox(candidate(), deps());

    expect(sandbox.inspect()).toEqual({
      title: "Mundo Pincel",
      targets: [
        { targetId: "ol-edit-1", role: "hero", tagName: "section" },
        { targetId: "ol-edit-2", role: "link", tagName: "a" },
        { targetId: "ol-edit-3", role: "features", tagName: "section" },
      ],
    });
    expect(sandbox.inspect()).toEqual(sandbox.inspect());
    expect(sandbox.current()).toEqual(candidate());
  });

  it("commits a replacement only after sanitize, seal, and render pass", async () => {
    const events: string[] = [];
    const sandbox = createCreativeSandbox(candidate(), deps({
      sanitize: (html) => { events.push("sanitize"); return { html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }; },
      seal: (html) => { events.push("seal"); return { html, sealed: true, errors: [] }; },
      render: async () => { events.push("render"); return goodRender(); },
    }));

    const result = await sandbox.applyPatch({ operations: [{
      op: "replace_section",
      targetId: "ol-edit-3",
      html: '<section class="new"><h2>Fresh ideas</h2></section>',
      css: ".new{display:grid;transform:rotate(-1deg)}",
    }] });

    expect(events).toEqual(["sanitize", "seal", "render"]);
    expect(result).toMatchObject({ ok: true, candidate: { source: "deepseek", appliedOps: 4 }, warnings: [] });
    expect(sandbox.current().html).toContain("Fresh ideas");
    expect(sandbox.current().html).toContain('data-openlen-edit-id="ol-edit-3"');
    expect(sandbox.current().html).toContain("transform:rotate(-1deg)");
  });

  it("preserves an ordinary relative link through the real sanitize and seal gates", async () => {
    const sandbox = createCreativeSandbox(candidate(), { render: goodRender });

    const result = await sandbox.applyPatch({ operations: [{
      op: "set_link", targetId: "ol-edit-2", url: "/pricing", label: "Pricing",
    }] });

    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(sandbox.current().html).toContain('href="/pricing"');
    expect(sandbox.current().html).toContain("Content-Security-Policy");
  });

  const rollbackCases: Array<[string, CreativePatchInput, string]> = [
    ["malformed HTML", { operations: [{ op: "replace_section", targetId: "ol-edit-3", html: "<section><div></section>" }] }, "invalid_patch"],
    ["reserved markers", { operations: [{ op: "replace_section", targetId: "ol-edit-3", html: '<section data-openlen-edit-id="forged">x</section>' }] }, "reserved_marker"],
    ["unsafe URL", { operations: [{ op: "replace_section", targetId: "ol-edit-3", html: '<section><a href="javascript:alert(1)">x</a></section>' }] }, "unsafe_url"],
    ["unsafe CSS", { operations: [{ op: "set_page_css", css: '@import "https://evil.example/x.css"' }] }, "unsafe_css"],
  ];

  it.each(rollbackCases)("rolls back %s", async (_label, patch, code) => {
    const sandbox = createCreativeSandbox(candidate(), deps());
    const before = sandbox.current();

    await expect(sandbox.applyPatch(patch)).resolves.toMatchObject({ ok: false, code });
    expect(sandbox.current()).toEqual(before);
  });

  it.each([
    ["script", '<section><script>privateCall()</script></section>', "scripts"],
    ["event handler", '<section><button onclick="privateCall()">Go</button></section>', "event_handlers"],
    ["iframe", '<section><iframe src="https://example.com"></iframe></section>', "iframes"],
  ])("rolls back removed %s and returns a redacted actionable warning", async (_label, html, warning) => {
    const sandbox = createCreativeSandbox(candidate(), deps());
    const before = sandbox.current();

    const result = await sandbox.applyPatch({ operations: [{ op: "replace_section", targetId: "ol-edit-3", html }] });

    expect(result).toMatchObject({ ok: false, code: "sanitization_failed", warnings: expect.arrayContaining([warning]) });
    expect(JSON.stringify(result)).not.toContain("privateCall");
    expect(sandbox.current()).toEqual(before);
  });

  it("reports every removed executable category without retaining markup", async () => {
    const sandbox = createCreativeSandbox(candidate(), deps());
    const result = await sandbox.applyPatch({ operations: [{
      op: "replace_section",
      targetId: "ol-edit-3",
      html: '<section><script>privateCall()</script><button onclick="privateCall()">Go</button><iframe src="https://example.com"></iframe></section>',
    }] });

    expect(result).toMatchObject({
      ok: false,
      code: "sanitization_failed",
      warnings: expect.arrayContaining(["scripts", "event_handlers", "iframes"]),
    });
    expect(JSON.stringify(result)).not.toContain("privateCall");
  });

  it("rejects duplicate target ids without mutating state", async () => {
    const duplicated = HTML.replace('data-openlen-role="hero"', 'data-openlen-role="hero" data-openlen-edit-id="same"')
      .replace('data-openlen-role="features"', 'data-openlen-role="features" data-openlen-edit-id="same"');
    const sandbox = createCreativeSandbox(candidate(duplicated), deps());
    const before = sandbox.current();

    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: "body{color:#123}" }] }))
      .resolves.toMatchObject({ ok: false, code: "duplicate_target" });
    expect(sandbox.current()).toEqual(before);
  });

  it.each([
    ["sanitization", deps({ sanitize: () => ({ html: null, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }) }), "sanitization_failed"],
    ["seal", deps({ seal: (html) => ({ html, sealed: false, errors: ["hash drift"] }) }), "seal_failed"],
    ["missing render", deps({ render: async () => null }), "render_failed"],
    ["mobile overflow", deps({ render: async () => ({ ...(await goodRender()), mobileOverflow: true }) }), "render_failed"],
    ["invalid geometry", deps({ render: async () => ({ ...(await goodRender()), invalidGeometry: true }) }), "render_failed"],
  ] as const)("rolls back after failed %s gate", async (_label, sandboxDeps, code) => {
    const sandbox = createCreativeSandbox(candidate(), sandboxDeps);
    const before = sandbox.current();

    await expect(sandbox.applyPatch({ operations: [{ op: "set_page_css", css: "body{color:#123}" }] }))
      .resolves.toMatchObject({ ok: false, code });
    expect(sandbox.current()).toEqual(before);
  });

  it("validates fetched images against SSRF policy and permits CSS to reuse only that asset", async () => {
    const validateFetchedImage = vi.fn(async (raw: string) => ({
      ok: true as const,
      value: { url: new URL(raw), hostname: new URL(raw).hostname, resolvedIp: "203.0.113.10" },
    }));
    const sandbox = createCreativeSandbox(candidate(), deps({ validateFetchedImage }));

    const result = await sandbox.applyPatch({ operations: [{
      op: "replace_section",
      targetId: "ol-edit-3",
      html: '<section class="art"><img src="https://cdn.example/art.jpg" alt="Art"></section>',
      css: '.art{background-image:url("https://cdn.example/art.jpg")}',
    }] });

    expect(result).toMatchObject({ ok: true });
    expect(validateFetchedImage).toHaveBeenCalledWith("https://cdn.example/art.jpg");
  });

  it("rejects private fetched images but never applies SSRF lookup to ordinary links", async () => {
    const validateFetchedImage = vi.fn(async () => ({ ok: false as const, error: { kind: "ssrf-blocked" as const, reason: "private" } }));
    const sandbox = createCreativeSandbox(candidate(), deps({ validateFetchedImage }));
    const before = sandbox.current();

    await expect(sandbox.applyPatch({ operations: [{
      op: "replace_section", targetId: "ol-edit-3", html: '<section><img src="http://127.0.0.1/private.png"></section>',
    }] })).resolves.toMatchObject({ ok: false, code: "unsafe_url" });
    expect(sandbox.current()).toEqual(before);

    await expect(sandbox.applyPatch({ operations: [{
      op: "set_link", targetId: "ol-edit-2", url: "https://example.com/pricing", label: "Pricing",
    }] })).resolves.toMatchObject({ ok: true });
    expect(validateFetchedImage).toHaveBeenCalledTimes(1);
    expect(sandbox.current().html).toContain('href="https://example.com/pricing"');
  });

  it("treats a link label as text rather than executable or styling markup", async () => {
    const sandbox = createCreativeSandbox(candidate(), deps());

    await expect(sandbox.applyPatch({ operations: [{
      op: "set_link",
      targetId: "ol-edit-2",
      url: "/pricing",
      label: '<style>@import "https://evil.example/x.css"</style><b onclick="privateCall()">Pricing</b>',
    }] })).resolves.toMatchObject({ ok: true });
    expect(sandbox.current().html).not.toContain("<style>@import");
    expect(sandbox.current().html).not.toContain("<b onclick=");
    expect(sandbox.current().html).toContain("&lt;style&gt;");
  });

  it("lets inline CSS reuse an image validated earlier in the same transaction", async () => {
    const validateFetchedImage = vi.fn(async (raw: string) => ({
      ok: true as const,
      value: { url: new URL(raw), hostname: new URL(raw).hostname, resolvedIp: "203.0.113.10" },
    }));
    const sandbox = createCreativeSandbox(candidate(), deps({ validateFetchedImage }));

    await expect(sandbox.applyPatch({ operations: [{
      op: "replace_section",
      targetId: "ol-edit-3",
      html: '<section style="background-image:url(https://cdn.example/art.jpg)"><img src="https://cdn.example/art.jpg" alt="Art"></section>',
    }] })).resolves.toMatchObject({ ok: true });
  });

  it("applies the fetched-image SSRF check to every absolute srcset candidate", async () => {
    const validateFetchedImage = vi.fn(async (raw: string) => raw.includes("private")
      ? { ok: false as const, error: { kind: "ssrf-blocked" as const, reason: "private" } }
      : { ok: true as const, value: { url: new URL(raw), hostname: new URL(raw).hostname, resolvedIp: "203.0.113.10" } });
    const sandbox = createCreativeSandbox(candidate(), deps({ validateFetchedImage }));

    await expect(sandbox.applyPatch({ operations: [{
      op: "replace_section",
      targetId: "ol-edit-3",
      html: '<section><img src="https://cdn.example/safe.jpg" srcset="https://cdn.example/safe.jpg 1x, https://private.example/image.jpg 2x"></section>',
    }] })).resolves.toMatchObject({ ok: false, code: "unsafe_url" });
    expect(validateFetchedImage).toHaveBeenCalledWith("https://private.example/image.jpg");
  });

  it("moves, inserts, removes, and previews without bypassing render validation", async () => {
    const sandbox = createCreativeSandbox(candidate(), deps());

    await expect(sandbox.applyPatch({ operations: [
      { op: "insert_section", afterTargetId: "ol-edit-1", role: "gallery", html: "<section><h2>Gallery</h2></section>" },
      { op: "move_section", targetId: "ol-edit-3", afterTargetId: null },
      { op: "remove_section", targetId: "ol-edit-1" },
    ] })).resolves.toMatchObject({ ok: true, candidate: { appliedOps: 6 } });
    expect(sandbox.current().html).toContain("Gallery");
    expect(sandbox.current().html).not.toContain('data-openlen-role="hero"');

    await expect(sandbox.renderPreview()).resolves.toMatchObject({ ok: true, candidate: { source: "deepseek" } });
  });
});
