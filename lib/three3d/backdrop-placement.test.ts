import { describe, it, expect } from "vitest";
import {
  findBackdropTarget,
  stripInert,
  getAttr,
  mergeStyle,
  withId,
} from "./backdrop-placement";

// ---------------------------------------------------------------------------
// stripInert
// ---------------------------------------------------------------------------

describe("stripInert", () => {
  it("replaces HTML comment content with spaces of the same length", () => {
    const html = "ab<!--hidden-->cd";
    const s = stripInert(html);
    expect(s.length).toBe(html.length);
    expect(s.slice(0, 2)).toBe("ab");
    expect(s.slice(s.length - 2)).toBe("cd");
    // The comment region becomes spaces
    expect(s.slice(2, s.length - 2).trim()).toBe("");
  });

  it("replaces <script> body with spaces (preserves offsets)", () => {
    const html = `<div><script>var x="<section>";</script></div>`;
    const s = stripInert(html);
    expect(s.length).toBe(html.length);
    // The section tag inside script should not be searchable
    expect(s).not.toContain("<section>");
  });

  it("replaces <style> body with spaces", () => {
    const html = `<style>section{color:red}</style><section id="real"></section>`;
    const s = stripInert(html);
    expect(s.length).toBe(html.length);
    // The section at the end should still be findable
    expect(s).toContain('<section id="real">');
  });
});

// ---------------------------------------------------------------------------
// getAttr
// ---------------------------------------------------------------------------

describe("getAttr", () => {
  it("reads double-quoted attribute", () => {
    expect(getAttr(`<section id="hero" class="x">`, "id")).toBe("hero");
  });
  it("reads single-quoted attribute", () => {
    expect(getAttr(`<section id='hero' class='x'>`, "id")).toBe("hero");
  });
  it("returns null when attribute absent", () => {
    expect(getAttr(`<section class="x">`, "id")).toBeNull();
  });
  it("is case-insensitive on attr name", () => {
    expect(getAttr(`<SECTION ID="hero">`, "id")).toBe("hero");
  });
});

// ---------------------------------------------------------------------------
// mergeStyle
// ---------------------------------------------------------------------------

describe("mergeStyle", () => {
  it("appends to double-quoted style", () => {
    const tag = `<section style="padding:2rem">`;
    const r = mergeStyle(tag, "position:relative");
    expect(r).toContain(`style="padding:2rem;position:relative"`);
    expect((r.match(/style=/g) ?? []).length).toBe(1);
  });
  it("appends to single-quoted style", () => {
    const tag = `<section style='padding:2rem'>`;
    const r = mergeStyle(tag, "position:relative");
    expect(r).toContain(`style="padding:2rem;position:relative"`);
    expect((r.match(/style=/g) ?? []).length).toBe(1);
  });
  it("strips trailing semicolon before appending", () => {
    const tag = `<section style="padding:2rem;">`;
    const r = mergeStyle(tag, "color:red");
    expect(r).toContain(`style="padding:2rem;color:red"`);
    expect(r).not.toContain(";;");
  });
  it("adds style attr when none present", () => {
    const tag = `<section>`;
    const r = mergeStyle(tag, "position:relative");
    expect(r).toBe(`<section style="position:relative">`);
  });
});

// ---------------------------------------------------------------------------
// withId
// ---------------------------------------------------------------------------

describe("withId", () => {
  it("adds id when absent", () => {
    expect(withId("<section>", "hero")).toBe(`<section id="hero">`);
  });
  it("does not add id when double-quoted id exists", () => {
    const tag = `<section id="existing">`;
    expect(withId(tag, "hero")).toBe(tag);
  });
  it("does not add id when single-quoted id exists", () => {
    const tag = `<section id='existing'>`;
    expect(withId(tag, "hero")).toBe(tag);
  });
});

// ---------------------------------------------------------------------------
// findBackdropTarget — priority 1: marker
// ---------------------------------------------------------------------------

