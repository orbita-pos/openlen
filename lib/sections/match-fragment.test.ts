import { describe, it, expect } from "vitest";
import {
  extractHostPalette,
  extractSectionStyle,
  spliceSectionStyle,
  validateRecolouredCss,
  buildMatchPrompt,
} from "./match-fragment";

// Mirrors a real generated host: --bg/--fg alias --ol-bg/--ol-fg on <html style>,
// accent aliases --ol-accent declared in a later :root block.
const DARK_HOST = `<!doctype html><html lang="en" style="--ol-bg: #08090a; --ol-fg: #ececee;"><head>
<style>:root{--bg:var(--ol-bg);--bg-2:#0E0F12;--fg:var(--ol-fg);--fg-dim:rgba(255,255,255,0.62);--accent:var(--ol-accent);--border:rgba(255,255,255,0.10)}
:root{--ol-accent:#5e6ad2;}</style></head><body><main></main></body></html>`;

const LIGHT_HOST = `<!doctype html><html style="--ol-bg:#faf6f0;--ol-fg:#1f1610;"><head>
<style>:root{--bg:var(--ol-bg);--surface:#f4ede2;--fg:var(--ol-fg);--accent:var(--ol-accent)}:root{--ol-accent:#e05a2b;}</style></head><body></body></html>`;

describe("extractHostPalette", () => {
  it("resolves var(--ol-*) chains to literals on a dark host", () => {
    const p = extractHostPalette(DARK_HOST);
    expect(p.bg).toBe("#08090a");
    expect(p.fg).toBe("#ececee");
    expect(p.accent).toBe("#5e6ad2");
    expect(p.surface).toBe("#0E0F12"); // --bg-2 fallback
    expect(p.mode).toBe("dark");
  });

  it("infers light mode from a light background", () => {
    const p = extractHostPalette(LIGHT_HOST);
    expect(p.bg).toBe("#faf6f0");
    expect(p.fg).toBe("#1f1610");
    expect(p.accent).toBe("#e05a2b");
    expect(p.mode).toBe("light");
  });
});

const FRAG = `<link href="x">
<style>
[data-sec="navbar-06"]{--surface:#ffffff;--ink:#0c0d10}
[data-sec="navbar-06"] .annbar{background:var(--ink);color:#fff}
</style>
<header data-sec="navbar-06" class="nav-root"><div class="annbar">New</div></header>`;

describe("extractSectionStyle / spliceSectionStyle", () => {
  it("extracts the section's scoped <style>", () => {
    const s = extractSectionStyle(FRAG, "navbar-06");
    expect(s).not.toBeNull();
    expect(s!.css).toContain('[data-sec="navbar-06"] .annbar');
  });

  it("returns null for an absent slug", () => {
    expect(extractSectionStyle(FRAG, "hero-01")).toBeNull();
  });

  it("splices new CSS in place, leaving markup untouched", () => {
    const newCss = `[data-sec="navbar-06"]{--surface:#0E0F12;--ink:#ececee}\n[data-sec="navbar-06"] .annbar{background:var(--surface);color:var(--ink)}`;
    const out = spliceSectionStyle(FRAG, "navbar-06", newCss);
    expect(out).not.toBeNull();
    expect(out).toContain("--ink:#ececee"); // recoloured
    expect(out).not.toContain("--ink:#0c0d10"); // old gone
    expect(out).toContain('<header data-sec="navbar-06" class="nav-root">'); // markup intact
    expect(out).toContain('<div class="annbar">New</div>');
  });
});

describe("validateRecolouredCss", () => {
  const slug = "navbar-06";
  it("accepts valid scoped CSS", () => {
    expect(validateRecolouredCss(`[data-sec="${slug}"]{color:#fff}`, slug).ok).toBe(true);
  });
  it("rejects CSS that lost the section scope (would leak global rules)", () => {
    expect(validateRecolouredCss(`body{background:#000}`, slug).ok).toBe(false);
  });
  it("rejects HTML/markup", () => {
    expect(validateRecolouredCss(`<style>[data-sec="${slug}"]{}</style>`, slug).ok).toBe(false);
  });
  it("rejects too-short output", () => {
    expect(validateRecolouredCss(`x`, slug).ok).toBe(false);
  });
});

describe("buildMatchPrompt", () => {
  it("embeds the host palette + the section CSS + the scope guard", () => {
    const p = extractHostPalette(DARK_HOST);
    const prompt = buildMatchPrompt(p, `[data-sec="navbar-06"]{color:#000}`, "navbar-06");
    expect(prompt).toContain("#08090a"); // host bg
    expect(prompt).toContain("#5e6ad2"); // accent
    expect(prompt).toContain("dark page"); // mode
    expect(prompt).toContain('[data-sec="navbar-06"]'); // scope guard + css
    expect(prompt.toLowerCase()).toContain("role-aware");
  });
});
