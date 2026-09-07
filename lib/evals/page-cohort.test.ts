import { describe, expect, it } from "vitest";

import { PAGE_COHORT, PAGE_COHORT_VERSION } from "./page-cohort";
import {
  FAILURE_CODES,
  buildScorecard,
  caseClean,
  compareScorecards,
  judgePage,
  worstFailure,
  type PageVerdict,
  type SubpageVerdict,
} from "./page-scorecard";

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

  // 🔴 LA IMAGEN DEL CASO CON REFERENCIA TIENE QUE EXISTIR EN EL REPO. Si
  // alguien mueve o borra ese fichero, el arnés lanza a mitad de una corrida
  // PAGADA —después de haber gastado en los casos anteriores—, y el papel con
  // visión vuelve a quedarse sin medir sin que nadie se entere. Esto lo caza
  // gratis, en `npm test`.
  it("🔴 toda referencia adjunta existe y la acepta la puerta de producción", async () => {
    const { readFileSync } = await import("node:fs");
    const { leerReferenciaAdjunta } = await import("@/lib/ai/referencia-adjunta");
    const conImagen = PAGE_COHORT.filter((c) => c.imagen);
    // Y que quede AL MENOS UNA: el papel con visión estuvo sin cobertura hasta
    // el 2026-09-07 justo porque no había forma de declararla.
    expect(conImagen.length, "el papel con visión se quedó otra vez sin medir").toBeGreaterThan(0);
    for (const c of conImagen) {
      const datos = readFileSync(c.imagen!).toString("base64");
      const leida = leerReferenciaAdjunta({ mimeType: "image/webp", dataBase64: datos });
      expect(leida?.ok, `${c.id}: ${c.imagen}`).toBe(true);
    }
  });

  // 🔴 EL CAMINO DE LAS SUBPÁGINAS TIENE QUE SEGUIR MEDIDO. Una llamada y un
  // crédito por página, y estuvo desde el 2026-08-27 sin una sola medición
  // porque ningún brief pedía más de una: `paginasDeclaradas` daba CERO en los
  // 49 artefactos del corpus. Si alguien quita el último caso que las pide, el
  // hueco vuelve — y vuelve callado, que es como estuvo.
  it("🔴 algún brief pide páginas separadas", () => {
    const conPaginas = PAGE_COHORT.filter((c) => c.expectPages !== undefined);
    expect(conPaginas.length, "el camino de las subpáginas se quedó otra vez sin medir").toBeGreaterThan(0);
    for (const c of conPaginas) expect(c.expectPages, c.id).toBeGreaterThan(0);
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

  it("el brief que pidió páginas separadas y no las tiene falla por 'paginas'", () => {
    const pide3 = { ...es, expectPages: 3 };
    expect(judgePage({ ...base, declaredPages: 0 }, pide3).failures).toEqual(["paginas"]);
    expect(judgePage({ ...base, declaredPages: 2 }, pide3).failures).toEqual(["paginas"]);
    expect(judgePage({ ...base, declaredPages: 3 }, pide3).failures).toEqual([]);
    // De MÁS no es un fallo: el contrato le permite hasta cuatro.
    expect(judgePage({ ...base, declaredPages: 4 }, pide3).failures).toEqual([]);
  });

  // Los diecisiete casos de una sola página no pueden empezar a fallar por
  // esto: sin `expectPages` no hay nada que exigir.
  it("un caso que no pide páginas no las mira", () => {
    expect(judgePage({ ...base, declaredPages: 0 }, es).failures).toEqual([]);
  });

  it("el idioma se compara por prefijo: es-MX cuenta como es", () => {
    expect(judgePage({ ...base, lang: "es-MX" }, es).failures).toEqual([]);
  });

  // 🔴 LA PRUEBA DECLARADA, RETIRADA — y esta prueba se INVIERTE en vez de
  // borrarse, que es la regla de la casa: una prueba borrada deja de contar lo
  // que se aprendió. Ver [[pruebas-que-sujetan-la-mentira]].
  //
  // Aquí vivieron dos versiones en dos días. La del 2026-09-04 sustituía al
  // veredicto `calc` y afirmaba «una página que incumple SU PROPIA prueba
  // falla»; la corrida de esa misma tarde la desmintió (3 acusadas de 11,
  // 0 aciertos) y se le retiró el voto dejándola como observación.
  //
  // El 2026-09-05 se fue entera, con su bloque del prompt de crear. Las dos
  // versiones y el `calc` que las precedió caen por lo mismo: le pedíamos al
  // modelo un vocabulario nuestro y luego lo medíamos por cómo lo usaba.
  //
  // Lo que esta prueba sujeta ahora es que no queda rastro: no hay campo que
  // rellenar y no hay veredicto que emitir.
  it("no queda código de fallo para la prueba declarada", () => {
    expect(FAILURE_CODES).not.toContain("prueba");
  });

  it("una página sin nada que declarar no es una página sucia", () => {
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

// EL CASO ES LA FILA, LA SUBPÁGINA ES UN GRADER.
//
// Leído del binario de Claude Code (`plugin eval`, v2.1.260): la tabla lleva
// UNA fila por caso —`CASE SCORE PASS% RUNS COST NOTES`— y lo que se mide
// dentro son `graders` con nombre, peso y explicación. La columna NOTES es
// `peor.name + ": " + peor.explanation`, y el peor es el de MÁS PESO, uno solo.
//
// Aquí el peso es el ORDEN de `FAILURE_CODES`, que ya empieza por las
// catastróficas. No nos inventamos pesos: sus graders los escribe cada caso en
// markdown, los nuestros son diez y son fijos.
describe("un caso con subpáginas", () => {
  const sub = (slug: string, failures: PageVerdict["failures"]): SubpageVerdict => ({
    slug,
    failures,
    measurement: { ...base, id: `x/${slug}` },
  });
  const con = (fallos: PageVerdict["failures"], subpages: SubpageVerdict[]): PageVerdict =>
    ({ ...v("x", fallos), subpages });

  it("🔴 una portada impecable con una subpágina rota NO es un caso limpio", () => {
    expect(caseClean(con([], [sub("servicios", ["overflow"])]))).toBe(false);
  });

  it("limpio es cuando lo son la portada y TODAS sus subpáginas", () => {
    expect(caseClean(con([], [sub("servicios", []), sub("equipo", [])]))).toBe(true);
  });

  it("nombra UNO: el que más pesa, aunque esté en una subpágina", () => {
    expect(worstFailure(con(["lang"], [sub("servicios", ["gate"])]))).toBe("/servicios: gate");
  });

  it("y en un empate gana la portada", () => {
    expect(worstFailure(con(["overflow"], [sub("servicios", ["overflow"])]))).toBe("portada: overflow");
  });

  // Sin subpáginas no se escribe el sitio: en los diecisiete casos de una sola
  // página no hay ambigüedad que resolver y "portada:" sería ruido.
  it("un caso de una sola página imprime el código pelado", () => {
    expect(worstFailure(v("x", ["overflow"]))).toBe("overflow");
  });

  it("un caso sin fallos no tiene peor", () => {
    expect(worstFailure(v("x", []))).toBeNull();
  });

  // El `explanation` del binario. Sólo `enlace` sabe hoy decir cuál fue.
  it("el enlace muerto dice CUÁL", () => {
    const roto: PageVerdict = {
      id: "x",
      failures: ["enlace"],
      measurement: { ...base, deadAnchors: 1, deadAnchorWorst: "#comprar" },
    };
    expect(worstFailure(roto)).toBe("enlace → #comprar");
  });

  it("byCode cuenta el caso UNA vez aunque el código salga tres veces dentro", () => {
    const v1 = con(["overflow"], [sub("a", ["overflow"]), sub("b", ["overflow"])]);
    expect(card([v1]).byCode.overflow).toBe(1);
    expect(card([v1]).pages).toBe(1);
  });

  it("y ve un código que SÓLO sale en una subpágina", () => {
    const v1 = con([], [sub("servicios", ["lang"])]);
    expect(card([v1]).byCode.lang).toBe(1);
    expect(card([v1]).clean).toBe(0);
  });

  // La comparación mira el caso entero: si se arregla `/servicios`, el caso
  // pasa de sucio a limpio y eso es una mejora de verdad.
  it("la comparación va por caso, no por portada", () => {
    const antes = card([con([], [sub("servicios", ["overflow"])])]);
    const ahora = card([con([], [sub("servicios", [])])], "b");
    expect(compareScorecards(antes, ahora)).toMatchObject({ fixed: ["x"], delta: 1 });
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
