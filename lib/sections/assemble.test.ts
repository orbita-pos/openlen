import { describe, it, expect } from "vitest";
import {
  bindSectionTokens,
  assembleDocument,
  type AssembleTheme,
  type SectionFragment,
} from "./assemble";

const THEME: AssembleTheme = {
  base: { bg: "#0f0f0f", surface: "#131313", fg: "#ededed", border: "#2a2a2a", accent: "#3ecf8e" },
  mode: "dark",
  fontDisplay: "'Inter', sans-serif",
  fontBody: "'Inter', sans-serif",
};

describe("bindSectionTokens — rebind local tokens to the page theme", () => {
  // The real navbar-02 token block (from a stored fragment): it hardcodes its
  // own accent / surface / ink / radius / display font. After binding none of
  // those literals may survive — they must all point at --ol-*.
  const NAVBAR_02 =
    '[data-sec="navbar-02"]{ --accent:#3ecf8e; --surface:#0f0f0f; --ink:#ededed; --muted:rgba(255,255,255,.62); --border:rgba(255,255,255,.1); --radius:11px; --font-display:\'Manrope\',system-ui,sans-serif; --nav-h:68px; }';

  it("kills navbar-02's hardcoded accent/surface/ink/font/radius", () => {
    const out = bindSectionTokens(NAVBAR_02);
    // the authored literals are gone
    expect(out).not.toContain("#3ecf8e");
    expect(out).not.toContain("#ededed");
    expect(out).not.toContain("#0f0f0f");
    expect(out).not.toContain("Manrope");
    expect(out).not.toContain("rgba(255,255,255,.62)");
    expect(out).not.toContain("rgba(255,255,255,.1)");
    // each is rebound to the page theme
    expect(out).toMatch(/--accent:\s*var\(--ol-accent\)/);
    expect(out).toMatch(/--surface:\s*var\(--ol-surface\)/);
    expect(out).toMatch(/--ink:\s*var\(--ol-fg\)/); // dialect: ink → fg
    expect(out).toMatch(/--muted:\s*var\(--ol-fg-muted\)/);
    expect(out).toMatch(/--border:\s*var\(--ol-border\)/);
    expect(out).toMatch(/--font-display:\s*var\(--ol-font-display\)/);
  });

  it("scales radius by --ol-r-scale (keeps the section's base length)", () => {
    const out = bindSectionTokens(NAVBAR_02);
    expect(out).toMatch(/--radius:\s*calc\(11px \* var\(--ol-r-scale\)\)/);
  });

  it("leaves custom non-theme tokens untouched (--nav-h)", () => {
    const out = bindSectionTokens(NAVBAR_02);
    expect(out).toMatch(/--nav-h:\s*68px/);
  });

  it("does NOT rewrite token USES, only definitions", () => {
    const css = '[data-sec="x"]{--accent:#abc}[data-sec="x"] .b{background:var(--accent);color:#fff}';
    const out = bindSectionTokens(css);
    expect(out).toMatch(/--accent:\s*var\(--ol-accent\)/); // definition rebound
    expect(out).toContain("background:var(--accent)"); // use untouched
    expect(out).toContain("color:#fff"); // unrelated literal untouched
  });

  it("is idempotent", () => {
    const once = bindSectionTokens(NAVBAR_02);
    const twice = bindSectionTokens(once);
    expect(twice).toBe(once);
  });

  it("fails open on unparseable CSS", () => {
    const junk = "[data-sec=\"x\"]{--accent:#abc"; // missing brace
    expect(bindSectionTokens(junk)).toBe(junk);
  });
});

describe("assembleDocument — stitch fragments into one coherent doc", () => {
  const FONT = '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">';
  const frag = (slug: string, accent: string): string =>
    `${FONT}\n<style>[data-sec="${slug}"]{--accent:${accent};--radius:8px}[data-sec="${slug}"] .x{color:var(--accent)}</style>\n<section data-sec="${slug}"><h1>${slug}</h1></section>`;

  // deliberately out of page order: footer, hero, navbar
  const fragments: SectionFragment[] = [
    { slug: "footer-1", type: "footer", html: frag("footer-1", "#111111") },
    { slug: "hero-1", type: "hero", html: frag("hero-1", "#222222") },
    { slug: "navbar-1", type: "navbar", html: frag("navbar-1", "#333333") },
  ];

  it("emits a valid document with the theme stamped on <html>", () => {
    const doc = assembleDocument(fragments, THEME);
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toMatch(/<html[^>]*--ol-accent:#3ecf8e/);
    expect(doc).toMatch(/<html[^>]*--ol-bg:#0f0f0f/);
    expect(doc).toContain("--ol-accent-r:62, 207, 142"); // derived rgb triplet
    expect(doc).toContain("<head>");
    expect(doc).toContain("<body>");
  });

  it("orders sections navbar → hero → footer regardless of input order", () => {
    const doc = assembleDocument(fragments, THEME);
    const iNav = doc.indexOf("navbar-1");
    const iHero = doc.indexOf("hero-1");
    const iFoot = doc.indexOf("footer-1");
    expect(iNav).toBeLessThan(iHero);
    expect(iHero).toBeLessThan(iFoot);
  });

  it("binds every section's accent — no authored fragment color leaks", () => {
    const doc = assembleDocument(fragments, THEME);
    expect(doc).not.toContain("#111111");
    expect(doc).not.toContain("#222222");
    expect(doc).not.toContain("#333333");
    expect(doc).toMatch(/--accent:\s*var\(--ol-accent\)/);
  });

  it("hoists + dedupes font links into <head>, none left in <body>", () => {
    const doc = assembleDocument(fragments, THEME);
    const head = doc.slice(0, doc.indexOf("</head>"));
    const body = doc.slice(doc.indexOf("<body>"));
    expect((head.match(/fonts\.googleapis\.com/g) ?? []).length).toBe(1); // deduped to one
    expect(body).not.toContain("fonts.googleapis.com"); // hoisted out of body
  });

  it("keeps at most one navbar and one footer", () => {
    const dupes: SectionFragment[] = [
      ...fragments,
      { slug: "navbar-2", type: "navbar", html: frag("navbar-2", "#444444") },
      { slug: "footer-2", type: "footer", html: frag("footer-2", "#555555") },
    ];
    const doc = assembleDocument(dupes, THEME);
    expect(doc).toContain("navbar-1"); // first navbar kept
    expect(doc).not.toContain("navbar-2"); // second dropped
    expect(doc).toContain("footer-2"); // last footer kept
    expect(doc).not.toContain("footer-1"); // earlier footer dropped
  });
});
