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

  // ⚰️ «records a transform fallback as content that may look empty» y «only
  // reports dynamic content when the page actually had script to bake»:
  // `dynamic_content` nacía del transformador de ingestión, retirado el
  // 2026-10-04 con el saneado de pegar y clonar.

  // ⚰️ «counts mis-wired controls»: `broken_controls` nacía de las conductas
  // `data-ol-*`, retiradas el 2026-10-04.

  it("records every loss from a single bad ingestion together", () => {
    const out = collectDegradations({
      surface: "from-html",
      removed: { scripts: 1, eventHandlers: 0, iframes: 1, dangerousUrls: 0 },
    });
    expect(out.map((d) => d.code)).toEqual(["scripts", "embeds"]);
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
      removed: { ...CLEAN, scripts: 4 },
    });
    expect(out).toEqual([]);
  });

  // 🔴 PERO LOS on* SÍ SE DICEN, y son otra pérdida.
  //
  // El cero de arriba tapaba las DOS: los bloques `<script>`, que `conservarScripts`
  // devuelve —y por eso contarlos sería avisar de algo que sí llegó— y los `on*`,
  // que NO devuelve nadie, porque esa función trabaja con BLOQUES, no con
  // atributos. Resultado medido: una plantilla con `onclick="abrir()"` clona con
  // la función VIVA y el botón MUERTO. El 13% del corpus.
  it("🔴 un on* perdido SÍ se cuenta, y por separado de los scripts", () => {
    const out = collectDegradations({
      surface: "from-template",
      removed: { ...CLEAN, scripts: 4, eventHandlers: 2 },
    });
    // Ni un solo `scripts`: ésos volvieron. Sólo lo que de verdad falta.
    expect(out).toEqual([
      { surface: "from-template", stage: "sanitize", code: "handlers_lost", count: 2 },
    ]);
  });

  // Y en las otras superficies NO cambia nada: ahí el script tampoco vuelve, así
  // que las dos pérdidas siguen siendo la misma cosa para el usuario.
  it("en from-html los dos siguen contando juntos, como siempre", () => {
    const out = collectDegradations({
      surface: "from-html",
      removed: { ...CLEAN, scripts: 3, eventHandlers: 2 },
    });
    expect(out).toEqual([
      { surface: "from-html", stage: "sanitize", code: "scripts", count: 5 },
    ]);
  });

  it("still reports a template's embeds and unsafe links, which are real losses", () => {
    const out = collectDegradations({
      surface: "from-template",
      removed: { ...CLEAN, scripts: 4, iframes: 1, dangerousUrls: 1 },
    });
    expect(out.map((d) => d.code)).toEqual(["embeds", "unsafe_links"]);
  });

  it("is safe to call with nothing measured", () => {
    // assemble may adopt this later without a `removed` in hand.
    expect(collectDegradations({ surface: "from-html" })).toEqual([]);
  });

  // ⚰️ «says nothing about a generated page that only lost a control» y el
  // detalle de `broken_controls` («lleva la frase concreta», «no crece sin
  // límite»): nacía de las conductas `data-ol-*`, retiradas el 2026-10-04.
});

describe("el detalle SOBREVIVE hasta el usuario", () => {
  it("sin issues no inventa detalle", () => {
    const out = collectDegradations({
      surface: "generate",
      removed: { scripts: 2, eventHandlers: 0, iframes: 0, dangerousUrls: 0 },
    });
    expect(out.find((d) => d.code === "broken_controls")).toBeUndefined();
    expect(out.find((d) => d.code === "scripts")?.detail).toBeUndefined();
  });
});
