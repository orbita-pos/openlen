// Unit tests for the drop engine's pure core (jsdom). The same functions are
// stringified into the iframe runtime (use-drop-place.ts), so these tests ARE
// the runtime's decision-logic coverage; the composed script is syntax-gated
// at the end. Browser-level behavior lives in tests/e2e/drop-place.spec.ts.

import { describe, it, expect } from "vitest";
import {
  DROP_ASSET_MIME,
  DROP_EDGE_PX,
  blockCandidates,
  buildImageSectionHtml,
  buildMotionHeroHtml,
  buildPathFromBody,
  canSplitSection,
  dropPayloadKind,
  dropSectionCandidates,
  fileNameToAlt,
  findImageDropTarget,
  isImageDropTarget,
  parseDropAsset,
  resizeWidthPct,
  resolveBodySide,
  resolveDropZone,
  sectionBgPlan,
  splitContainer,
} from "./drop-place-core";
import { __DROP_PLACE_SCRIPT_FOR_TEST } from "./use-drop-place";

/** jsdom rects are all-zero — stub a real box on an element. */
function rect(el: Element, w: number, h: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      width: w,
      height: h,
      top: 0,
      left: 0,
      right: w,
      bottom: h,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
}

describe("resolveDropZone — pure geometry", () => {
  const rects = [
    { top: 0, bottom: 300 },
    { top: 300, bottom: 600 },
    { top: 700, bottom: 1000 },
  ];
  const z = (y: number) => resolveDropZone(rects, y, DROP_EDGE_PX);

  it("pins the 24px edge band", () => {
    expect(DROP_EDGE_PX).toBe(24);
  });
  it("above everything → before the first section", () => {
    expect(z(-50)).toEqual({ index: 0, zone: "before" });
    expect(z(10)).toEqual({ index: 0, zone: "before" });
  });
  it("inside a section, away from edges → body (background target)", () => {
    expect(z(150)).toEqual({ index: 0, zone: "body" });
    expect(z(450)).toEqual({ index: 1, zone: "body" });
  });
  it("within the edge band → insertion point", () => {
    expect(z(290)).toEqual({ index: 0, zone: "after" });
    expect(z(310)).toEqual({ index: 1, zone: "before" });
    expect(z(720)).toEqual({ index: 2, zone: "before" });
  });
  it("in a gap between sections → after the upper one", () => {
    expect(z(650)).toEqual({ index: 1, zone: "after" });
  });
  it("below everything → after the last section", () => {
    expect(z(985)).toEqual({ index: 2, zone: "after" });
    expect(z(1400)).toEqual({ index: 2, zone: "after" });
  });
  it("no sections → null", () => {
    expect(resolveDropZone([], 100, DROP_EDGE_PX)).toBeNull();
  });
});

describe("sectionBgPlan — bg legibility plan", () => {
  it("dark image → white ink, no scrim, ground = image luminance", () => {
    expect(sectionBgPlan(0.1)).toEqual({
      ink: "#ffffff",
      scrimColor: "",
      groundLum: 0.1,
    });
    expect(sectionBgPlan(0.32).scrimColor).toBe("");
  });
  it("light image → dark ink, no scrim", () => {
    expect(sectionBgPlan(0.8)).toEqual({
      ink: "#111827",
      scrimColor: "",
      groundLum: 0.8,
    });
    expect(sectionBgPlan(0.68).ink).toBe("#111827");
  });
  it("mid/busy image → white ink over a 45% scrim, ground attenuated ×0.25", () => {
    const plan = sectionBgPlan(0.5);
    expect(plan.ink).toBe("#ffffff");
    expect(plan.scrimColor).toBe("rgba(0,0,0,0.45)");
    expect(plan.groundLum).toBeCloseTo(0.125, 5);
  });
});

