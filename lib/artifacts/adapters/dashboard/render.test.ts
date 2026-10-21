// @vitest-environment node
import { expect, it } from "vitest";
import { buildDashboard } from "./compile";
import { renderDashboard } from "./render";
import type { SealedArtifactInput } from "../../types";
const dataset = { id: "d1", mode: "scenario", environment: null, visibility: "project", columns: ["Zona", "Ventas"], rows: [["Norte", 120], ["Sur", 80]], query: null, source: "scenario", capturedAt: "2026-10-17T10:00:00Z", truncated: false } as const;
const input = { artifact: { kind: "dashboard" }, revision: { files: { "dashboard.json": JSON.stringify({ entry: "index.html", datasetIds: ["d1"], width: 1280, height: 720, probes: [{ select: { selector: "#zone", value: "Norte" }, expect: { selector: "#total", text: "120" } }] }), "index.html": '<html lang="es"><head></head><body><h1>Ventas</h1><script type="module" src="./main.ts"></script></body></html>', "main.ts": 'const rows: unknown[][] = window.lenData.datasets[0].rows; document.body.dataset.rows = String(rows.length);' } }, datasets: [dataset], assets: [] } as unknown as SealedArtifactInput;

it("packages independent compiled sources and exports the same labeled scenario rows as CSV", async () => {
  const result = await buildDashboard(input);
  expect(result.html).toContain("Escenario hipotético");
  expect(result.html).toContain('"Norte",120');
  expect(result.html).not.toContain('src="./main.ts"');
  expect(result.csv[0]!.text).toContain("Zona,Ventas\r\nNorte,120\r\nSur,80");
  expect(result.csv[0]!.text).toContain("Escenario hipotético");
  expect(input.revision.files["main.ts"]).toContain("unknown[][]");
});

it("exports display rows and provenance without the saved backend SQL or refresh parameters",async()=>{
  const result=await buildDashboard({...input,datasets:[{...dataset,mode:"live",visibility:"owner",environment:"live",source:"backend",query:"select 'private-query-marker'",parameters:{zone:"private-filter-marker"}}]});
  expect(result.html).toContain("Datos actualizados");
  expect(result.html).not.toContain("private-query-marker");
  expect(result.html).not.toContain("private-filter-marker");
  expect(result.html).toContain('"Norte",120');
});

it("rejects a real compile error, missing resource and an unbound dataset", async () => {
  for (const files of [ { ...input.revision.files, "main.ts": "const invalid: =" }, { ...input.revision.files, "index.html": '<img src="https://private.example/x.png">' } ]) {
    await expect(buildDashboard({ ...input, revision: { ...input.revision, files } })).rejects.toBeDefined();
  }
  await expect(buildDashboard({ ...input, datasets: [] })).rejects.toMatchObject({ code: "dashboard_dataset_missing" });
});

it("only returns outputs after the actual render validates and rejects corrupt PNGs", async () => {
  await expect(renderDashboard(input, async () => { throw new Error("console error"); }, new AbortController().signal)).rejects.toThrow("console error");
  await expect(renderDashboard(input, async () => ({ png: new Uint8Array([1]), checks: ["claimed screenshot"] }), new AbortController().signal)).rejects.toMatchObject({ code: "invalid_render_png" });
});

const scenarioFiles = (extra: Record<string, unknown> = {}) => ({
  "dashboard.json": JSON.stringify({ entry: "index.html", datasetIds: ["escenario.csv"], datasets: { "escenario.csv": { title: "100 clientes por mes", description: "Filas escritas con los datos de LEN.md." } }, width: 1280, height: 720, ...extra }),
  "index.html": '<html lang="es"><head></head><body><p id="n"></p><script>document.getElementById("n").textContent=String(window.lenData.datasets[0].rows.length)</script></body></html>',
  "escenario.csv": 'mes,clientes,ingreso\n"Mes 1",40,"11,960"\nMes 2,55,16445\n',
});

it("takes a CSV the dashboard carries as its dataset: rows written for the scenario, labeled as one", async () => {
  const result = await buildDashboard({ ...input, revision: { ...input.revision, files: scenarioFiles() }, datasets: [] } as unknown as SealedArtifactInput);
  expect(result.html).toContain('"columns":["mes","clientes","ingreso"]');
  expect(result.html).toContain('["Mes 1",40,"11,960"],["Mes 2",55,16445]');
  expect(result.html).toContain("Escenario hipotético · 100 clientes por mes");
  expect(result.csv).toEqual([{ id: "escenario", text: expect.stringContaining("mes,clientes,ingreso\r\nMes 1,40,\"11,960\"") }]);
});

