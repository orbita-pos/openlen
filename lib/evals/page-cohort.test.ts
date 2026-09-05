import { describe, expect, it } from "vitest";

import { PAGE_COHORT, PAGE_COHORT_VERSION } from "./page-cohort";
import { buildScorecard, compareScorecards, judgePage, type PageVerdict } from "./page-scorecard";

describe("el conjunto de briefs", () => {
  it("tiene ids únicos — el marcador se compara por id", () => {
    const ids = PAGE_COHORT.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada brief pasa la validación de la ruta (10–4000 caracteres)", () => {
    for (const c of PAGE_COHORT) {
      expect(c.brief.trim().length, c.id).toBeGreaterThanOrEqual(10);
      expect(c.brief.trim().length, c.id).toBeLessThanOrEqual(4000);
    }
  });

  it("todo caso declara el idioma que espera", () => {
    for (const c of PAGE_COHORT) expect(c.expectLang, c.id).toMatch(/^[a-z]{2}$/);
  });

  // Un caso de regresión sin decir qué vigila es un brief más: dentro de un mes
  // nadie sabrá por qué está y alguien lo borrará.
  it("todo caso de regresión dice qué fallo vigila", () => {
    for (const c of PAGE_COHORT.filter((x) => x.tag === "regresion")) {
      expect(c.guards, c.id).toBeTruthy();
    }
  });

  it("cubre los tres tipos y conserva los extremos", () => {
    const tags = new Set(PAGE_COHORT.map((c) => c.tag));
    expect(tags).toEqual(new Set(["cotidiano", "extremo", "regresion"]));
    expect(PAGE_COHORT.some((c) => c.expectRtl)).toBe(true);
  });
});

const base = { id: "x", attempts: 1, trimmed: 0, ms: 1, lang: "es", h1Count: 1 };
const es = { expectLang: "es" };

describe("el marcador", () => {
  it("una página sana no falla en nada", () => {
    expect(judgePage({ ...base, mobileOverflow: false, unreadable: 0 }, es).failures).toEqual([]);
  });

  it("acumula TODOS los fallos, no sólo el primero", () => {
    const v = judgePage({ ...base, mobileOverflow: true, unreadable: 2, lang: "en" }, es);
    expect(v.failures).toEqual(["overflow", "unreadable", "lang"]);
  });

  it("sin forma no se sigue midiendo — no hay documento que medir", () => {
    expect(judgePage({ ...base, attempts: 0 }, es).failures).toEqual(["shape"]);
  });

  it("un titular ausente o duplicado cuenta aunque el render no mida jerarquía", () => {
    expect(judgePage({ ...base, h1Count: 0 }, es).failures).toEqual(["typography"]);
    expect(judgePage({ ...base, h1Count: 2 }, es).failures).toEqual(["typography"]);
  });

  it("el idioma se compara por prefijo: es-MX cuenta como es", () => {
    expect(judgePage({ ...base, lang: "es-MX" }, es).failures).toEqual([]);
  });

  // LO QUE SUSTITUYE AL VEREDICTO `calc` (2026-09-04). `calc` exigía un
  // marcador NUESTRO que el modelo ya no conoce, así que ninguna página podía
  // pasarla. Esto no pide nada: el modelo declara qué debe hacer SU página y se
  // comprueba eso. Las tres ramas van juntas a propósito — el brazo de control
  // (declaró y cumplió) y el de la ausencia son los que impiden que esto se
  // convierta en la misma trampa que `calc`, que era acusar por no adivinar.
  it("una página que incumple SU PROPIA prueba falla", () => {
    expect(judgePage({ ...base, pruebaPasos: 3, pruebaFallos: 1 }, es).failures).toEqual(["prueba"]);
  });

  it("CONTRA-PRUEBA: declararla y cumplirla no es fallo", () => {
    expect(judgePage({ ...base, pruebaPasos: 3, pruebaFallos: 0 }, es).failures).toEqual([]);
  });

  it("y NO declarar prueba tampoco: ausente no es fallo, no medir no es medir mal", () => {
    expect(judgePage(base, es).failures).toEqual([]);
  });

  it("una escritura de derecha a izquierda sin dir=rtl falla", () => {
    const ar = { expectLang: "ar", expectRtl: true } as const;
    expect(judgePage({ ...base, lang: "ar", dir: "" }, ar).failures).toEqual(["rtl"]);
    expect(judgePage({ ...base, lang: "ar", dir: "rtl" }, ar).failures).toEqual([]);
  });
});