describe("isImageDropTarget / findImageDropTarget (jsdom)", () => {
  it("accepts <img>, rejects tiny elements", () => {
    const img = document.createElement("img");
    rect(img, 200, 120);
    expect(isImageDropTarget(img)).toBe(true);
    const tiny = document.createElement("img");
    rect(tiny, 6, 6);
    expect(isImageDropTarget(tiny)).toBe(false);
  });

  it("svg: icon-sized (≤32) no, image-sized (>32) yes", () => {
    const ns = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(ns, "svg");
    rect(icon, 24, 24);
    expect(isImageDropTarget(icon)).toBe(false);
    const big = document.createElementNS(ns, "svg");
    rect(big, 48, 48);
    expect(isImageDropTarget(big)).toBe(true);
  });

  it("aspect-* div needs a background-image; plain divs never match", () => {
    const bgDiv = document.createElement("div");
    bgDiv.className = "aspect-video w-full";
    bgDiv.style.backgroundImage = "url(/x.webp)";
    rect(bgDiv, 200, 112);
    expect(isImageDropTarget(bgDiv)).toBe(true);

    const noBg = document.createElement("div");
    noBg.className = "aspect-video w-full";
    rect(noBg, 200, 112);
    expect(isImageDropTarget(noBg)).toBe(false);

    const noAspect = document.createElement("div");
    noAspect.style.backgroundImage = "url(/x.webp)";
    rect(noAspect, 200, 112);
    expect(isImageDropTarget(noAspect)).toBe(false);
  });

  it("ignores the editor's own chrome", () => {
    const host = document.createElement("div");
    host.setAttribute("data-openlen-drop", "ui");
    const img = document.createElement("img");
    rect(img, 200, 120);
    host.appendChild(img);
    document.body.appendChild(host);
    expect(isImageDropTarget(img)).toBe(false);
    host.remove();
  });

  it("findImageDropTarget climbs to the nearest target", () => {
    document.body.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "aspect-video";
    wrap.style.backgroundImage = "url(/x.webp)";
    rect(wrap, 400, 225);
    const span = document.createElement("span");
    rect(span, 60, 20);
    wrap.appendChild(span);
    document.body.appendChild(wrap);
    expect(findImageDropTarget(span, isImageDropTarget)).toBe(wrap);
    expect(findImageDropTarget(document.body, isImageDropTarget)).toBeNull();
    wrap.remove();
  });
});

describe("dropSectionCandidates (jsdom)", () => {
  it("returns top-level sections, skipping inert/chrome/thin/fixed", () => {
    document.body.innerHTML =
      "<nav>n</nav><section>a</section><section>b</section>" +
      "<script>void 0</script><div class='openlen-drop-chip' data-openlen-drop='ui'>chip</div>" +
      "<div id='thin'>divider</div><div id='float'>float</div><footer>f</footer>";
    for (const el of Array.from(document.body.children)) rect(el, 1000, 200);
    rect(document.getElementById("thin")!, 1000, 10);
    const float = document.getElementById("float")! as HTMLElement;
    float.style.position = "fixed";
    const out = dropSectionCandidates(document.body);
    expect(out.map((e) => e.tagName)).toEqual([
      "NAV",
      "SECTION",
      "SECTION",
      "FOOTER",
    ]);
    document.body.innerHTML = "";
  });

  it("drills into a single full-page wrapper", () => {
    document.body.innerHTML =
      "<div id='wrap'><section>a</section><section>b</section></div>";
    const wrap = document.getElementById("wrap")!;
    for (const el of [wrap, ...Array.from(wrap.children)]) rect(el, 1000, 300);
    const out = dropSectionCandidates(document.body);
    expect(out).toHaveLength(2);
    expect(out[0].tagName).toBe("SECTION");
    document.body.innerHTML = "";
  });
});

describe("splitContainer (jsdom)", () => {
  it("drills through single-child wrappers to the content container", () => {
    document.body.innerHTML =
      "<section><div class='wrap'><div class='inner'><h1>t</h1><p>c</p></div></div></section>";
    expect(splitContainer(document.querySelector("section"))).toBe(
      document.querySelector(".inner"),
    );
  });
  it("uses the section itself when content sits directly under it", () => {
    document.body.innerHTML = "<section><h2>a</h2><p>b</p></section>";
    const s = document.querySelector("section")!;
    expect(splitContainer(s)).toBe(s);
  });
  it("stops one level above a leaf text block", () => {
    document.body.innerHTML = "<section><div><h2>only</h2></div></section>";
    const s = document.querySelector("section")!;
    expect(splitContainer(s)).toBe(s.firstElementChild);
  });
  it("empty section → null", () => {
    document.body.innerHTML = "<section></section>";
    expect(splitContainer(document.querySelector("section"))).toBeNull();
    document.body.innerHTML = "";
  });
});

