import { describe, expect, it } from "vitest";
import { readThemeTokenFromHtml } from "@/lib/agent/theme-apply";
import {
  CreativeDirectionSchema,
  SkeletonAdaptationPlanSchema,
  type CreativeDirection,
  type SkeletonAdaptationPlan,
} from "@/lib/generation/creative-contracts";
import { buildSkeletonInventory } from "@/lib/generation/skeleton-inventory";
import { compileSkeletonIdentity } from "@/lib/generation/creative-compiler";

const NORMALIZED_SKELETON_HTML = `<!doctype html><html lang="en" style="--ol-accent: #111111; --ol-bg: #FAFAFA"><head><title>Coloring</title></head><body data-ol-editor="safe"><nav aria-label="Main"><a href="/" class="brand"><svg id="brand-logo" aria-label="Logo"><path d="M0 0L8 8"></path></svg></a></nav><main><section class="hero"><svg data-lucide="star" aria-hidden="true"><path d="M1 1L2 2"></path></svg><a class="cta" href="/download">Download</a><form action="/search"><input aria-label="Search"></form><script>window.__safe = true</script></section><section><article class="card">One</article><article class="card">Two</article></section></main></body></html>`;

function direction(overrides: Partial<CreativeDirection> = {}): CreativeDirection {
  return CreativeDirectionSchema.parse({
    schemaVersion: "creative-direction/1.0",
    mode: "cream",
    visualArchetype: "illustrated_creative_play",
    emotionalTone: ["playful", "friendly"],
    palette: {
      background: "#FFF8E8",
      surface: "#FFFFFF",
      surfaceAlt: "#F5E6C8",
      foreground: "#302A24",
      foregroundMuted: "#6B625A",
      accent: "#7C3AED",
      accentInk: "#FFFFFF",
      border: "#D8C7AB",
    },
    typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "balanced" },
    geometry: { radius: "soft", radiusScale: 1, spacingScale: 1, density: "low_medium" },
    imagery: { strategy: "illustration_first", artDirection: "hand_drawn", subjects: ["animals"], avoid: ["photorealism"] },
    iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
    componentTreatment: { cards: "soft_bordered", buttons: "rounded_filled", navigation: "simple", sections: "airy" },
    requiredVisualSignals: ["playful"],
    forbiddenVisualSignals: ["corporate"],
    ...overrides,
  });
}

function plan(overrides: Partial<SkeletonAdaptationPlan> = {}): SkeletonAdaptationPlan {
  return SkeletonAdaptationPlanSchema.parse({
    schemaVersion: "skeleton-adaptation-plan/1.0",
    tokens: { "--ol-bg": "#FFF8E8", "--ol-accent": "#7C3AED" },
    cssOverride: [{ hookId: "hero", declarations: { "background-color": "#FFF8E8", color: "#302A24" } }],
    assets: [],
    ...overrides,
  });
}

function compile(overrides: Partial<Parameters<typeof compileSkeletonIdentity>[0]> = {}) {
  return compileSkeletonIdentity({
    html: NORMALIZED_SKELETON_HTML,
    inventory: buildSkeletonInventory(NORMALIZED_SKELETON_HTML, "color-base"),
    direction: direction(),
    plan: plan(),
    ...overrides,
  });
}