it("takes JSON rows as objects too, and says what a dataset can be when none is given", async () => {
  const files = { ...scenarioFiles({ datasetIds: ["datos.json"], datasets: undefined }), "datos.json": JSON.stringify({ rows: [{ zona: "Norte", ventas: 120 }, { zona: "Sur", ventas: 80 }] }) };
  const result = await buildDashboard({ ...input, revision: { ...input.revision, files }, datasets: [] } as unknown as SealedArtifactInput);
  expect(result.html).toContain('"columns":["zona","ventas"]');
  expect(result.html).toContain('["Norte",120],["Sur",80]');
  await expect(buildDashboard({ ...input, revision: { ...input.revision, files: scenarioFiles({ datasetIds: [] }) }, datasets: [] } as unknown as SealedArtifactInput))
    .rejects.toMatchObject({ code: "dashboard_dataset_missing", message: expect.stringMatching(/query_artifact_data.*CSV, TSV or JSON file/) });
  await expect(buildDashboard({ ...input, revision: { ...input.revision, files: scenarioFiles({ datasetIds: ["nada.csv"] }) }, datasets: [] } as unknown as SealedArtifactInput))
    .rejects.toMatchObject({ code: "dashboard_dataset_missing", message: expect.stringContaining('"nada.csv"') });
});

it("gives every dashboard d3 v7 as the global d3, verified and before the page's own scripts", async () => {
  const result = await buildDashboard(input);
  const d3 = result.html.indexOf("https://d3js.org v7.9.0");
  expect(d3).toBeGreaterThan(-1);
  expect(d3).toBeLessThan(result.html.indexOf("window.lenData=Object.freeze"));
  expect(result.html.indexOf("window.lenData=Object.freeze")).toBeLessThan(result.html.indexOf("<h1>Ventas</h1>"));
});

it("names what is missing: a remote script or stylesheet, a file that is not there", async () => {
  const with_ = (html: string) => ({ ...input, revision: { ...input.revision, files: { ...input.revision.files, "index.html": html } } } as unknown as SealedArtifactInput);
  await expect(buildDashboard(with_('<html><head><script src="https://cdn.example.com/chart.js"></script></head><body></body></html>'))).rejects.toMatchObject({ code: "artifact_resource_missing", message: expect.stringContaining("https://cdn.example.com/chart.js") });
  await expect(buildDashboard(with_('<html><head><link rel="stylesheet" href="estilos.css"></head><body></body></html>'))).rejects.toMatchObject({ code: "artifact_resource_missing", message: expect.stringContaining("estilos.css") });
  await expect(buildDashboard(with_('<html><head></head><body><img src="https://example.com/foto.png"></body></html>'))).rejects.toMatchObject({ code: "artifact_resource_missing", message: expect.stringContaining("https://example.com/foto.png") });
});

it("bakes an app's Tailwind CDN into CSS, as publishing does: no network when it renders", async () => {
  const files = { ...input.revision.files, "index.html": '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div><script type="module" src="./main.ts"></script></body></html>', "main.ts": 'document.getElementById("root")!.className = "bg-amber-500 text-white p-6";' };
  const result = await buildDashboard({ ...input, revision: { ...input.revision, files } } as unknown as SealedArtifactInput);
  expect(result.html).not.toContain("cdn.tailwindcss.com");
  expect(result.html).toMatch(/\.bg-amber-500\s*\{/);
  expect(result.html).toMatch(/\.p-6\s*\{/);
});

it("compiles an app's real shell offline: Tailwind baked, Inter from the renderer, no hints to remote hosts", async () => {
  const { cascaronDeLaApp } = await import("../../../apps/esqueleto");
  const shell = cascaronDeLaApp({ titulo: "Turnia", idioma: "es", entrada: "./main.ts" });
  const files = { ...input.revision.files, "index.html": shell, "main.ts": 'document.getElementById("root")!.className = "bg-amber-500 p-6";' };
  const result = await buildDashboard({ ...input, revision: { ...input.revision, files } } as unknown as SealedArtifactInput);
  expect(result.html).not.toMatch(/https:\/\/(cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/);
  expect(result.html).toMatch(/\.bg-amber-500\s*\{/);
  expect(result.html).toContain('font-family: "Inter"');
});

it("bundles an app's open npm packages from its lock, as the canvas and publishing do", async () => {
  const { serializeEsmLock } = await import("../../../apps/npm/lock");
  const { __setModuleStoreForTest, memoryStore, sha256Hex } = await import("../../../apps/npm/store");
  const code = 'export default function tiny() { return "tiny-from-esm"; }', url = "https://esm.sh/tiny@1.0.0/x.mjs", set = { entry: url, modules: { [url]: sha256Hex(code) } };
  const store = memoryStore(); await store.put(sha256Hex(code), code); __setModuleStoreForTest(store);
  try {
    const files = { ...input.revision.files, "main.ts": 'import tiny from "tiny"; document.body.dataset.t = tiny();', "package.json": JSON.stringify({ dependencies: { tiny: "^1.0.0" } }),
      ".openlen/esm-lock.json": serializeEsmLock({ lockfileVersion: 1, packages: { tiny: { version: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z", externals: [], development: { "": set }, production: { "": set }, assets: {}, types: null, warnings: [], bytes: code.length } } }) };
    const result = await buildDashboard({ ...input, revision: { ...input.revision, files } } as unknown as SealedArtifactInput);
    expect(result.html).toContain("tiny-from-esm");
  } finally { __setModuleStoreForTest(null); }
});
