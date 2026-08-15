import { describe, expect, it, vi } from "vitest";

import { detectTemplateLeaks } from "@/lib/assemble/leaks";
import type { SectionRecord } from "@/lib/sections/store";
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
    composeSection: (async (_input: unknown, deps: Record<string, unknown>) => {
      seenDeps.push(deps ?? {});
      return {
        ok: true as const,
        status: "composed" as const,
        html: over.composedHtml ?? DONOR_SOURCE,
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
    // The paid seams of composeSectionCandidate must never be handed down.
    expect(deps.seenDeps[0].generateMissing).toBeUndefined();
    expect(deps.seenDeps[0].adaptTemplateSkeleton).toBeUndefined();
  });

  it("fails before paid work when no catalog fragment can form a safe baseline", async () => {
    await expect(buildCreativeBaseline({ ...INPUT, records: [] }, makeDeps()))
      .resolves.toEqual({ ok: false, code: "section_inventory_unavailable" });
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
      .resolves.toEqual({ ok: false, code: "baseline_invalid" });
  });

  it.each([
    ["overflows on mobile", { mobileOverflow: true, invalidGeometry: false }],
    ["renders invalid geometry", { mobileOverflow: false, invalidGeometry: true }],
    ["does not render at all", null],
  ] as const)("rejects a baseline that %s", async (_name, rendered) => {
    await expect(buildCreativeBaseline(INPUT, makeDeps({ rendered })))
      .resolves.toEqual({ ok: false, code: "baseline_invalid" });
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
