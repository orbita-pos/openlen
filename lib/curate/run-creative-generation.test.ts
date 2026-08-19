import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runCreativeGeneration, type CreativeGenerationDeps } from "./run-creative-generation";
import { SECTION_COMPOSITION_MANIFEST_VERSION } from "@/lib/generation/section-composition-contracts";

const BASELINE_HTML = "<!doctype html><html><body><section>baseline</section></body></html>";
const IMPROVED_HTML = "<!doctype html><html><body><section>improved</section></body></html>";

const VISUAL_ENGINE = { schemaVersion: "visual-engine-project/1.0", route: "section_composition", templateId: null } as never;

const BASELINE: SafeCreativeCandidate = {
  html: BASELINE_HTML, title: "Mundo Pincel", visualEngine: VISUAL_ENGINE,
  filled: true, appliedOps: 5, source: "baseline",
};
const IMPROVED: SafeCreativeCandidate = { ...BASELINE, html: IMPROVED_HTML, source: "deepseek" };

const H = (c: string) => `sha256:${c.repeat(64)}`;
// A real manifest: `sealAiCompositionOutput` re-parses it, so a stub shape
// would only prove the fail-soft path.
const MANIFEST = {
  schemaVersion: SECTION_COMPOSITION_MANIFEST_VERSION,
  intentHash: H("a"), creativeDirectionHash: H("b"), inventoryHash: H("c"),
  orderedRoles: ["hero"], selectedSectionIds: ["hero-one"], selectedContentHashes: ["d".repeat(12)],
  selectedSourceKinds: ["manual"], selectedSourceTemplateIds: [null],
  selectedSourceBandOrdinals: [null], selectedStructuralFingerprints: [H("e")],
  compatibilityRuleIds: ["section_component:hero"], outputHash: null, resultCode: "composed",
};

const INPUT = {
  projectId: "11111111-1111-4111-8111-111111111111",
  brief: "Una página de terror con estética VHS",
  profileData: { brand: { accent: "#000", logoUrl: null } } as never,
  records: [{ id: "hero-one", type: "hero" }] as never,
};

function deps(over: Partial<CreativeGenerationDeps> = {}): CreativeGenerationDeps {
  return {
    buildBaseline: async () => ({ ok: true, candidate: BASELINE, intent: { language: "es" } as never, copy: {} as never }),
    runCreativeSession: async () => ({ candidate: IMPROVED, changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished" }),
    runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: true, repaired: false, rounds: 1, accepted: true, exit: "accepted" as const }),
    validateDelivery: (({ visualEngine }: { visualEngine: unknown }) => ({ ok: true, visualEngine })) as never,
    ...over,
  };
}

