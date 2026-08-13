import { describe, expect, it } from "vitest";

import {
  compileExpressiveSection,
  type CompileExpressiveSectionSuccess,
} from "./expressive-section-compiler";
import type {
  ExpressiveNode,
  ExpressiveSectionProgram,
  SectionDecisionProvenance,
} from "./expressive-section-contracts";

const GENERATE: SectionDecisionProvenance = {
  schemaVersion: "section-decision-provenance/1.0",
  action: "generate",
  candidateId: null,
  sourceTemplateId: null,
  sourceBandOrdinal: null,
  sourceContentHash: null,
  sourceStructuralFingerprint: null,
  usefulTraits: [],
};

const copy = (id: string, variant: "heading" | "body" | "quote" | "stat" | "badge", copyKey: string, size: "sm" | "md" | "lg" | "xl" | "2xl" | "display" = "md") => ({
  kind: "copy" as const, id, variant, copyKey, tone: "default" as const, size, color: "ink" as const, align: "start" as const,
});
const media = (id: string, slotIndex: number, treatment: "plain" | "framed" | "bleed" | "cutout" | "film" | "paper") => ({
  kind: "media" as const, id, slotIndex, aspect: "cinematic" as const, fit: "cover" as const, treatment, radius: "lg" as const, transform: "none" as const,
});
const decoration = (id: string, shape: "circle" | "star" | "grain" | "line") => ({
  kind: "decoration" as const, id, decoration: shape === "grain" ? "texture" as const : shape === "line" ? "divider" as const : "shape" as const,
  shape, color: "accent" as const, size: "lg" as const, transform: "tilt_left" as const, blend: "overlay" as const, opacity: "soft" as const,
});
const layout = (id: string, preset: "stack" | "split" | "collage" | "bento" | "layered", children: readonly ExpressiveNode[]) => ({
  kind: "layout" as const, id, preset, children, gap: "md" as const, padding: "lg" as const, width: "wide" as const,
  align: "stretch" as const, justify: "between" as const, columns: preset === "split" ? "asymmetric_left" as const : "two" as const,
  color: "surface" as const, radius: "lg" as const, border: "hairline" as const, transform: "none" as const, blend: "normal" as const,
});

function fixture(
  role: ExpressiveSectionProgram["role"],
  root: ExpressiveNode,
  mobileNodeId: string,
  motionNodeId: string,
  motion: ExpressiveSectionProgram["motion"][number]["preset"],
): ExpressiveSectionProgram {
  return {
    schemaVersion: "expressive-section-program/1.0",
    role,
    root,
    responsive: { mobile: [{ nodeId: mobileNodeId, preset: "stack", columns: "one", gap: "sm", padding: "sm", hidden: false }] },
    motion: [{ nodeId: motionNodeId, preset: motion, intensity: "medium", delay: "short" }],
  };
}

const FIXTURES = {
  vhsHorror: fixture("hero", layout("horror-root", "layered", [
    media("horror-frame", 0, "film"), copy("horror-title", "heading", "hero.title", "display"), decoration("horror-grain", "grain"),
  ]), "horror-root", "horror-grain", "drift"),
  childrenColoring: fixture("activities", layout("color-root", "collage", [
    decoration("color-star", "star"), copy("color-title", "heading", "activities.title", "2xl"), media("color-sheet", 1, "paper"),
  ]), "color-root", "color-star", "stagger"),
  editorialFood: fixture("menu", layout("food-root", "split", [
    copy("food-quote", "quote", "menu.quote", "xl"), decoration("food-rule", "line"), media("food-photo", 2, "bleed"),
  ]), "food-root", "food-photo", "reveal"),
  luxuryHotel: fixture("booking", layout("hotel-root", "bento", [
    media("hotel-suite", 3, "framed"), copy("hotel-stat", "stat", "booking.stat", "2xl"), decoration("hotel-orbit", "circle"),
  ]), "hotel-root", "hotel-stat", "fade_up"),
} as const;

function compile(
  program: ExpressiveSectionProgram,
  copyValues: Readonly<Record<string, string>> = {},
  provenance: SectionDecisionProvenance = GENERATE,
) {
  return compileExpressiveSection({
    program,
    allowedCopyKeys: ["hero.title", "activities.title", "menu.quote", "booking.stat", "cta.label"],
    allowedAssetSlots: [0, 1, 2, 3],
    copy: copyValues,
    provenance,
  });
}

