import { createHash } from "node:crypto";

import { parse } from "node-html-parser";
import { describe, expect, it, vi } from "vitest";

import { StableTargetIdSchema } from "./creative-sandbox-contracts";

import { detectTemplateLeaks } from "@/lib/assemble/leaks";
import type { SectionRecord } from "@/lib/sections/store";
import { composeSectionCandidate } from "@/lib/generation/compose-sections";
import { buildDeterministicIntent, buildDeterministicPageCopy } from "./deterministic-page-input";
import { sha256 } from "@/lib/generation/content-hash";
import { buildCreativeBaseline, type CreativeBaselineDeps } from "./creative-baseline";

const BRIEF = "Crea una página para Mundo Pincel, dibujos para imprimir y colorear para niños de 2 a 10 años";

const DONOR_SOURCE = `<!doctype html><html><head></head><body>
<header data-openlen-role="header"><a href="#top">MORADA STUDIO</a></header>
<section data-openlen-role="hero"><h1>MORADA — arquitectura sin ruido</h1><p>Proyectos residenciales en concreto aparente desde 2009.</p><a href="#contacto">Agendar visita</a></section>
<section data-openlen-role="features"><h2>Servicios MORADA</h2><ul><li>Obra nueva</li><li>Remodelación</li></ul></section>
<footer data-openlen-role="footer"><p>© MORADA STUDIO</p></footer>
</body></html>`;

const RECORDS = [
  { id: "hero-one", type: "hero" },
  { id: "features-one", type: "features" },
  { id: "footer-one", type: "footer" },
] as unknown as SectionRecord[];

const INPUT = {
  projectId: "11111111-1111-4111-8111-111111111111",
  brief: BRIEF,
  profileData: { brand: { accent: "#F06AA6", logoUrl: null } } as never,
  records: RECORDS,
};

function makeDeps(over: {
  composedHtml?: string;
  provider?: () => never;
  sealed?: boolean;
  rendered?: { mobileOverflow: boolean; invalidGeometry: boolean; weakTypography?: boolean } | null;
} = {}): CreativeBaselineDeps & { seenDeps: Record<string, unknown>[] } {
  const seenDeps: Record<string, unknown>[] = [];
  return {
    seenDeps,
    // Mirrors the real composer: it calls the injected fill seam, so the stub
    // must too or the local fill silently never runs.
    composeSection: (async (_input: unknown, deps: Record<string, unknown>) => {
      seenDeps.push(deps ?? {});
      const source = over.composedHtml ?? DONOR_SOURCE;
      const fill = deps.fillAssembled as ((html: string) => Promise<{ html: string }>) | undefined;
      const filled = fill ? await fill(source) : { html: source };
      return {
        ok: true as const,
        status: "composed" as const,
        html: filled.html,
        creativeDirection: { schemaVersion: "creative-direction/1.0" },
        manifest: { schemaVersion: "section-composition-manifest/1.0", outputHash: `sha256:${"a".repeat(64)}` },
        fill: { filled: false, appliedOps: 0, usage: null, durationMs: 0, leaksBefore: 0, leaksAfter: 0 },
        adaptation: {},
      };
    }) as never,
    finalize: ((input: { html: string }) => ({ ok: true as const, html: input.html })) as never,
    seal: ((html: string) => ({ html, sealed: over.sealed ?? true })) as never,
    render: (async () => (over.rendered === undefined
      ? { mobileOverflow: false, invalidGeometry: false }
      : over.rendered)) as never,
  } as CreativeBaselineDeps & { seenDeps: Record<string, unknown>[] };
}