describe("canSplitSection (jsdom)", () => {
  function mk(html: string, h = 300): Element {
    document.body.innerHTML = html;
    const s = document.querySelector("section")!;
    rect(s, 1000, h);
    return s;
  }
  it("accepts a tall text-only section", () => {
    expect(
      canSplitSection(mk("<section><h2>a</h2><p>b</p></section>"), splitContainer),
    ).toBe(true);
  });
  it("rejects thin sections", () => {
    expect(
      canSplitSection(mk("<section><h2>a</h2><p>b</p></section>", 100), splitContainer),
    ).toBe(false);
  });
  it("rejects sections already carrying sizable media", () => {
    const s = mk("<section><h2>a</h2><img></section>");
    rect(document.querySelector("img")!, 200, 120);
    expect(canSplitSection(s, splitContainer)).toBe(false);
  });
  it("small inline icons don't block the split", () => {
    const s = mk("<section><h2>a</h2><p>b <img></p></section>");
    rect(document.querySelector("img")!, 24, 24);
    expect(canSplitSection(s, splitContainer)).toBe(true);
  });
  it("rejects an already-split container", () => {
    expect(
      canSplitSection(
        mk("<section class='ol-split'><div>copy</div><div>media</div></section>"),
        splitContainer,
      ),
    ).toBe(false);
  });
  it("rejects grid / row-flex containers, accepts column flex", () => {
    expect(
      canSplitSection(
        mk("<section style='display:grid'><h2>a</h2><p>b</p></section>"),
        splitContainer,
      ),
    ).toBe(false);
    expect(
      canSplitSection(
        mk("<section style='display:flex;flex-direction:row'><h2>a</h2><p>b</p></section>"),
        splitContainer,
      ),
    ).toBe(false);
    expect(
      canSplitSection(
        mk("<section style='display:flex;flex-direction:column'><h2>a</h2><p>b</p></section>"),
        splitContainer,
      ),
    ).toBe(true);
    document.body.innerHTML = "";
  });
});

describe("blockCandidates (jsdom)", () => {
  it("returns visible content children, skipping inert/chrome/thin", () => {
    document.body.innerHTML =
      "<section><h2>t</h2><p>c</p><br><div data-openlen-drop='ui'>x</div><span id='thin'>s</span></section>";
    const s = document.querySelector("section")!;
    for (const el of Array.from(s.children)) rect(el, 600, 40);
    rect(document.getElementById("thin")!, 600, 10);
    expect(blockCandidates(s).map((e) => e.tagName)).toEqual(["H2", "P"]);
    document.body.innerHTML = "";
  });
  it("null container → empty", () => {
    expect(blockCandidates(null)).toEqual([]);
  });
});

describe("resizeWidthPct", () => {
  it("clamps 10..100 and rounds to 0.1", () => {
    expect(resizeWidthPct(220, -60, 1000)).toBe(16);
    expect(resizeWidthPct(220, 9999, 1000)).toBe(100);
    expect(resizeWidthPct(220, -9999, 1000)).toBe(10);
    expect(resizeWidthPct(333, 0, 1000)).toBe(33.3);
    expect(resizeWidthPct(100, 0, 0)).toBe(100);
  });
});

describe("resolveBodySide", () => {
  it("outer thirds → split sides, center third → bg", () => {
    expect(resolveBodySide(0, 900, 100, true)).toBe("left");
    expect(resolveBodySide(0, 900, 450, true)).toBe("bg");
    expect(resolveBodySide(0, 900, 700, true)).toBe("right");
  });
  it("not splittable → always bg", () => {
    expect(resolveBodySide(0, 900, 100, false)).toBe("bg");
    expect(resolveBodySide(0, 900, 700, false)).toBe("bg");
  });
});

describe("buildPathFromBody", () => {
  it("emits the same :nth-of-type breadcrumbs the Replace/Inspect scripts use", () => {
    document.body.innerHTML =
      "<section><h2>one</h2></section><section><div><h2>two</h2><h2>three</h2></div></section>";
    const third = document.querySelectorAll("h2")[2];
    expect(buildPathFromBody(third)).toBe(
      "section:nth-of-type(2) > div:nth-of-type(1) > h2:nth-of-type(2)",
    );
    document.body.innerHTML = "";
  });
});

describe("buildImageSectionHtml", () => {
  it("escapes url + alt and stays framework-agnostic (inline styles only)", () => {
    const html = buildImageSectionHtml(
      '/a.webp?x="1"&y=<z>',
      'Team "A" <photo>',
    );
    expect(html).toContain("<section style=");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("&quot;1&quot;");
    expect(html).toContain("&lt;z&gt;");
    expect(html).toContain("Team &quot;A&quot; &lt;photo&gt;");
    expect(html).not.toContain("<z>");
    expect(html).not.toContain('alt="Team "');
  });
});

