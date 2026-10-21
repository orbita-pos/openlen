// @vitest-environment node
// A dashboard drawn with the global d3, from a CSV it carries, in a real Chromium through the renderer's page.
import { afterAll, beforeAll, expect, it } from "vitest";
import puppeteer from "puppeteer";
import { buildDashboard } from "./compile";
import { stopBundlerWorker } from "../../../apps/bundler/bundle-app";
import type { SealedArtifactInput } from "../../types";
import { renderDashboardPacket, renderProjectCapturePacket } from "../../../../tools/artifact-renderer/browser.mjs";

// Explicit opt-in: this launches Chrome, unlike pure/SQL infrastructure tests.
const run = process.env.ARTIFACT_BROWSER_TESTS === "1" ? it : it.skip;
let executablePath: string;
beforeAll(async () => { executablePath = process.env.ARTIFACT_TEST_BROWSER_EXECUTABLE?.trim() || await Promise.resolve(puppeteer.executablePath()); });
afterAll(() => stopBundlerWorker());

const page = (body: string, script: string) => `<!doctype html><html lang="es"><head><style>body{margin:0;padding:48px;font:20px system-ui;background:#fbfbf8;color:#1a1a1a}</style></head><body>${body}<script>${script}</script></body></html>`;
const CHART = `const d = window.lenData.datasets[0], mes = d.columns.indexOf("mes"), clientes = d.columns.indexOf("clientes");
const svg = d3.select("#chart").attr("width", 600).attr("height", 300);
const x = d3.scaleBand(d.rows.map((r) => r[mes]), [40, 580]).padding(0.3), y = d3.scaleLinear([0, d3.max(d.rows, (r) => r[clientes])], [270, 20]);
svg.selectAll("rect").data(d.rows).join("rect").attr("x", (r) => x(r[mes])).attr("y", (r) => y(r[clientes])).attr("width", x.bandwidth()).attr("height", (r) => 270 - y(r[clientes])).attr("rx", 4).attr("fill", "#2b7a78");
svg.append("g").attr("transform", "translate(0,270)").call(d3.axisBottom(x));`;
async function render(html: string, script: string, probes: unknown[] = []) {
  const input = { artifact: { kind: "dashboard" }, revision: { files: {
    "dashboard.json": JSON.stringify({ entry: "index.html", datasetIds: ["escenario.csv"], datasets: { "escenario.csv": { title: "100 clientes por mes" } }, width: 1280, height: 720 }),
    "index.html": page(html, script),
    "escenario.csv": "mes,clientes\nMes 1,40\nMes 2,55\nMes 3,70\n",
  } }, datasets: [], assets: [] } as unknown as SealedArtifactInput;
  const built = await buildDashboard(input);
  return renderDashboardPacket({ version: 1, kind: "dashboard", html: built.html, width: 1280, height: 720, probes }, { executablePath });
}

run("draws with the global d3 and checks a marked figure against its data", async () => {
  const result = await render(`<h1>Clientes</h1><p id="total" data-source="escenario.csv" data-field="clientes" data-where="mes=Mes%202">55 clientes</p><svg id="chart"></svg>`, CHART);
  expect(result.checks).toContain("marks:checked:1");
  expect(result.checks.filter((c: string) => c.startsWith("output:"))).toEqual([]);
}, 90_000);

run("reports a figure that is not its data, and labels drawn over each other", async () => {
  const result = await render(`<p id="total" data-source="escenario.csv" data-field="clientes" data-where="mes=Mes%202">1,200</p><svg id="chart"></svg><svg id="labels" width="300" height="100"><rect width="300" height="100" fill="#eee"/><text x="20" y="50">Norte</text><text x="24" y="52">Sur</text></svg>`, CHART);
  expect(result.checks).toContain('output:mark_mismatch:#total [escenario.csv.clientes] "shows \\"1,200\\", data has 55"');
  expect(result.checks).toContain('output:labels_overlap:#labels "Norte / Sur"');
}, 90_000);

run("stops an export that shows NaN", async () => {
  await expect(render(`<p id="avg"></p><svg id="chart"></svg>`, `${CHART}\ndocument.getElementById("avg").textContent = "Promedio: " + (0 / 0);`)).rejects.toThrow("dashboard_output_invalid");
}, 90_000);

run("reports a failed probe with what the page shows, without stopping the export", async () => {
  const html = `<select id="metrica"><option value="clientes">Clientes</option><option value="mrr">MRR</option></select><p id="foco">0</p><svg id="chart"></svg>`;
  const script = `${CHART}
const s = document.getElementById("metrica"), f = document.getElementById("foco"); const show = () => { f.textContent = s.value === "clientes" ? "1.200 barberías" : "$358,800"; }; s.addEventListener("change", show); show();`;
  const result = await render(html, script, [
    { select: { selector: "#metrica", value: "mrr" }, expect: { selector: "#foco", text: "$358,800" } },
    { select: { selector: "#metrica", value: "clientes" }, expect: { selector: "#foco", text: "1,200" } },
    { select: { selector: "#metrica", value: "Clientes" }, expect: { selector: "#foco", text: "1,200" } },
    { select: { selector: "#nada", value: "x" }, expect: { selector: "#foco", text: "x" } },
  ]);
  expect(result.checks).toContain("interaction:0:passed");
  expect(result.checks).toContain('output:probe_failed:1 after choosing "clientes" in #metrica, #foco shows "1.200 barberías"; expected "1,200"');
  expect(result.checks).toContain('output:probe_failed:2 #metrica has no option with value "Clientes" (values: "clientes", "mrr")');
  expect(result.checks).toContain("output:probe_failed:3 #nada is not on the page");
}, 90_000);

run("names the URL a dashboard tried to reach", async () => {
  await expect(render(`<svg id="chart"></svg>`, `${CHART}
fetch("https://api.example.com/datos.json").catch(() => {});`)).rejects.toMatchObject({ message: "artifact_resource_missing", cause: [expect.stringMatching(/^https:\/\/api\.example\.com\/datos\.json: blocked/)] });
}, 90_000);

run("captures an app screen at its hash route", async () => {
  const html = `<!doctype html><html><head></head><body><h1 id="s"></h1><script>if (location.hash !== "#/reservar") throw new Error("wrong screen " + location.hash); document.getElementById("s").textContent = "Reservar";</script></body></html>`;
  const result = await renderProjectCapturePacket({ version: 1, kind: "capture", html, width: 1280, height: 720, probes: [], route: "#/reservar" }, { executablePath });
  expect(result.checks).toContain("runtime:no-errors");
  await expect(renderProjectCapturePacket({ version: 1, kind: "capture", html, width: 1280, height: 720, probes: [] }, { executablePath })).rejects.toThrow("artifact_runtime_error");
}, 90_000);
