// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PAGE_COHORT_VERSION } from "./page-cohort";
import { buildScorecard, type BrazoDeCorrida, type PageVerdict } from "./page-scorecard";
import { escribirSinPisar, guardarMarcador, nombreDeMarcador } from "./guardar-marcador";

// 🔴 EL MARCADOR QUE SE PISABA. `scripts/evals-pages.ts` escribía
// `page-scorecard-<revisión>.json`: el nombre dependía SÓLO de la revisión. Del
// brazo de control 16×3 del experimento de esfuerzo (44/48) quedó una cifra
// citada en un informe y ningún fichero con que comprobarla ni recalcularle la
// mediana: en disco sólo está `page-scorecard-56cc29f1.json`, el brazo CON
// razonamiento. Las pruebas de abajo usan esa revisión y esos dos brazos.

const REV = "56cc29f1b0c4e6d8a2f1e3c5b7d9f0a1c3e5b7d9";
const AT = "2026-09-12T22:51:07.123Z";
const CONTROL: BrazoDeCorrida = { esfuerzo: null, tag: null, solo: null, repeat: 3 };
const ALTO: BrazoDeCorrida = { ...CONTROL, esfuerzo: "high" };

const pagina = (id: string, failures: PageVerdict["failures"] = []): PageVerdict =>
  ({ id, failures, measurement: { id, attempts: 1, trimmed: 0, ms: 80_000 } });
const marcador = (brazo: BrazoDeCorrida, at = AT, verdicts = [pagina("solar")]) =>
  buildScorecard({ cohortVersion: PAGE_COHORT_VERSION, revision: REV, at, brazo, verdicts, costMxn: 0 });

describe("🔴 dos corridas sobre la misma revisión no comparten nombre", () => {
  it("el control y el brazo con --esfuerzo, en el mismo milisegundo", () => {
    expect(nombreDeMarcador(marcador(CONTROL))).not.toBe(nombreDeMarcador(marcador(ALTO)));
  });

  it("el mismo brazo corrido dos veces", () => {
    expect(nombreDeMarcador(marcador(CONTROL, "2026-09-12T21:05:00.000Z")))
      .not.toBe(nombreDeMarcador(marcador(CONTROL, "2026-09-12T22:51:07.123Z")));
  });

  it("cada bandera del brazo cambia el nombre — dos `--solo` o un humo de un caso incluidos", () => {
    const brazos: BrazoDeCorrida[] = [
      { esfuerzo: null, tag: null, solo: null, repeat: 1 },
      { esfuerzo: "high", tag: null, solo: null, repeat: 1 },
      { esfuerzo: "low", tag: null, solo: null, repeat: 1 },
      { esfuerzo: null, tag: "regresion", solo: null, repeat: 1 },
      { esfuerzo: null, tag: null, solo: ["solar"], repeat: 1 },
      { esfuerzo: null, tag: null, solo: ["solar", "quiz"], repeat: 1 },
      { esfuerzo: null, tag: null, solo: ["solar"], repeat: 3 },
    ];
    const nombres = brazos.map((b) => nombreDeMarcador(marcador(b)));
    expect(new Set(nombres).size).toBe(brazos.length);
  });

  it("dice revisión, brazo e instante, y vale como nombre en Windows", () => {
    expect(nombreDeMarcador(marcador({ esfuerzo: "high", tag: null, solo: ["solar", "quiz"], repeat: 3 })))
      .toBe("page-scorecard-56cc29f1_esfuerzo-high_solo-solar+quiz_repeat-3_2026-09-12T225107123Z.json");
    expect(nombreDeMarcador(marcador({ esfuerzo: null, tag: null, solo: null, repeat: 1 })))
      .toBe("page-scorecard-56cc29f1_2026-09-12T225107123Z.json");
  });

  it("un `--solo` largo no revienta la ruta: el nombre distingue, la lista va en el JSON", () => {
    const solo = Array.from({ length: 12 }, (_, i) => `caso-con-nombre-largo-${i}`);
    const nombre = nombreDeMarcador(marcador({ esfuerzo: null, tag: null, solo, repeat: 1 }));
    expect(nombre).toContain("solo-12casos");
    expect(nombre.length).toBeLessThan(120);
  });
});

describe("🔴 y aunque coincidiera el nombre, nadie pisa a nadie", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ol-marcador-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("el caso de `56cc29f1`: control y brazo con razonamiento sobreviven LOS DOS", () => {
    const control = guardarMarcador(dir, marcador(CONTROL, AT, [pagina("a"), pagina("b", ["overflow"])]));
    const alto = guardarMarcador(dir, marcador(ALTO, AT, [pagina("a")]));
    expect(readdirSync(dir)).toHaveLength(2);
    expect(JSON.parse(readFileSync(control, "utf8"))).toMatchObject({ pages: 2, clean: 1, brazo: CONTROL });
    expect(JSON.parse(readFileSync(alto, "utf8"))).toMatchObject({ pages: 1, clean: 1, brazo: ALTO });
  });

  it("mismo brazo, mismo milisegundo: el segundo cae en otro fichero y el primero sigue intacto", () => {
    const primero = guardarMarcador(dir, marcador(CONTROL, AT, [pagina("a"), pagina("b")]));
    const segundo = guardarMarcador(dir, marcador(CONTROL, AT, [pagina("c")]));
    expect(segundo).not.toBe(primero);
    expect(JSON.parse(readFileSync(primero, "utf8")).pages).toBe(2);
    expect(JSON.parse(readFileSync(segundo, "utf8")).pages).toBe(1);
  });

  it("un fichero que ya estaba —de otra corrida, de otro formato— no se toca", () => {
    writeFileSync(join(dir, "salida.txt"), "lo medido antes");
    const ruta = escribirSinPisar(dir, "salida.txt", "lo medido ahora");
    expect(readFileSync(join(dir, "salida.txt"), "utf8")).toBe("lo medido antes");
    expect(readFileSync(ruta, "utf8")).toBe("lo medido ahora");
  });

  it("el brazo va DENTRO del JSON: `esfuerzo: null` escrito, no ausente", () => {
    const ruta = guardarMarcador(dir, marcador(CONTROL));
    const crudo = readFileSync(ruta, "utf8");
    expect(crudo).toContain('"esfuerzo": null');
    expect(JSON.parse(crudo).brazo).toEqual(CONTROL);
  });

  it("crea la carpeta si no existe — `scratch/` está en .gitignore y un clon nuevo no la tiene", () => {
    const ruta = guardarMarcador(join(dir, "scratch", "evals"), marcador(CONTROL));
    expect(existsSync(ruta)).toBe(true);
  });
});

// Las pruebas de arriba sujetan la función; ésta sujeta que el arnés la USE. Si
// alguien vuelve a escribir el marcador a mano, las de arriba siguen en verde y
// el defecto vuelve entero.
it("🔴 el arnés guarda el marcador por `guardarMarcador`, no con un nombre propio", () => {
  const arnes = readFileSync(join(process.cwd(), "scripts", "evals-pages.ts"), "utf8");
  expect(arnes).toContain("guardarMarcador(OUT_DIR, next)");
  expect(arnes).not.toMatch(/page-scorecard-\$\{/);
});
