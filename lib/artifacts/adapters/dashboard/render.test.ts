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