const card = (verdicts: PageVerdict[], rev = "a") =>
  buildScorecard({ cohortVersion: PAGE_COHORT_VERSION, revision: rev, at: "2026-08-19T00:00:00.000Z", verdicts, costMxn: 0 });
const v = (id: string, failures: PageVerdict["failures"]): PageVerdict =>
  ({ id, failures, measurement: { ...base, id } });

describe("comparar con la corrida anterior", () => {
  it("nombra qué página se rompió y cuál se arregló", () => {
    const prev = card([v("a", []), v("b", ["overflow"])]);
    const next = card([v("a", ["lang"]), v("b", [])], "b");
    const cmp = compareScorecards(prev, next);
    expect(cmp.regressed).toEqual(["a"]);
    expect(cmp.fixed).toEqual(["b"]);
    expect(cmp.delta).toBe(0);
  });

  // Cambiar el conjunto y comparar tasas es como comparar dos exámenes
  // distintos: el número sube o baja por el examen, no por el producto.
  it("con otra versión del conjunto NO compara", () => {
    const prev = { ...card([v("a", [])]), cohortVersion: "page-cohort/0.9" };
    expect(compareScorecards(prev, card([v("a", [])])).comparable).toBe(false);
  });

  it("sin corrida previa no inventa una comparación", () => {
    expect(compareScorecards(null, card([v("a", [])]))).toMatchObject({ comparable: false, delta: null });
  });
});

describe("una corrida cortada no puede envenenar la línea base", () => {
  const full = card([v("a", []), v("b", []), v("c", [])]);
  const partial = { ...card([v("a", [])], "b"), partial: true };

  it("el delta se calcula sólo sobre lo que corrió en AMBAS", () => {
    // Restar totales daría -2: una caída que nadie causó.
    expect(compareScorecards(full, partial).delta).toBe(0);
  });

  it("y sigue nombrando la regresión real dentro de lo compartido", () => {
    const rota = { ...card([v("a", ["overflow"])], "b"), partial: true };
    const cmp = compareScorecards(full, rota);
    expect(cmp.regressed).toEqual(["a"]);
    expect(cmp.delta).toBe(-1);
  });

  it("sin páginas en común no compara", () => {
    expect(compareScorecards(full, card([v("z", [])], "b")).comparable).toBe(false);
  });

  it("una corrida completa se marca no-parcial", () => {
    expect(full.partial).toBe(false);
  });
});

// ⚰️ AQUÍ AL LADO VIVÍA `page-scorecard.test.ts`, con las cuatro pruebas del
// veredicto `calc` (2026-09-04). Exigían una región `data-ol-calc`, que era la
// 9ª CONDUCTA — y las conductas se retiraron el 2026-08-23. Desde entonces
// ninguna de las cuatro superficies le nombra ese marcador al modelo (0
// apariciones en los cuatro prompts de producción, comprobado), así que la
// comprobación pedía algo que él no puede conocer y NINGUNA página podía
// pasarla. El caso `quiz` la fallaba desde la línea base del 2026-08-21 por
// esto, no por la página: el modelo construye el test con JavaScript, que es lo
// que el contrato de hoy sí le pide, y funciona — comprobado en el navegador.
//
// El fichero se fue entero porque no le quedaba nada más dentro; `judgePage` lo
// sigue cubriendo este mismo fichero.
