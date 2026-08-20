import { describe, expect, it } from "vitest";

import { collectDegradations } from "./degradations";

const CLEAN = { scripts: 0, eventHandlers: 0, iframes: 0, dangerousUrls: 0 };

describe("collectDegradations", () => {
  it("records nothing when the page came through whole", () => {
    expect(collectDegradations({ surface: "from-html", removed: CLEAN })).toEqual([]);
  });

  it("folds scripts and inline handlers into one thing the user lost", () => {
    // Two counters, one lived experience: "the interactive bits are gone".
    // Reporting them separately would make the surface say "12 scripts and 4
    // on* attributes", which means nothing to a creator.
    const out = collectDegradations({
      surface: "from-html",
      removed: { ...CLEAN, scripts: 3, eventHandlers: 2 },
    });
    expect(out).toEqual([
      { surface: "from-html", stage: "sanitize", code: "scripts", count: 5 },
    ]);
  });

  it("separates embeds and unsafe links, which are different losses", () => {
    const out = collectDegradations({
      surface: "from-template",
      removed: { ...CLEAN, iframes: 2, dangerousUrls: 1 },
    });
    expect(out).toEqual([
      { surface: "from-template", stage: "sanitize", code: "embeds", count: 2 },
      { surface: "from-template", stage: "sanitize", code: "unsafe_links", count: 1 },
    ]);
  });

  it("records a transform fallback as content that may look empty", () => {
    // The transform exists to bake JS-generated content before the sanitizer
    // deletes the JS. When it falls back, that content never got baked AND
    // the script is about to be stripped — so sections can render empty.
    const out = collectDegradations({
      surface: "from-html",
      removed: CLEAN,
      transformFallback: "timeout",
      hadScripts: true,
    });
    expect(out).toEqual([
      { surface: "from-html", stage: "transform", code: "dynamic_content", count: 1 },
    ]);
  });

  it("counts mis-wired controls, one per issue", () => {
    const out = collectDegradations({
      surface: "from-html",
      removed: CLEAN,
      behaviorIssues: [
        { behavior: "lightbox", message: "x" },
        { behavior: "copy", message: "y" },
      ] as never,
    });
    expect(out).toEqual([
      {
        surface: "from-html",
        stage: "behaviors",
        code: "broken_controls",
        count: 2,
        // El detalle viaja con el conteo: sin él, el creador lee "algunos
        // controles" y no sabe cuál tocar.
        detail: ["x", "y"],
      },
    ]);
  });

  it("records every loss from a single bad ingestion together", () => {
    const out = collectDegradations({
      surface: "from-html",
      removed: { scripts: 1, eventHandlers: 0, iframes: 1, dangerousUrls: 0 },
      transformFallback: "disabled",
      // The kill switch being off is still a real loss to the user: the page
      // has unbaked dynamic content and is about to lose the script that
      // built it. Why WE did not transform changes nothing they experience.
      hadScripts: true,
      behaviorIssues: [{ behavior: "countdown", message: "z" }] as never,
    });
    expect(out.map((d) => d.code)).toEqual([
      "dynamic_content",
      "scripts",
      "embeds",
      "broken_controls",
    ]);
  });

  // Post-ship verification found this: 152 of the 172 in-repo templates carry
  // a decorative script (classList.add('js'), an IntersectionObserver reveal)
  // that lib/transform BAKES and the sanitizer then strips. Reporting it would
  // put "your page had parts built with JavaScript" in front of ~88% of clones
  // where nothing visibly broke — the exact noise this notice exists to avoid.
  // It is also not true in the user's terms: it was never their page.
  it("does not blame the user for a curated template's own stripped script", () => {
    const out = collectDegradations({
      surface: "from-template",
      removed: { ...CLEAN, scripts: 4, eventHandlers: 1 },
    });
    expect(out).toEqual([]);
  });

  it("still reports a template's embeds and unsafe links, which are real losses", () => {
    const out = collectDegradations({
      surface: "from-template",
      removed: { ...CLEAN, scripts: 4, iframes: 1, dangerousUrls: 1 },
    });
    expect(out.map((d) => d.code)).toEqual(["embeds", "unsafe_links"]);
  });

  // Also found post-ship: transformIngestedHtml returns a fallback when the
  // kill switch is off OR when Chrome fails — a documented recurring failure
  // on this box. Reporting that unconditionally would warn on 100% of pastes
  // during an outage, about content the page may not even have.
  it("only reports dynamic content when the page actually had script to bake", () => {
    expect(
      collectDegradations({ surface: "from-html", removed: CLEAN, transformFallback: "timeout" }),
    ).toEqual([]);
    expect(
      collectDegradations({
        surface: "from-html",
        removed: CLEAN,
        transformFallback: "timeout",
        hadScripts: true,
      }),
    ).toEqual([
      { surface: "from-html", stage: "transform", code: "dynamic_content", count: 1 },
    ]);
  });

  it("is safe to call with nothing measured", () => {
    // assemble may adopt this later without a `removed` in hand.
    expect(collectDegradations({ surface: "from-html" })).toEqual([]);
  });

  it("says nothing about a generated page that only lost a control", () => {
    // generate's counters read zero by the time the gate sanitizes — the
    // stream already stripped the model's scripts. The only honest thing left
    // to tell the owner of an AI-written page is which control came out dead.
    expect(
      collectDegradations({
        surface: "generate",
        removed: CLEAN,
        behaviorIssues: [{ behavior: "copy", message: "id inexistente" }],
      }),
    ).toEqual([
      {
        surface: "generate",
        stage: "behaviors",
        code: "broken_controls",
        count: 1,
        detail: ["id inexistente"],
      },
    ]);
  });
});

describe("el detalle SOBREVIVE hasta el usuario", () => {
  // El sistema siempre supo qué se rompió — el atributo, la fórmula literal,
  // qué nombre falta y qué hacer. Lo usaba para reparar y reintentar, y al
  // guardarlo para el creador lo reducía a un código y un número. "Algunos
  // controles quedaron mal conectados" no le dice a nadie qué tocar.
  it("lleva la frase concreta, no sólo el conteo", () => {
    const out = collectDegradations({
      surface: "generate",
      behaviorIssues: [
        { behavior: "calc", message: 'data-ol-out="recibo * tarifa": usa "tarifa", que no existe' },
      ],
    });
    const roto = out.find((d) => d.code === "broken_controls");
    expect(roto?.count).toBe(1);
    expect(roto?.detail?.[0]).toContain("tarifa");
  });

  // Acotado a propósito: es texto de máquina en la fila del proyecto, no un
  // registro. Un registro que nadie lee es lo que este aviso existe para NO ser.
  it("no crece sin límite", () => {
    const muchos = Array.from({ length: 12 }, (_, i) => ({
      behavior: "calc" as const,
      message: `problema ${i} ` + "x".repeat(500),
    }));
    const roto = collectDegradations({ surface: "generate", behaviorIssues: muchos })
      .find((d) => d.code === "broken_controls");
    expect(roto?.count).toBe(12);
    expect(roto?.detail).toHaveLength(3);
    expect(roto?.detail?.[0]?.length).toBeLessThanOrEqual(200);
  });

  it("sin issues no inventa detalle", () => {
    const out = collectDegradations({
      surface: "generate",
      removed: { scripts: 2, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
    });
    expect(out.find((d) => d.code === "broken_controls")).toBeUndefined();
    expect(out.find((d) => d.code === "scripts")?.detail).toBeUndefined();
  });
});