describe("creative generation orchestration", () => {
  it("delivers the improved candidate when every stage works", async () => {
    const result = await runCreativeGeneration(INPUT, deps());
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: false });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
    expect(result.ok && result.title).toBe("Mundo Pincel");
  });

  it.each([
    ["deepseek_missing_key", { stoppedBy: "provider" as const }],
    ["deepseek_timeout", { stoppedBy: "provider" as const }],
    ["deepseek_invalid_tool", { stoppedBy: "provider" as const }],
    ["deepseek_budget", { stoppedBy: "budget" as const }],
  ])("delivers lastKnownGood on %s", async (_name, over) => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, rejections: [], ...over }),
    }));
    expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it("delivers lastKnownGood when the creative session throws outright", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => { throw new Error("transport exploded"); },
    }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
  });

  it.each(["qwen_timeout", "qwen_malformed", "qwen_reject"])("delivers the page on %s", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async ({ candidate }) => ({ candidate, reviewed: false, repaired: false, rounds: 0, accepted: false, exit: "render_failed" as const }),
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("delivers the page when the advisory review throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runAdvisoryReview: async () => { throw new Error("qwen down"); },
    }));
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toBe(IMPROVED_HTML);
  });

  it("fails only when no safe baseline can be built", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable", detail: "section_fragment_stale" }),
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition", reasonCode: "section_inventory_unavailable" });
  });

  // The public reason is coarse on purpose; the journal must still say which
  // of a dozen catalog failures actually happened.
  it("records the composer's own reason, not the collapsed public one", async () => {
    const recordFailure = vi.fn();
    await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable", detail: "section_fragment_stale" }),
      recordFailure,
    }));
    expect(recordFailure).toHaveBeenCalledWith("baseline", "section_fragment_stale");
  });

  it("fails when the baseline builder itself throws", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      buildBaseline: async () => { throw new Error("catalog down"); },
    }));
    expect(result).toMatchObject({ ok: false, stage: "composition" });
  });

  it("falls back to the baseline when the improved candidate fails final delivery", async () => {
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => (html === IMPROVED_HTML
      ? { ok: false as const, reasonCode: "invalid_composition_metadata" as const }
      : { ok: true as const, visualEngine }));
    const result = await runCreativeGeneration(INPUT, deps({ validateDelivery: validateDelivery as never }));
    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(result.ok && result.html).toBe(BASELINE_HTML);
    expect(validateDelivery).toHaveBeenCalledTimes(2);
  });

  it("aborts only when both the improvement and the baseline fail delivery", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      validateDelivery: (() => ({ ok: false, reasonCode: "invalid_composition_metadata" })) as never,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate", reasonCode: "invalid_composition_metadata" });
  });

  it("reports progress in the cutover order", async () => {
    const stages: string[] = [];
    await runCreativeGeneration({ ...INPUT, onStage: (stage) => stages.push(stage) }, deps());
    expect(stages).toEqual(["baseline", "creative", "review", "delivery_gate"]);
  });

  it("never lets a progress callback change delivery", async () => {
    const result = await runCreativeGeneration(
      { ...INPUT, onStage: () => { throw new Error("ui blew up"); } },
      deps(),
    );
    expect(result.ok).toBe(true);
  });

  // A degraded stage is redacted telemetry, not a failure: recording it as a
  // failure would spend the request's single terminal outcome on a page that
  // shipped fine.
  it("records a degraded stage without touching the terminal failure channel", async () => {
    const recordFailure = vi.fn();
    const recordDegraded = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: BASELINE, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "provider" }),
      recordFailure,
      recordDegraded,
    }));
    expect(result.ok).toBe(true);
    expect(recordDegraded).toHaveBeenCalledWith("creative_session", "provider");
    expect(recordFailure).not.toHaveBeenCalled();
    expect(JSON.stringify(recordDegraded.mock.calls)).not.toContain("<!doctype");
  });

  it("still records a terminal failure when no candidate can be delivered", async () => {
    const recordFailure = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({
      validateDelivery: (() => ({ ok: false as const, reasonCode: "invalid_composition_metadata" as const })) as never,
      recordFailure,
    }));
    expect(result).toMatchObject({ ok: false, stage: "delivery_gate" });
    expect(recordFailure).toHaveBeenCalledWith("delivery_gate", "invalid_composition_metadata");
  });

  it("passes the baseline's own intent and copy into the creative session", async () => {
    const runCreativeSession = vi.fn(async (_input: { baseline: SafeCreativeCandidate; brief: string }) => ({ candidate: IMPROVED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const }));
    await runCreativeGeneration(INPUT, deps({ runCreativeSession }));
    expect(runCreativeSession.mock.calls[0][0]).toMatchObject({ baseline: BASELINE, brief: INPUT.brief });
  });
});