describe("findBackdropTarget — priority 1: data-ol-3d-scene marker", () => {
  it("picks the element with data-ol-3d-scene", () => {
    const html = `<html><body><nav>nav</nav><section data-ol-3d-scene></section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t).not.toBeNull();
    expect(t!.isMarker).toBe(true);
    const tag = html.slice(t!.tagStart, t!.tagEnd);
    expect(tag).toContain("data-ol-3d-scene");
  });

  it("cssSelector uses #id when marker element has an id", () => {
    const html = `<html><body><section id="hero" data-ol-3d-scene></section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("#hero");
  });

  it("cssSelector uses [data-ol-3d-scene] when no id", () => {
    const html = `<html><body><section data-ol-3d-scene></section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("[data-ol-3d-scene]");
  });

  it("ignores marker inside an HTML comment", () => {
    const html = `<html><body><!-- <section data-ol-3d-scene></section> --><section id="real"></section></body></html>`;
    const t = findBackdropTarget(html);
    // Should fall through to priority 2 and find the real section
    expect(t).not.toBeNull();
    expect(t!.isMarker).toBe(false);
    expect(t!.existingId).toBe("real");
  });

  it("ignores marker inside a <script> body", () => {
    const html = `<html><body><script>var x='<section data-ol-3d-scene></section>';</script><section id="real"></section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t).not.toBeNull();
    expect(t!.isMarker).toBe(false);
    expect(t!.existingId).toBe("real");
  });
});

// ---------------------------------------------------------------------------
// findBackdropTarget — priority 2: first direct section child of body/main
// ---------------------------------------------------------------------------

describe("findBackdropTarget — priority 2: direct section child", () => {
  it("picks first body>section", () => {
    const html = `<html><body><section id="s1"><h1>Hero</h1></section><section id="s2">...</section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.existingId).toBe("s1");
    expect(t!.isMarker).toBe(false);
  });

  it("does NOT pick a section nested inside a div (must be direct child)", () => {
    const html = `<html><body><div><section id="nested"></section></div><section id="direct"></section></body></html>`;
    const t = findBackdropTarget(html);
    // The nested section should not be picked; the direct one should
    expect(t!.existingId).toBe("direct");
  });

  it("cssSelector uses body>section:first-of-type when no id", () => {
    const html = `<html><body><section><h1>Hero</h1></section></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("body>section:first-of-type");
  });

  it("handles section inside main", () => {
    const html = `<html><body><main><section id="ms">...</section></main></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.existingId).toBe("ms");
  });
});

// ---------------------------------------------------------------------------
// findBackdropTarget — priority 3: first non-skip body child
// ---------------------------------------------------------------------------

describe("findBackdropTarget — priority 3: first non-skip body child", () => {
  it("skips nav/header and returns the first non-skip element", () => {
    const html = `<html><body><nav>nav</nav><header>hdr</header><div id="app">content</div></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.existingId).toBe("app");
    expect(t!.isMarker).toBe(false);
  });

  it("cssSelector uses #id when element has an id", () => {
    const html = `<html><body><nav>nav</nav><div id="app">content</div></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("#app");
  });

  it("cssSelector uses body>:nth-child(N) targeting the SAME element the finder picks (skips nav)", () => {
    // nav is child 1 (skipped), the div hero is child 2 — the selector must
    // resolve to the div, not the nav, so preview == bake.
    const html = `<html><body><nav>nav</nav><div>content</div></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("body>:nth-child(2)");
  });

  it("cssSelector is body>:nth-child(1) when the hero IS the first body child", () => {
    const html = `<html><body><div>content</div><footer>f</footer></body></html>`;
    const t = findBackdropTarget(html);
    expect(t!.cssSelector).toBe("body>:nth-child(1)");
  });
});

// ---------------------------------------------------------------------------
// findBackdropTarget — null fallback
// ---------------------------------------------------------------------------

describe("findBackdropTarget — null fallback", () => {
  it("returns null for a bare body with only skip-listed or void children", () => {
    const html = `<html><body><script>x</script><style>y</style></body></html>`;
    // Script/style content is stripped; after stripping no eligible child remains
    const t = findBackdropTarget(html);
    expect(t).toBeNull();
  });
});