describe("provider-free creative baseline", () => {
  it("builds and renders a safe Mundo Pincel baseline without any provider", async () => {
    const provider = vi.fn(() => { throw new Error("provider must not run"); });
    const deps = makeDeps({ provider });
    const result = await buildCreativeBaseline(INPUT, deps);
    expect(result).toMatchObject({ ok: true, candidate: { title: "Mundo Pincel", source: "baseline" } });
    if (!result.ok) return;
    expect(result.candidate.html).toContain('data-openlen-role="hero"');
    expect(result.candidate.html).not.toContain("MORADA");
    expect(result.candidate.visualEngine.templateId).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    // GLM section generation is never offered, and the two paid seams are
    // replaced with deterministic ones rather than left to their defaults.
    expect(deps.seenDeps[0].generateMissing).toBeUndefined();
    expect(deps.seenDeps[0].fillAssembled).toEqual(expect.any(Function));
    expect(deps.seenDeps[0].adaptTemplateSkeleton).toEqual(expect.any(Function));
    expect(deps.seenDeps[0].beforeCreative).toBeUndefined();
  });

  it("fails before paid work when no catalog fragment can form a safe baseline", async () => {
    await expect(buildCreativeBaseline({ ...INPUT, records: [] }, makeDeps()))
      .resolves.toMatchObject({ ok: false, code: "section_inventory_unavailable", detail: expect.any(String) });
  });

  it("replaces every substantive donor text block locally", async () => {
    const result = await buildCreativeBaseline(INPUT, makeDeps());
    expect(result.ok).toBe(true);
    expect(result.ok && detectTemplateLeaks(DONOR_SOURCE, result.candidate.html).damaging).toEqual([]);
  });

  it("reports the local fill instead of claiming an untouched document", async () => {
    const result = await buildCreativeBaseline(INPUT, makeDeps());
    expect(result.ok && result.candidate.filled).toBe(true);
    expect(result.ok && result.candidate.appliedOps).toBeGreaterThan(0);
  });

  it("rejects a baseline that will not seal", async () => {
    await expect(buildCreativeBaseline(INPUT, makeDeps({ sealed: false })))
      .resolves.toMatchObject({ ok: false, code: "baseline_invalid", detail: expect.any(String) });
  });

  it.each([
    ["overflows on mobile", { mobileOverflow: true, invalidGeometry: false }],
    ["renders invalid geometry", { mobileOverflow: false, invalidGeometry: true }],
    ["does not render at all", null],
  ] as const)("rejects a baseline that %s", async (_name, rendered) => {
    await expect(buildCreativeBaseline(INPUT, makeDeps({ rendered })))
      .resolves.toMatchObject({ ok: false, code: "baseline_invalid", detail: expect.any(String) });
  });

  it("treats weak typography as an improvement signal, not a safety abort", async () => {
    const result = await buildCreativeBaseline(
      INPUT,
      makeDeps({ rendered: { mobileOverflow: false, invalidGeometry: false, weakTypography: true } }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns the deterministic intent and copy it composed from, for the sandbox to build on", async () => {
    const result = await buildCreativeBaseline(INPUT, makeDeps());
    expect(result.ok && result.intent.functional.contentModel).toEqual(expect.any(String));
    expect(result.ok && result.copy.business_name).toBe("Mundo Pincel");
  });
});

// Fixtures shaped like real catalog rows, so this exercises the actual
// composer, plan, inventory and role-coverage gates — not a stubbed seam.
const BODY = {
  header: '<header data-sec="header-fix"><a href="#top">Donante marca</a><a href="#x">Donante enlace</a></header>',
  hero: '<header data-sec="hero-fix"><h1>Donante hero</h1><p>Texto donante</p><a href="#a">Acción</a></header>',
  features: '<section data-sec="features-fix"><h2>Donante features</h2><p>Uno</p><p>Dos</p><p>Tres</p></section>',
  cta: '<section data-sec="cta-fix"><h2>Donante cta</h2><a href="#c">Donante botón</a></section>',
  footer: '<footer data-sec="footer-fix"><p>Donante footer</p><a href="#b">Enlace</a></footer>',
};

function catalogRecord(id: string, type: string, rootTag: string, html: string, donorIndex: number) {
  const hash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  const sha = `sha256:${createHash("sha256").update(`${id}-fingerprint`).digest("hex")}`;
  return {
    id, type, name: id, variantLabel: "Base", rootTag, mode: "light",
    storageKey: `sections/${id}-${hash}.html`, storageUrl: `memory://${id}`, contentHash: hash, size: html.length,
    designTokens: null, fonts: null, needsJs: false, hasPlaceholders: false, thumbnailUrl: null,
    // Distinct donors: the originality gate refuses a page drawn from fewer
    // than three source templates, and manual sections do not count at all.
    provenance: {
      schemaVersion: "derived-section-provenance/1.0",
      sourceTemplateId: `donor-${donorIndex}`,
      sourceTemplateHash: hash,
      sourceBandOrdinal: donorIndex,
      extractionVersion: "template-band-extractor/1.0",
      sourceHash: `sha256:${createHash("sha256").update(html).digest("hex")}`,
      structuralFingerprint: sha,
    },
    derivedSemantics: {
      schemaVersion: "derived-section-semantics/1.0",
      role: type, layoutArchetypes: [], domains: [], audiences: [], moods: [], negativeSignals: [],
    },
    status: "published",
    createdAt: new Date(0), updatedAt: new Date(0), publishedAt: new Date(0),
  } as unknown as SectionRecord;
}

const CATALOG = [
  catalogRecord("header-fix", "navbar", "header", BODY.header, 0),
  catalogRecord("hero-fix", "hero", "header", BODY.hero, 1),
  catalogRecord("features-fix", "features", "section", BODY.features, 2),
  catalogRecord("cta-fix", "cta", "section", BODY.cta, 3),
  catalogRecord("footer-fix", "footer", "footer", BODY.footer, 4),
];

const CATALOG_FETCH = async (url: string) => {
  const key = url.replace("memory://", "").replace("-fix", "") as keyof typeof BODY;
  return BODY[key] ?? null;
};

// A brief no reviewed niche covers gets the generic intent, whose roles a
// modest catalog can cover.
const GENERIC_BRIEF = "Necesito un sitio para mi taller de restauración de relojes mecánicos";

describe("baseline against real catalog fragments", () => {
  it("composes, fills and seals a page with no provider seam stubbed", async () => {
    const result = await buildCreativeBaseline(
      { ...INPUT, brief: GENERIC_BRIEF, records: CATALOG },
      { fetchText: CATALOG_FETCH, render: async () => ({ mobileOverflow: false, invalidGeometry: false }) },
    );
    if (!result.ok) throw new Error(`baseline failed: ${result.code}`);
    expect(result.candidate.html).toContain("<html");
    expect(result.candidate.html).not.toContain("Donante");
    expect(result.candidate.appliedOps).toBeGreaterThan(0);
  });

  // Without stable handles the sandbox's outline is empty and every targeted
  // operation fails, leaving the model able to change only page CSS.
  it("hands the sandbox an addressable target for every role it composed", async () => {
    const result = await buildCreativeBaseline(
      { ...INPUT, brief: GENERIC_BRIEF, records: CATALOG },
      { fetchText: CATALOG_FETCH, render: async () => ({ mobileOverflow: false, invalidGeometry: false }) },
    );
    if (!result.ok) throw new Error(`baseline failed: ${result.code}`);

    const document = parse(result.candidate.html);
    const roles = document.querySelectorAll("[data-openlen-role]");
    const targets = document.querySelectorAll("[data-openlen-edit-id]");
    expect(roles.length).toBeGreaterThan(0);
    expect(targets).toHaveLength(roles.length);
    const ids = targets.map((node) => node.getAttribute("data-openlen-edit-id") ?? "");
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(StableTargetIdSchema.safeParse(id).success).toBe(true);
  });
});