describe("model palette adoption", () => {
  // The model redesigns with its own tokens while <html> keeps the direction's,
  // so a section it painted meets a library fragment reading --ol-* and the
  // seam shows. The theme drops to the model's values — but the delivery gate
  // compares sha256(html) against manifest.outputHash, so the bytes cannot move
  // without resealing.
  const THEMED = '<!doctype html><html class="dark" style="--ol-bg:#09090B"><head>'
    + "<style>:root{--bg:#070606}body{background:var(--bg)}</style></head>"
    + "<body><section>improved</section></body></html>";
  const themedEngine = { ...(VISUAL_ENGINE as object), compositionManifest: MANIFEST } as never;
  const themedCandidate: SafeCreativeCandidate = { ...IMPROVED, html: THEMED, visualEngine: themedEngine };

  it("drops the page theme to the palette the model painted with", async () => {
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: themedCandidate, changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished" }),
    }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("--ol-bg:#070606");
  });

  it("reseals the manifest, or the gate discards the whole session in silence", async () => {
    // Without the reseal this delivers the BASELINE: hash mismatch → refused →
    // fall back → still reported ok. The redesign the user paid for, gone, and
    // nothing in the result says so.
    const { sha256 } = await import("@/lib/generation/content-hash");
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => {
      const stamped = (visualEngine as { compositionManifest?: { outputHash?: string } })?.compositionManifest?.outputHash;
      return stamped === sha256(html)
        ? { ok: true as const, visualEngine }
        : { ok: false as const, reasonCode: "output_hash_mismatch" as const };
    }) as never;

    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({
        candidate: {
          ...themedCandidate,
          visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: { ...MANIFEST, outputHash: sha256(THEMED) } } as never,
        },
        changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished",
      }),
      validateDelivery,
    }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("--ol-bg:#070606");
    expect(result.ok && result.degraded).toBe(false);
  });

  it("anota el contrato de la página entregada sin poder bloquearla", async () => {
    const recordDegraded = vi.fn();
    const dirty = "<!doctype html><html><head><style>.hero{color:#ff0000}.card{background:#111}</style></head><body><section>x</section></body></html>";
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({ candidate: { ...IMPROVED, html: dirty }, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" }),
      recordDegraded,
    }));

    expect(result.ok && result.html).toBe(dirty);
    expect(recordDegraded).toHaveBeenCalledWith("delivery_gate", "contract:colors=2");
  });

  it("no anota nada cuando la página respeta el contrato", async () => {
    const recordDegraded = vi.fn();
    await runCreativeGeneration(INPUT, deps({ recordDegraded }));
    expect(recordDegraded.mock.calls.some(([, reason]) => String(reason).startsWith("contract:"))).toBe(false);
  });

  it("keeps the candidate untouched when the model painted no palette", async () => {
    const recordDegraded = vi.fn();
    const result = await runCreativeGeneration(INPUT, deps({ recordDegraded }));

    expect(result.ok && result.html).toBe(IMPROVED_HTML);
    expect(recordDegraded).not.toHaveBeenCalledWith("delivery_gate", expect.anything());
  });
});

describe("model token isolation", () => {
  // A name the assembler binds (`--ink` = text) that the model reused for its
  // background collided on the same <section>, and the binding won: the model
  // asked for #050505 and got the page's text colour.
  const COLLIDING = '<!doctype html><html class="dark" style="--ol-bg:#09090B;--ol-fg:#F7F1ED"><head>'
    + '<style>[data-sec="d-4"]{--ink:var(--ol-fg);color:var(--ink)}</style>'
    + '<style data-openlen-creative="">:root{--ink:#050505}#ol-gallery-4{background:var(--ink)}</style>'
    + '</head><body><section id="ol-gallery-4" data-sec="d-4">x</section></body></html>';

  it("gives the model its own vocabulary without taking the library's", async () => {
    const { sha256 } = await import("@/lib/generation/content-hash");
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({
        candidate: {
          ...IMPROVED,
          html: COLLIDING,
          visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: { ...MANIFEST, outputHash: sha256(COLLIDING) } } as never,
        },
        changed: true, acceptedMutations: 2, rejections: [], stoppedBy: "finished",
      }),
    }));

    expect(result.ok).toBe(true);
    const html = result.ok ? result.html : "";
    expect(html).toContain("background:var(--olm-ink)");
    expect(html).toContain("--olm-ink:#050505");
    // The library's binding is untouched, so its text still follows the theme
    // instead of turning near-black on a dark page.
    expect(html).toContain('[data-sec="d-4"]{--ink:var(--ol-fg);color:var(--ink)}');
  });
});