describe("buildMotionHeroHtml", () => {
  it("layers a muted looping video over the poster img, escapes urls", () => {
    const html = buildMotionHeroHtml({
      posterHero: '/m/p.webp?x="1"&y=<z>',
      webm: "/m/v.webm",
      mp4: "/m/v.mp4",
    });
    // Poster <img> is in-flow (LCP element); video is absolutely layered over.
    expect(html).toContain("<img src=");
    expect(html).toContain('alt=""');
    expect(html).toContain("autoplay");
    expect(html).toContain("loop");
    expect(html).toContain("muted");
    expect(html).toContain("playsinline");
    expect(html).toContain('type="video/webm"');
    expect(html).toContain('type="video/mp4"');
    // Reduced-motion fallback baked in (no JS).
    expect(html).toContain("prefers-reduced-motion");
    // Hostile url is escaped, never raw.
    expect(html).toContain("&quot;1&quot;");
    expect(html).toContain("&lt;z&gt;");
    expect(html).not.toContain("<z>");
  });
});

describe("fileNameToAlt", () => {
  it("strips extension, expands separators", () => {
    expect(fileNameToAlt("team-photo_v2.jpg")).toBe("team photo v2");
    expect(fileNameToAlt("IMG_2031.PNG")).toBe("IMG 2031");
    expect(fileNameToAlt("")).toBe("");
  });
});

describe("dropPayloadKind", () => {
  it("classifies swap / Files / asset / both / neither", () => {
    expect(dropPayloadKind(["Files"])).toBe("files");
    expect(dropPayloadKind([DROP_ASSET_MIME])).toBe("asset");
    // Priority is pinned: swap > asset > files.
    expect(dropPayloadKind(["Files", DROP_ASSET_MIME])).toBe("asset");
    expect(dropPayloadKind([DROP_ASSET_MIME, "application/x-openlen-swap"])).toBe(
      "swap",
    );
    expect(dropPayloadKind(["application/x-openlen-swap"])).toBe("swap");
    expect(dropPayloadKind(["text/plain"])).toBeNull();
    expect(dropPayloadKind([])).toBeNull();
    expect(dropPayloadKind(null)).toBeNull();
  });
});

describe("parseDropAsset", () => {
  it("accepts a valid payload and passes credit through", () => {
    const json = JSON.stringify({
      url: "https://images.openlen.com/x-1920.webp",
      alt: "studio shot",
      credit: { author: "A", authorUrl: "https://a", photoUrl: "https://p" },
      downloadLocation: "https://api.unsplash.com/photos/x/download",
    });
    expect(parseDropAsset(json)).toEqual({
      url: "https://images.openlen.com/x-1920.webp",
      alt: "studio shot",
      credit: { author: "A", authorUrl: "https://a", photoUrl: "https://p" },
      downloadLocation: "https://api.unsplash.com/photos/x/download",
    });
  });
  it("accepts root-relative urls, rejects other schemes", () => {
    expect(parseDropAsset(JSON.stringify({ url: "/openlen-images/x.webp" }))?.url).toBe(
      "/openlen-images/x.webp",
    );
    expect(parseDropAsset(JSON.stringify({ url: "javascript:alert(1)" }))).toBeNull();
    expect(parseDropAsset(JSON.stringify({ url: "data:text/html,x" }))).toBeNull();
  });
  it("rejects garbage / missing url / oversize", () => {
    expect(parseDropAsset("{not json")).toBeNull();
    expect(parseDropAsset(JSON.stringify({ alt: "no url" }))).toBeNull();
    expect(parseDropAsset(null)).toBeNull();
    expect(parseDropAsset("x".repeat(5000))).toBeNull();
    expect(
      parseDropAsset(JSON.stringify({ url: "https://x/" + "a".repeat(2100) })),
    ).toBeNull();
  });
  it("drops a malformed credit instead of failing the asset", () => {
    const out = parseDropAsset(
      JSON.stringify({ url: "/x.webp", credit: { author: 1 } }),
    );
    expect(out?.url).toBe("/x.webp");
    expect(out?.credit).toBeUndefined();
  });
});

describe("composed runtime", () => {
  it("parses (the stringified core + glue is valid syntax)", () => {
    expect(() => new Function(__DROP_PLACE_SCRIPT_FOR_TEST)).not.toThrow();
  });
});
