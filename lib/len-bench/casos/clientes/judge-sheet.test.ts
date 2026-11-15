// lib/len-bench/casos/clientes/judge-sheet.test.ts
// @vitest-environment node
//
// THE JUDGE'S CALIBRATION SHEET (plan local 2026-11-15, task 10; spec §9 row 7): ~15 cases as the judge would see
// them, for Jesús to label by hand, and the three sanity entries the spec asks the judge to fail. Written outside
// the repo: it carries customers' words.
import { describe, expect, it } from "vitest";

import type { DatosDelCaso } from "../../tipos";
import type { FetchedCase } from "./fetched";
import { judgeSheet, SANITY_ENTRIES, SHEET_SIZE, sheetCases } from "./judge-sheet";
import { CUMPLE_LO_PEDIDO } from "./rubric";

// Stands in for Chromium (rendered.ts, covered by rendered.browser.test.ts): every page, home first, without tags.
const painted: DatosDelCaso[] = [];
const paint = async (d: DatosDelCaso) => {
  painted.push(d);
  return [d.html ?? "", ...Object.values(d.pages ?? {}).map((p) => p.html)].map((h) => h.replace(/<[^>]+>/g, "")).join("\n");
};

const caso = (i: number): FetchedCase => ({
  projectId: `0000000${i.toString(16)}-0000-4000-8000-000000000000`.slice(-36),
  fetchedAt: "t",
  start: { html: "" },
  final: { html: `<body><h1>Página ${i}</h1></body>`, pages: { menu: { html: `<p>Menú ${i}</p>` } } },
  ownerMessages: [`pedido ${i}`],
  cardAnswers: [],
  published: null,
});

describe("judgeSheet", () => {
  it("at most 15 cases, each with what the judge sees and a box to label", async () => {
    const sheet = await judgeSheet(Array.from({ length: 20 }, (_, i) => caso(i + 1)), paint);
    expect(sheet.match(/^## \d+\. cliente-/gm)).toHaveLength(15);
    expect(sheet.match(/Tu etiqueta: \[ \] PASS · \[ \] FAIL/g)).toHaveLength(15 + SANITY_ENTRIES.length);
    expect(sheet).toContain("1. pedido 1");
    expect(sheet).toContain("Página 1");
    // Every page of the final state is in the judge's view, not only the home.
    expect(sheet).toContain("Menú 1");
    // The page as a visitor sees it, never its markup: the judge in a run reads it painted.
    expect(sheet).not.toContain("<h1>");
  });

  it("ends with the three sanity entries the judge must FAIL: an empty page, «I don't know», an answer to another request", async () => {
    expect(SANITY_ENTRIES.map((s) => s.nombre)).toEqual(["pagina-vacia", "no-se", "otra-peticion"]);
    painted.length = 0;
    const sheet = await judgeSheet([caso(1)], paint);
    for (const s of SANITY_ENTRIES) expect(sheet).toContain(`cordura · ${s.nombre} · esperado: FAIL`);
    // Painted like the cases: the sanity entries reach the judge the same way.
    expect(painted.map((d) => d.html)).toEqual([caso(1).final.html, ...SANITY_ENTRIES.map((s) => s.html)]);
    expect(sheet).not.toContain("<h1>");
  });

  it("states the criterion once, as the judge gets it, every line of it quoted", async () => {
    const sheet = await judgeSheet([caso(1)], paint);
    expect(sheet.split("Cada cosa concreta que el dueño pidió")).toHaveLength(2);
    for (const line of CUMPLE_LO_PEDIDO.split("\n")) expect(sheet).toContain(`> ${line}\n`);
  });
});

// The first 15 cases are the sheet the criterion was read against; the rest are held out — neither the labeller
// nor the judge saw them before the criterion was fixed — and say whether it holds on cases it was not fitted to.
describe("sheetCases", () => {
  const ids = Array.from({ length: 24 }, (_, i) => `id-${i}`);
  it("the sheet is the 15 most recent; the held-out sheet, everything after them", () => {
    expect(sheetCases(ids, "hoja")).toEqual(ids.slice(0, SHEET_SIZE));
    expect(sheetCases(ids, "reserva")).toEqual(ids.slice(SHEET_SIZE));
    expect(SHEET_SIZE).toBe(15);
  });
  it("together they are every case, once", () => {
    expect([...sheetCases(ids, "hoja"), ...sheetCases(ids, "reserva")]).toEqual(ids);
  });
});