describe("compileSkeletonIdentity", () => {
  it("applies explicit accent over brand, creative direction, and the original template", () => {
    const result = compile({ brand: { accent: "#0057B8" }, explicitOverrides: { accent: "#E6007E" } });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#E6007E");
    expect(result.html.match(/data-openlen-visual-engine/g)).toHaveLength(1);
    expect(result.html).not.toContain("data-ol-mode=");
  });

  it("applies saved brand accent over creative direction when no explicit accent exists", () => {
    const result = compile({ brand: { accent: "#0057B8" } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#0057B8");
  });

  it("applies creative direction over original template tokens", () => {
    const result = compile({ plan: plan({ tokens: {} }) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#7C3AED");
  });

  it("rederives dependent colors when a higher-precedence tier changes their base role", () => {
    const result = compile({ explicitOverrides: { accent: "#FFFF00" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#FFFF00");
    expect(readThemeTokenFromHtml(result.html, "--ol-accent-ink")).not.toBe("#FFFFFF");
  });

  it.each(["dark mode", "modo oscuro"])("recognizes exact %s as a machine override without writing data-ol-mode", (constraint) => {
    const result = compile({ explicitConstraints: [constraint] });
    expect(result).toMatchObject({ ok: true, mode: "dark", enforcedConstraints: [constraint] });
    if (result.ok) expect(result.html).not.toContain("data-ol-mode=");
  });

  it("parses exact role-labelled colors and registered font names but does not claim ambiguous prose", () => {
    const result = compile({
      explicitConstraints: [
        "accent: #E6007E",
        "display font: Plus Jakarta Sans",
        "body font: Inter",
        "make it somewhat darker and more editorial",
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#E6007E");
    expect(readThemeTokenFromHtml(result.html, "--ol-font-display")).toBe("'Plus Jakarta Sans', sans-serif");
    expect(readThemeTokenFromHtml(result.html, "--ol-font-body")).toBe("'Inter', sans-serif");
    expect(result.enforcedConstraints).toEqual([
      "accent: #E6007E",
      "display font: Plus Jakarta Sans",
      "body font: Inter",
    ]);
  });

  it("does not report a parsed constraint that a later structured override supersedes", () => {
    const result = compile({ explicitConstraints: ["accent: #E6007E", "dark mode"], explicitOverrides: { accent: "#0057B8", mode: "light" } });
    expect(result).toMatchObject({ ok: true, mode: "light", enforcedConstraints: [] });
    if (result.ok) expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#0057B8");
  });

  it("recognizes every palette role and reports only values reflected after precedence", () => {
    const result = compile({
      explicitConstraints: ["surfaceAlt: #EEEEDD", "foreground muted: #655D55", "accent ink: #FFFFFF"],
      explicitOverrides: { surfaceAlt: "#DDDDCC" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readThemeTokenFromHtml(result.html, "--ol-surface-2")).toBe("#DDDDCC");
    expect(readThemeTokenFromHtml(result.html, "--ol-fg-muted")).toBe("#655D55");
    expect(result.enforcedConstraints).toEqual(["foreground muted: #655D55", "accent ink: #FFFFFF"]);
  });

  it.each(["accent: red", "surfaceAlt: #FFF", "foreground muted: #12GG00", "accent:", "surfaceAlt:   ", "accent:\nred"])("rejects malformed structured color constraint %s", (constraint) => {
    expect(compile({ explicitConstraints: [constraint] })).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("compiles iconography through the inventory icon hook without replacing SVG or logo markup", () => {
    const result = compile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain("stroke-linecap:round");
    expect(result.html).toContain("stroke-linejoin:round");
    expect(result.html).toContain("stroke-width:2");
    expect(result.html).toContain('<svg id="brand-logo" aria-label="Logo"><path d="M0 0L8 8"></path></svg>');
    expect(result.html).toContain('<svg data-lucide="star" aria-hidden="true"><path d="M1 1L2 2"></path></svg>');
  });

  it("rejects an inventory icon hook that would visually target a protected logo", () => {
    const html = NORMALIZED_SKELETON_HTML.replace('<svg id="brand-logo" aria-label="Logo">', '<svg id="brand-logo" aria-label="Logo" data-lucide="brand">');
    const result = compile({ html, inventory: buildSkeletonInventory(html, "color-base") });
    expect(result).toMatchObject({ ok: false, code: "invalid_inventory" });
  });

  it.each([
    '<a class="brand" href="/home"><svg data-lucide="spark"></svg></a>',
    '<a href="/"><svg data-lucide="spark"></svg></a>',
  ])("rejects semantic navigation brand artwork without requiring logo text: %s", (markup) => {
    const html = NORMALIZED_SKELETON_HTML.replace('<a href="/" class="brand"><svg id="brand-logo" aria-label="Logo"><path d="M0 0L8 8"></path></svg></a>', markup);
    expect(compile({ html, inventory: buildSkeletonInventory(html, "color-base") })).toMatchObject({ ok: false, code: "invalid_inventory" });
  });

  it("retains a genuine non-brand navigation icon", () => {
    const html = NORMALIZED_SKELETON_HTML.replace("</nav>", '<a href="/search" aria-label="Search"><svg data-lucide="search"></svg></a></nav>');
    expect(compile({ html, inventory: buildSkeletonInventory(html, "color-base") })).toMatchObject({ ok: true });
  });

  it("does not classify every icon as a logo because an outer document ancestor says home", () => {
    const html = NORMALIZED_SKELETON_HTML.replace("<body ", '<body class="home" ').replace("</nav>", '<a href="/search" aria-label="Search"><svg data-lucide="search"></svg></a></nav>');
    expect(compile({ html, inventory: buildSkeletonInventory(html, "color-base") })).toMatchObject({ ok: true });
  });

  it("protects a root home link even when another navigation link comes first", () => {
    const html = NORMALIZED_SKELETON_HTML.replace('<a href="/" class="brand"><svg id="brand-logo" aria-label="Logo"><path d="M0 0L8 8"></path></svg></a>', '<a href="/search">Search</a><a href="/"><svg data-lucide="spark"></svg></a>');
    expect(compile({ html, inventory: buildSkeletonInventory(html, "color-base") })).toMatchObject({ ok: false, code: "invalid_inventory" });
  });

  it.each([
    '<a id="brandLogo" href="/elsewhere"><svg data-lucide="spark"></svg></a>',
    '<a href="/home/"><svg data-lucide="spark"></svg></a>',
    '<a href="/inicio/"><svg data-lucide="spark"></svg></a>',
  ])("protects additional semantic brand markers and home paths: %s", (markup) => {
    const html = NORMALIZED_SKELETON_HTML.replace('<a href="/" class="brand"><svg id="brand-logo" aria-label="Logo"><path d="M0 0L8 8"></path></svg></a>', `<a href="/search">Search</a>${markup}`);
    expect(compile({ html, inventory: buildSkeletonInventory(html, "color-base") })).toMatchObject({ ok: false, code: "invalid_inventory" });
  });

  it("is idempotent and serializes exactly one deterministic style block before head closes", () => {
    const first = compile();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = compile({ html: first.html, inventory: buildSkeletonInventory(first.html, "color-base") });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.html).toBe(first.html);
    expect(second.html.match(/<style data-openlen-visual-engine="creative-direction\/1\.0">/g)).toHaveLength(1);
    expect(second.html.indexOf("data-openlen-visual-engine")).toBeLessThan(second.html.indexOf("</head>"));
  });

  it("replaces an earlier Visual Engine version while preserving unrelated style blocks", () => {
    const html = NORMALIZED_SKELETON_HTML.replace(
      "</head>",
      '<style>.owned-by-template{color:red}</style><style data-openlen-visual-engine="creative-direction/0.9">body{color:pink}</style></head>',
    );
    const result = compile({ html, inventory: buildSkeletonInventory(html, "color-base") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html.match(/data-openlen-visual-engine/g)).toHaveLength(1);
    expect(result.html).not.toContain("creative-direction/0.9");
    expect(result.html).toContain(".owned-by-template{color:red}");
  });

  it("preserves style blocks with lookalike attributes exactly", () => {
    const lookalike = '<style x-data-openlen-visual-engine="other-owner">.keep-me{display:block}</style>';
    const html = NORMALIZED_SKELETON_HTML.replace("</head>", `${lookalike}</head>`);
    const result = compile({ html, inventory: buildSkeletonInventory(html, "color-base") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain(lookalike);
  });

  it("preserves attribute-name text embedded inside another style attribute value", () => {
    const lookalike = `<style title=' data-openlen-visual-engine="documentation"'>.quoted-lookalike{display:block}</style>`;
    const html = NORMALIZED_SKELETON_HTML.replace("</head>", `${lookalike}</head>`);
    const result = compile({ html, inventory: buildSkeletonInventory(html, "color-base") });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain(lookalike);
  });

  it("inserts before the parsed head close, ignoring literal close text in comments, attributes, and scripts", () => {
    const html = NORMALIZED_SKELETON_HTML.replace(
      "<title>Coloring</title>",
      '<!-- </head> --><meta content="</head>"><script>window.fakeHead="</head>"</script><title>Coloring</title>',
    );
    const result = compile({ html, inventory: buildSkeletonInventory(html, "color-base") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<!-- </head> --><meta content="</head>"><script>window.fakeHead="</head>"</script><title>Coloring</title>');
    expect(result.html.indexOf("data-openlen-visual-engine")).toBeGreaterThan(result.html.indexOf("<title>Coloring</title>"));
    expect(result.html.match(/data-openlen-visual-engine/g)).toHaveLength(1);
  });

  it.each([
    "url(https://example.com/a.png)",
    "@import 'x'",
    "expression(alert(1))",
    "behavior:url(x)",
    "-moz-binding:url(x)",
    "var(--outside)",
    "display:none",
    "position",
    "z-index",
    "overflow",
    "pointer-events",
    "content",
    "#ffffff; color:#000000",
    "calc(1rem + (2px)",
  ])("rejects dangerous CSS value %s with a typed policy failure", (value) => {
    const unsafePlan = {
      ...plan(),
      cssOverride: [{ hookId: "hero", declarations: { "box-shadow": value } }],
    } as SkeletonAdaptationPlan;
    expect(compile({ plan: unsafePlan })).toMatchObject({ ok: false, code: "css_policy_violation" });
  });

  it.each([
    ["padding", "clamp(1px)"],
    ["padding", "calc(1px + )"],
    ["padding", "1vh"],
    ["padding", "-1px"],
    ["gap", "1rem -2px"],
    ["gap", "1px 2px 3px 4px 5px"],
    ["border-radius", "min(1px, 2px)"],
    ["border-radius", "clamp(1px, 2px, 3px, 4px)"],
    ["padding", "var(--ol-accent)"],
    ["padding", "calc(var(--ol-font-body) * 1rem)"],
    ["padding", "calc(1px * 2px)"],
    ["padding", "calc(1px / 0)"],
    ["padding", "calc(0 - 1px)"],
    ["padding", "calc(1 + 2 * 1px)"],
    ["padding", "calc(1px+2px)"],
    ["padding", "var(--OL-RADIUS)"],
  ])("rejects semantically invalid spacing %s: %s", (property, value) => {
    const unsafePlan = { ...plan(), cssOverride: [{ hookId: "hero", declarations: { [property]: value } }] } as SkeletonAdaptationPlan;
    expect(compile({ plan: unsafePlan })).toMatchObject({ ok: false, code: "css_policy_violation" });
  });

  it.each([
    ["padding", "1px 2rem 0 3em"],
    ["gap", "calc(var(--ol-space-scale) * 1rem) 2rem"],
    ["border-radius", "clamp(1px, 2rem, 3em)"],
  ])("accepts bounded spacing grammar %s: %s", (property, value) => {
    const safePlan = { ...plan(), cssOverride: [{ hookId: "hero", declarations: { [property]: value } }] } as SkeletonAdaptationPlan;
    expect(compile({ plan: safePlan })).toMatchObject({ ok: true });
  });

  it("rejects an unknown hook", () => {
    const unsafePlan = { ...plan(), cssOverride: [{ hookId: "footer", declarations: { color: "#FFFFFF" } }] } as SkeletonAdaptationPlan;
    expect(compile({ plan: unsafePlan })).toMatchObject({ ok: false, code: "unknown_hook", hookId: "footer" });
  });

  it("returns a typed failure instead of throwing for a structurally malformed runtime plan", () => {
    const malformed = { ...plan(), cssOverride: [{ hookId: "hero", declarations: null }] } as unknown as SkeletonAdaptationPlan;
    expect(() => compile({ plan: malformed })).not.toThrow();
    expect(compile({ plan: malformed })).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it.each([
    { explicitConstraints: [null] },
    { brand: { accent: 42 } },
    { explicitOverrides: { mode: "sepia" } },
    { explicitOverrides: { mode: ["dark"] } },
    { explicitOverrides: { mode: new String("dark") } },
    { explicitOverrides: { mode: { toString: (): string => "dark" } } },
  ])("returns invalid_input for malformed optional runtime input %#", (runtimeInput) => {
    const invoke = () => compile(runtimeInput as unknown as Partial<Parameters<typeof compileSkeletonIdentity>[0]>);
    expect(invoke).not.toThrow();
    expect(invoke()).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects a property not granted to the selected hook", () => {
    const unsafePlan = { ...plan(), cssOverride: [{ hookId: "hero", declarations: { fill: "currentColor" } }] } as SkeletonAdaptationPlan;
    expect(compile({ plan: unsafePlan })).toMatchObject({ ok: false, code: "property_not_allowed", hookId: "hero", property: "fill" });
  });

  it("rejects arbitrary font families", () => {
    expect(compile({ plan: plan({ tokens: { "--ol-font-display": "Comic Sans MS" } }) })).toMatchObject({ ok: false, code: "font_not_registered" });
  });

  it("rejects arbitrary model-provided icon paint values", () => {
    const unsafePlan = { ...plan(), cssOverride: [{ hookId: "icons", declarations: { stroke: "red" } }] } as SkeletonAdaptationPlan;
    expect(compile({ plan: unsafePlan })).toMatchObject({ ok: false, code: "icon_policy_violation", property: "stroke" });
  });

  it.each([
    ["foreground/background", { palette: { ...direction().palette, foreground: "#FFFFFF", background: "#FFFFFF" } }],
    ["foreground/surface", { palette: { ...direction().palette, foreground: "#FFFFFF", surface: "#FFFFFF" } }],
    ["accent/accentInk", { palette: { ...direction().palette, accent: "#FFFFFF", accentInk: "#FFFFFF" } }],
  ] as const)("rejects %s contrast below WCAG AA", (_pair, override) => {
    expect(compile({ direction: direction(override as Partial<CreativeDirection>), plan: plan({ tokens: {} }) })).toMatchObject({ ok: false, code: "contrast_violation" });
  });

  it("preserves structure, behavior, accessibility and protected attributes", () => {
    const result = compile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const fragment of [
      'href="/download"',
      '<form action="/search">',
      '<script>window.__safe = true</script>',
      'aria-label="Search"',
      'data-ol-editor="safe"',
    ]) expect(result.html).toContain(fragment);
  });
});