describe("inverted surface repair", () => {
  // A dark CTA panel inside a light page whose heading inherits the page's dark
  // text: invisible. The page's own contrast is fine, so nothing upstream sees
  // it — the visual critic approved both pages this came from.
  const INVERTED = '<!doctype html><html class="cream" style="--ol-bg:#F6F3EE;--ol-fg:#282521"><head>'
    + '<style data-openlen-creative="">:root{--panel:#0E1626}.cta{background:var(--panel);padding:60px}</style>'
    + "</head><body><section class='cta'><h2>x</h2></section></body></html>";

  it("gives the panel a colour its text can be read in", async () => {
    const { sha256 } = await import("@/lib/generation/content-hash");
    const result = await runCreativeGeneration(INPUT, deps({
      runCreativeSession: async () => ({
        candidate: {
          ...IMPROVED,
          html: INVERTED,
          visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: { ...MANIFEST, outputHash: sha256(INVERTED) } } as never,
        },
        changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished",
      }),
    }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("color:var(--ol-bg)");
  });
});

describe("unreadable text repair", () => {
  // Una barra que el modelo pintó clara sin fondo propio, sobre la banda crema
  // que la sección sigue pintando. Ninguna reja estática puede verlo: el mismo
  // color sobre una foto oscura es correcto.
  const UNREADABLE = '<!doctype html><html style="--ol-bg:#F4EEE2;--ol-fg:#26261F"><head>'
    + '<style data-openlen-creative-section="ol-header-1">.site-head{color:#f6efe2}</style>'
    + '</head><body><section class="band"><div class="site-head">Casa del Lago</div></section></body></html>';

  const probeOf = (html: string, className: string) =>
    Number(/data-ol-probe="(\d+)"/.exec(new RegExp(`<[^>]*class="${className}"[^>]*>`).exec(html)?.[0] ?? "")?.[1] ?? -1);

  async function withUnreadable(over: Partial<CreativeGenerationDeps> = {}) {
    const { sha256 } = await import("@/lib/generation/content-hash");
    return deps({
      runCreativeSession: async () => ({
        candidate: {
          ...IMPROVED,
          html: UNREADABLE,
          visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: { ...MANIFEST, outputHash: sha256(UNREADABLE) } } as never,
        },
        changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished",
      }),
      renderCandidate: async (html: string) => ({
        mobileOverflow: false,
        invalidGeometry: false,
        unreadableText: [{ probe: probeOf(html, "site-head"), background: "#f4eee2", contrast: 1.01 }],
      }),
      ...over,
    });
  }

  it("le da al texto medido un color en el que se puede leer", async () => {
    const result = await runCreativeGeneration(INPUT, await withUnreadable());
    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain('class="site-head" style="color:var(--ol-fg)"');
    // La regla del modelo no se toca: puede estar pintando bien otros diez.
    expect(result.ok && result.html).toContain(".site-head{color:#f6efe2}");
  });

  it("lo que la crítica juzga es lo que se entrega", async () => {
    const review = vi.fn(async ({ candidate }: { candidate: SafeCreativeCandidate }) => ({ candidate, reviewed: true, repaired: false, rounds: 1, accepted: true, exit: "accepted" as const }));
    await runCreativeGeneration(INPUT, await withUnreadable({ runAdvisoryReview: review as never }));
    expect(review.mock.calls[0][0].candidate.html).toContain("color:var(--ol-fg)");
  });

  // El color va EN LÍNEA sobre el elemento medido, y una reparación del modelo
  // reescribe secciones enteras: se lo lleva por delante. La única de 20
  // páginas generadas con texto a 1.02:1 fue justo la que pasó por aquí.
  it("vuelve a medir cuando la revisión reescribió la página", async () => {
    const review = vi.fn(async ({ candidate }: { candidate: SafeCreativeCandidate }) => ({
      // El modelo devuelve la sección sin el color en línea que se le había puesto.
      candidate: { ...candidate, html: UNREADABLE },
      reviewed: true, repaired: true, rounds: 1, accepted: false, exit: "rounds_exhausted" as const,
    }));
    const result = await runCreativeGeneration(INPUT, await withUnreadable({ runAdvisoryReview: review as never }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("color:var(--ol-fg)");
  });

  it("no paga un render de más cuando la revisión no tocó nada", async () => {
    const renderCandidate = vi.fn(async (html: string) => ({
      mobileOverflow: false,
      invalidGeometry: false,
      unreadableText: [{ probe: probeOf(html, "site-head"), background: "#f4eee2", contrast: 1.01 }],
    }));
    const review = vi.fn(async ({ candidate }: { candidate: SafeCreativeCandidate }) => ({
      candidate, reviewed: true, repaired: false, rounds: 1, accepted: true, exit: "accepted" as const,
    }));
    await runCreativeGeneration(INPUT, await withUnreadable({ renderCandidate, runAdvisoryReview: review as never }));
    expect(renderCandidate).toHaveBeenCalledTimes(1);
  });

  it("lo deja en la bitácora, porque es la única forma de saber cuántas veces pasa", async () => {
    const recordDegraded = vi.fn();
    await runCreativeGeneration(INPUT, await withUnreadable({ recordDegraded }));
    expect(recordDegraded).toHaveBeenCalledWith("advisory_review", "unreadable_text_repaired");
  });

  it("no toca la página cuando el render no mide nada ilegible", async () => {
    const result = await runCreativeGeneration(INPUT, await withUnreadable({
      renderCandidate: async () => ({ mobileOverflow: false, invalidGeometry: false, unreadableText: [] }),
    }));
    expect(result.ok && result.html).toBe(UNREADABLE);
  });

  it("un render que lanza no cuesta la página", async () => {
    const result = await runCreativeGeneration(INPUT, await withUnreadable({
      renderCandidate: async () => { throw new Error("browser down"); },
    }));
    expect(result.ok && result.html).toBe(UNREADABLE);
  });
});

describe("la dirección elegida desde el brief", () => {
  const SEALED_BASELINE: SafeCreativeCandidate = {
    ...BASELINE,
    html: '<!doctype html><html lang="es" class="dark" style="--ol-bg:#09090B;--ol-radius:10px"><head>'
      + '<style data-openlen-visual-engine="creative-direction/1.0">:root{--ol-background:#09090B}</style>'
      + "</head><body><section>baseline</section></body></html>",
    visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: MANIFEST } as never,
  };

  async function elected() {
    const { buildDeterministicCreativeDirection } = await import("@/lib/generation/deterministic-creative-direction");
    const { buildDeterministicIntent } = await import("./deterministic-page-input");
    const { paletteFromAccent } = await import("@/lib/generation/palette-from-accent");
    const base = buildDeterministicCreativeDirection(buildDeterministicIntent(INPUT.brief)).direction;
    return { ...base, mode: "light" as const, palette: paletteFromAccent("#2E86C1", "light") };
  }

  function withBaseline(over: Partial<CreativeGenerationDeps> = {}) {
    return deps({
      buildBaseline: async () => ({ ok: true, candidate: SEALED_BASELINE, intent: { language: "es" } as never, copy: {} as never }),
      runCreativeSession: async ({ baseline }) => ({ candidate: baseline, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "finished" }),
      ...over,
    });
  }

  it("repinta la página entregada con la paleta elegida", async () => {
    const direction = await elected();
    const result = await runCreativeGeneration(INPUT, withBaseline({ chooseDirection: async () => direction }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain(`--ol-bg: ${direction.palette.background}`);
    expect(result.ok && result.html).toMatch(/<html[^>]*class="light/);
    expect(result.ok && result.html.toLowerCase()).not.toContain("#09090b");
  });

  it("no se le pregunta hasta que existe una baseline segura", async () => {
    const order: string[] = [];
    const direction = await elected();
    await runCreativeGeneration(INPUT, withBaseline({
      buildBaseline: async () => {
        order.push("baseline");
        return { ok: true, candidate: SEALED_BASELINE, intent: { language: "es" } as never, copy: {} as never };
      },
      chooseDirection: async () => { order.push("elector"); return direction; },
    }));
    expect(order).toEqual(["baseline", "elector"]);
  });

  it("nunca se le pregunta si el catálogo no pudo dar una baseline", async () => {
    const chooseDirection = vi.fn(async () => await elected());
    const result = await runCreativeGeneration(INPUT, withBaseline({
      buildBaseline: async () => ({ ok: false, code: "section_inventory_unavailable", detail: "no_published_sections" }),
      chooseDirection,
    }));
    expect(result.ok).toBe(false);
    expect(chooseDirection).not.toHaveBeenCalled();
  });

  it("el modelo recibe la dirección elegida, no la del vecino más parecido", async () => {
    const direction = await elected();
    let seen: unknown;
    await runCreativeGeneration(INPUT, withBaseline({
      chooseDirection: async () => direction,
      runCreativeSession: async ({ baseline }) => {
        seen = (baseline.visualEngine as { creativeDirection?: unknown }).creativeDirection;
        return { candidate: baseline, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "finished" };
      },
    }));
    expect(seen).toMatchObject({ mode: "light", palette: { background: direction.palette.background } });
  });

  it("un elector caído cuesta el gusto, no la página, y queda anotado", async () => {
    const recordDegraded = vi.fn();
    const result = await runCreativeGeneration(INPUT, withBaseline({
      chooseDirection: async () => { throw new Error("sin presupuesto"); },
      recordDegraded,
    }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain("--ol-bg:#09090B");
    expect(recordDegraded).toHaveBeenCalledWith("baseline", "direction_unavailable");
  });

  it("resella la dirección con su hash, o la puerta descarta la página en silencio", async () => {
    // Sin restampar `creativeDirectionHash` esto entrega la BASELINE: la puerta
    // compara el hash contra la dirección, refusa, cae hacia atrás — y lo
    // reporta como `delivered`. El color por el que se pagó, perdido, y nada en
    // el resultado lo dice.
    const { canonicalJsonSha256 } = await import("@/lib/generation/content-hash");
    const direction = await elected();
    const validateDelivery = vi.fn(({ visualEngine }: { visualEngine: unknown }) => {
      const meta = visualEngine as { creativeDirection?: unknown; compositionManifest?: { creativeDirectionHash?: string } };
      return meta?.compositionManifest?.creativeDirectionHash === canonicalJsonSha256(meta?.creativeDirection)
        ? { ok: true as const, visualEngine }
        : { ok: false as const, reasonCode: "invalid_composition_manifest" as const };
    }) as never;

    const result = await runCreativeGeneration(INPUT, withBaseline({ chooseDirection: async () => direction, validateDelivery }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.html).toContain(`--ol-bg: ${direction.palette.background}`);
  });

  it("sin elector la página sale byte por byte como antes", async () => {
    const result = await runCreativeGeneration(INPUT, withBaseline());
    expect(result.ok && result.html).toBe(SEALED_BASELINE.html);
  });
});

describe("el puente de módulos en la ruta que no pasa por Gemini", () => {
  const SEALED = (html: string): SafeCreativeCandidate => ({
    ...BASELINE, html,
    visualEngine: { ...(VISUAL_ENGINE as object), compositionManifest: MANIFEST } as never,
  });
  const PAGE = '<!doctype html><html lang="es"><head></head><body><section data-openlen-role="hero">a</section><footer data-openlen-role="footer">c</footer></body></html>';
  const CITAS = { ...INPUT, brief: "Clínica dental familiar. Queremos que la gente agende su cita en línea." };

  function withBaseline(over: Partial<CreativeGenerationDeps> = {}) {
    return deps({
      buildBaseline: async () => ({ ok: true, candidate: SEALED(PAGE), intent: { language: "es" } as never, copy: {} as never }),
      runCreativeSession: async ({ baseline }) => ({ candidate: baseline, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "finished" }),
      ...over,
    });
  }

  it("deja el hueco que enciende reservas cuando el brief lo pide", async () => {
    const result = await runCreativeGeneration(CITAS, withBaseline());
    expect(result.ok && result.html).toContain("data-ol-bookings-section");
    expect(result.ok && result.html).not.toContain("data-ol-collection-section");
  });

  it("no inventa módulos cuando el brief no los pide", async () => {
    // INPUT.brief es una página de terror: ni citas ni catálogo.
    const result = await runCreativeGeneration(INPUT, withBaseline());
    expect(result.ok && result.html).toBe(PAGE);
  });

  it("resella el manifiesto, o la puerta descarta la página por poner una banda", async () => {
    const { sha256 } = await import("@/lib/generation/content-hash");
    const validateDelivery = vi.fn(({ html, visualEngine }: { html: string; visualEngine: unknown }) => {
      const stamped = (visualEngine as { compositionManifest?: { outputHash?: string } })?.compositionManifest?.outputHash;
      return stamped === sha256(html)
        ? { ok: true as const, visualEngine }
        : { ok: false as const, reasonCode: "output_hash_mismatch" as const };
    }) as never;
    const result = await runCreativeGeneration(CITAS, withBaseline({ validateDelivery }));
    expect(result.ok && result.html).toContain("data-ol-bookings-section");
    // Una sola llamada = la puerta la aceptó a la primera. Sin resellar habría
    // refusado y reintentado con la baseline.
    expect(validateDelivery).toHaveBeenCalledTimes(1);
  });

  it("la baseline también lo lleva cuando la entrega cae hacia atrás", async () => {
    // La mejorada no pasa la puerta; el módulo no puede perderse en la caída.
    const improved = SEALED(PAGE.replace("<footer", "<section>mejorado</section><footer"));
    const validateDelivery = vi.fn(({ html }: { html: string }) => (html.includes("mejorado")
      ? { ok: false as const, reasonCode: "section_role_coverage_failed" as const }
      : { ok: true as const, visualEngine: {} })) as never;
    const result = await runCreativeGeneration(CITAS, withBaseline({
      runCreativeSession: async () => ({ candidate: improved, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" }),
      validateDelivery,
    }));
    expect(result.ok && result.degraded).toBe(true);
    expect(result.ok && result.html).toContain("data-ol-bookings-section");
  });
});