describe("expressive section compiler", () => {
  it("compiles escaped copy into repository-owned markup and destinations", () => {
    const action = {
      kind: "copy" as const, id: "cta", variant: "action" as const, copyKey: "cta.label", destination: "contact" as const,
      tone: "accent" as const, size: "md" as const, color: "accent_ink" as const, align: "center" as const,
    };
    const program = fixture("hero", layout("safe-root", "split", [copy("title", "heading", "hero.title", "display"), action]), "safe-root", "title", "fade_up");
    const result = compile(program, { "hero.title": "Stay <script>alert(1)</script> & rest", "cta.label": "Reserve \"now\"" });
    expect(result).toMatchObject({ ok: true, draft: { rootTag: "header", role: "hero", programHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) } });
    const html = (result as CompileExpressiveSectionSuccess).draft.html;
    expect(html).toContain("Stay &lt;script&gt;alert(1)&lt;/script&gt; &amp; rest");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('<a class="olx-copy olx-action');
    expect(html).toContain('href="#contact"');
    expect(html).not.toContain("safe-root");
    expect(html).not.toContain("hero.title");
    expect(html).toMatch(/class="olx-layout olx-layout-split olx-node-0/);
  });

  it("owns breakpoints and reduced-motion CSS while decorations stay inert", () => {
    const result = compile(FIXTURES.vhsHorror, { "hero.title": "Midnight Archive" });
    expect(result.ok).toBe(true);
    const html = (result as CompileExpressiveSectionSuccess).draft.html;
    expect(html).toContain("@media(max-width:640px)");
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/on(?:click|load|error)=|javascript:|<script|@import/i);
    expect(html).not.toContain("horror-grain");
  });

  it("materializes copy tone and decoration kind so visual fingerprints do not distinguish identical renders", () => {
    const sourceRoot = FIXTURES.childrenColoring.root;
    if (sourceRoot.kind !== "layout") throw new Error("fixture root must be a layout");
    const textured = {
      ...FIXTURES.childrenColoring,
      root: {
        ...sourceRoot,
        children: sourceRoot.children.map((node) => node.kind === "decoration"
          ? { ...node, decoration: "texture" as const }
          : node),
      },
    };
    const shaped = compile(FIXTURES.childrenColoring);
    const result = compile(textured);
    expect(shaped.ok && result.ok).toBe(true);
    const shapedHtml = (shaped as CompileExpressiveSectionSuccess).draft.html;
    const texturedHtml = (result as CompileExpressiveSectionSuccess).draft.html;
    expect(shapedHtml).toContain("olx-tone-default");
    expect(shapedHtml).toContain("olx-decoration-shape");
    expect(texturedHtml).toContain("olx-decoration-texture");
    expect(shapedHtml).not.toBe(texturedHtml);
  });

  it("gives every copy tone a cascade-winning semantic style across copy variants", () => {
    const toneStyle = {
      default: "font-weight:500;letter-spacing:0",
      quiet: "font-weight:400;letter-spacing:.02em;opacity:.72",
      strong: "font-weight:900;letter-spacing:-.01em",
    } as const;
    for (const [tone, declarations] of Object.entries(toneStyle)) {
      const heading = {
        schemaVersion: "expressive-section-program/1.0" as const,
        role: "hero" as const,
        root: { ...copy("title", "heading", "hero.title"), tone: tone as keyof typeof toneStyle },
        responsive: { mobile: [] },
        motion: [],
      };
      const result = compile(heading);
      expect(result.ok).toBe(true);
      const html = (result as CompileExpressiveSectionSuccess).draft.html;
      expect(html).toContain(`.olx-copy.olx-tone-${tone}{${declarations}`);
      expect(html).toContain(`olx-heading olx-node-0 olx-tone-${tone}`);
    }

    const variants = fixture("hero", layout("all-copy-kinds", "stack", [
      { ...copy("heading", "heading", "hero.title"), tone: "strong" as const },
      { ...copy("body", "body", "activities.title"), tone: "strong" as const },
      { ...copy("quote", "quote", "menu.quote"), tone: "strong" as const },
      { ...copy("stat", "stat", "booking.stat"), tone: "strong" as const },
      { ...copy("badge", "badge", "cta.label"), tone: "strong" as const },
      { kind: "copy" as const, id: "list", variant: "list" as const, copyKeys: ["hero.title", "activities.title"], tone: "strong" as const, size: "md" as const, color: "ink" as const, align: "start" as const },
      { kind: "copy" as const, id: "action", variant: "action" as const, copyKey: "cta.label", destination: "contact" as const, tone: "strong" as const, size: "md" as const, color: "ink" as const, align: "start" as const },
    ]), "all-copy-kinds", "heading", "fade_up");
    const result = compile(variants);
    expect(result.ok).toBe(true);
    const html = (result as CompileExpressiveSectionSuccess).draft.html;
    for (const variant of ["heading", "body", "quote", "stat", "badge", "list", "action"]) {
      expect(html).toContain(`olx-${variant} olx-node-`);
      expect(html).toContain("olx-tone-strong");
    }

    const textured = compile({
      ...FIXTURES.childrenColoring,
      root: { ...FIXTURES.childrenColoring.root as Extract<ExpressiveNode, { kind: "layout" }>, children: FIXTURES.childrenColoring.root.kind === "layout" ? FIXTURES.childrenColoring.root.children.map((node) => node.kind === "decoration" ? { ...node, decoration: "texture" as const } : node) : [] },
    });
    expect(textured.ok).toBe(true);
    const textureCss = (textured as CompileExpressiveSectionSuccess).draft.html.match(/\.olx-decoration-texture\{([^}]*)}/)?.[1] ?? "";
    expect(textureCss).not.toContain("mix-blend-mode");
  });

  it("fails closed on invalid programs, references, and provenance", () => {
    expect(compileExpressiveSection({
      program: { ...FIXTURES.vhsHorror, html: "<section>raw</section>" } as never,
      allowedCopyKeys: ["hero.title"], allowedAssetSlots: [0], provenance: GENERATE,
    })).toEqual({ ok: false, code: "invalid_program" });
    expect(compileExpressiveSection({
      program: FIXTURES.vhsHorror, allowedCopyKeys: [], allowedAssetSlots: [0], provenance: GENERATE,
    })).toEqual({ ok: false, code: "copy_key_not_allowed" });
    expect(compileExpressiveSection({
      program: FIXTURES.vhsHorror, allowedCopyKeys: ["hero.title"], allowedAssetSlots: [], provenance: GENERATE,
    })).toEqual({ ok: false, code: "asset_slot_not_allowed" });
    expect(compileExpressiveSection({
      program: FIXTURES.vhsHorror, allowedCopyKeys: ["hero.title"], allowedAssetSlots: [0], provenance: { ...GENERATE, action: "reuse" } as never,
    })).toEqual({ ok: false, code: "invalid_provenance" });
  });

  it("rejects a rebuild that reproduces the donor fingerprint or content hash", () => {
    const generated = compile(FIXTURES.editorialFood, { "menu.quote": "Slow fire" });
    expect(generated.ok).toBe(true);
    const draft = (generated as CompileExpressiveSectionSuccess).draft;
    const rebuild = {
      schemaVersion: "section-decision-provenance/1.0" as const,
      action: "rebuild" as const,
      candidateId: "food-source",
      sourceTemplateId: "donor-food",
      sourceBandOrdinal: 4,
      sourceContentHash: "a".repeat(12),
      sourceStructuralFingerprint: draft.structuralFingerprint,
      usefulTraits: ["editorial"],
    };
    expect(compile(FIXTURES.editorialFood, { "menu.quote": "Slow fire" }, rebuild)).toEqual({ ok: false, code: "donor_reconstruction" });
    expect(compile(FIXTURES.editorialFood, { "menu.quote": "Slow fire" }, {
      ...rebuild,
      sourceStructuralFingerprint: `sha256:${"b".repeat(64)}`,
      sourceContentHash: draft.contentHash,
    })).toEqual({ ok: false, code: "donor_reconstruction" });
  });

  it("proves four niche fixtures have distinct safe structures and treatments", () => {
    const results = Object.values(FIXTURES).map((program) => compile(program));
    expect(results.every((result) => result.ok)).toBe(true);
    const drafts = results.map((result) => (result as CompileExpressiveSectionSuccess).draft);
    expect(new Set(drafts.map((draft) => draft.structuralFingerprint))).toHaveLength(4);
    expect(new Set(drafts.map((draft) => draft.programHash))).toHaveLength(4);
    expect(drafts.map((draft) => draft.html).join("\n")).toMatch(/olx-layout-layered[\s\S]*olx-layout-collage[\s\S]*olx-layout-split[\s\S]*olx-layout-bento/);
    expect(drafts.map((draft) => draft.html).join("\n")).toMatch(/olx-media-film[\s\S]*olx-media-paper[\s\S]*olx-media-bleed[\s\S]*olx-media-framed/);
  });

  it("does not let renamed node IDs disguise the same generated program", () => {
    const sourceRoot = FIXTURES.childrenColoring.root;
    if (sourceRoot.kind !== "layout") throw new Error("fixture root must be a layout");
    const original = compile(FIXTURES.childrenColoring);
    const renamed = compile({
      ...FIXTURES.childrenColoring,
      root: { ...sourceRoot, id: "renamed-root", children: sourceRoot.children.map((node, index) => ({ ...node, id: `renamed-${index}` })) },
      responsive: { mobile: [{ ...FIXTURES.childrenColoring.responsive.mobile[0], nodeId: "renamed-root" }] },
      motion: [{ ...FIXTURES.childrenColoring.motion[0], nodeId: "renamed-0" }],
    });
    expect(original.ok && renamed.ok).toBe(true);
    expect((original as CompileExpressiveSectionSuccess).draft.programHash).toBe((renamed as CompileExpressiveSectionSuccess).draft.programHash);
  });
});
