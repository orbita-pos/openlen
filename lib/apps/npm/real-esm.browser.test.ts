// @vitest-environment node
// Against the real npm registry, OSV and esm.sh. Run on purpose:
//   OPENLEN_REAL_ESM=1 npx vitest run lib/apps/npm/real-esm.browser.test.ts
// Every case runs twice: the development bundle (the canvas and the eyes) and
// the production one (what publishing writes) — esm.sh serves different files
// for each, and their internals differ (react-dom/server's are …production).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { decodificarPng, leerPixel } from "@/lib/ai/png-crudo";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { checkAppInWorker, stopCheckerWorker } from "@/lib/apps/checker/check-app";
import type { Page } from "puppeteer";
import { installForApp, pendingInstall } from "./install";
import { readEsmLock, readPackageJson } from "./lock";
import { __setModuleStoreForTest, memoryStore } from "./store";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const REAL = process.env.OPENLEN_REAL_ESM === "1";
const MODES = ["desarrollo", "produccion"] as const;
type Mode = (typeof MODES)[number];

beforeAll(() => __setModuleStoreForTest(memoryStore()));
afterAll(() => {
  __setModuleStoreForTest(null);
  stopBundlerWorker();
  stopCheckerWorker();
});

async function installAndBundle(main: string): Promise<{ js: Record<Mode, string>; files: Record<string, string> }> {
  const files: Record<string, string> = { "/src/main.tsx": main };
  const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { fetch, now: () => new Date(), store: memoryStore() } });
  const errors = out.notes.filter((n) => n.severity === "Error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("\n"));
  Object.assign(files, out.files);
  const carpeta = Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p)));
  const js = {} as Record<Mode, string>;
  for (const modo of MODES) {
    const bundle = await bundleApp({ carpeta, app: APP, modo });
    if (!bundle?.ok) throw new Error(`${modo}: ${JSON.stringify(bundle)}`);
    js[modo] = bundle.js;
  }
  return { js, files };
}

/** Opens a page with the bundle, collecting console errors and uncaught exceptions. */
async function withPage(js: string, html: string, f: (page: Page, errors: string[], warnings: string[]) => Promise<void>): Promise<void> {
  const browser = await lanzarChromium();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors : warnings).push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewport({ width: 400, height: 300 });
    await page.setContent(`<!doctype html>${html}<script type="module">${js.replace(/<\/script/g, "<\\/script")}</script>`, { waitUntil: "load" });
    await f(page, errors, warnings);
  } finally {
    await browser.close();
  }
}

/** Runs the bundle and returns `window.__out` once set, with the page's errors. */
async function outOf(js: string): Promise<{ out: unknown; errors: string[] }> {
  let result: { out: unknown; errors: string[] } = { out: undefined, errors: [] };
  await withPage(js, `<div id="root"></div>`, async (page, errors) => {
    await page.waitForFunction("window.__out !== undefined", { timeout: 20_000 });
    result = { out: await page.evaluate("window.__out"), errors };
  });
  return result;
}

describe.skipIf(!REAL)("open npm against the real esm.sh", () => {
  it("🔴 three + @react-three/fiber: one copy of three, useThree works inside <Canvas>, and the eyes see the red cube — development and production", async () => {
    const { js, files } = await installAndBundle(`import { createRoot } from "react-dom/client";
import { Canvas, useThree } from "@react-three/fiber";
import { Color } from "three";
function Probe() { const { gl } = useThree(); (window as any).__ok = Boolean(gl); return null; }
createRoot(document.getElementById("root")!).render(
  <Canvas style={{ width: 300, height: 300 }}><Probe /><mesh><boxGeometry args={[3, 3, 3]} /><meshBasicMaterial color={new Color("red")} /></mesh></Canvas>,
);`);
    const lock = readEsmLock(files);
    expect(Date.now() - Date.parse(lock.packages["@react-three/fiber"]!.publishedAt)).toBeGreaterThan(7 * 86_400_000);
    // The checker finds three through @types/three's "exports" (build/three.module.d.ts), so fiber's JSX elements type too.
    const checked = await checkAppInWorker({ files: Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p))), catalogo: APP.catalogo });
    expect((checked?.typescript ?? []).map((d) => `${d.codigo} ${d.mensaje}`)).toEqual([]);
    for (const modo of MODES) {
      await withPage(js[modo], `<body style="margin:0;background:#000"><div id="root"></div></body>`, async (page, errors, warnings) => {
        await page.setViewport({ width: 300, height: 300 });
        await page.waitForFunction("window.__ok === true", { timeout: 20_000 });
        await new Promise((r) => setTimeout(r, 500));
        expect([...errors, ...warnings].filter((w) => w.includes("Multiple instances of Three.js")), modo).toEqual([]);
        const [r, g, b] = leerPixel(decodificarPng(new Uint8Array(await page.screenshot({ type: "png" }))), 150, 150)!;
        expect([r > 200, g < 60, b < 60], `${modo}: rgb(${r},${g},${b})`).toEqual([true, true, true]);
      });
    }
  }, 300_000);

  it("leaflet + react-leaflet: its CSS applies and the marker image loads with the usual Vite fix — development and production", async () => {
    const { js, files } = await installAndBundle(`import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import icon from "leaflet/dist/images/marker-icon.png";
import shadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, Marker } from "react-leaflet";
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: icon, iconRetinaUrl: icon, shadowUrl: shadow });
createRoot(document.getElementById("root")!).render(
  <MapContainer center={[19.43, -99.13]} zoom={12} style={{ width: 400, height: 300 }}><Marker position={[19.43, -99.13]} /></MapContainer>,
);`);
    // The checker: @types/leaflet and react-leaflet's types, and the package's .png imported as URLs.
    const checked = await checkAppInWorker({ files: Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p))), catalogo: APP.catalogo });
    expect((checked?.typescript ?? []).map((d) => `${d.codigo} ${d.mensaje}`)).toEqual([]);
    for (const modo of MODES) {
      await withPage(js[modo], `<div id="root"></div>`, async (page) => {
        await page.waitForSelector(".leaflet-marker-icon", { timeout: 20_000 });
        expect(await page.$eval(".leaflet-container", (e) => getComputedStyle(e).overflow), modo).toBe("hidden");
        await page.waitForFunction(() => (document.querySelector(".leaflet-marker-icon") as HTMLImageElement).naturalWidth > 0, { timeout: 10_000 });
      });
    }
  }, 300_000);

  it("🔴 react-dom/server, a part the catalog doesn't ship: one React (hooks work in renderToString and on the canvas), and the checker finds its types — development and production", async () => {
    const { js, files } = await installAndBundle(`import { useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
function Hello() { const [n] = useState(3); return <b>{"n=" + n}</b>; }
const html = renderToString(<Hello />);
createRoot(document.getElementById("root")!).render(<Hello />);
setTimeout(() => { (window as any).__out = [html, document.getElementById("root")!.innerHTML]; }, 200);`);
    const part = readEsmLock(files).packages["react-dom"]!;
    console.log("react-dom parts:", Object.keys(part.development), "| production:", Object.keys(part.production));
    expect(part).toMatchObject({ version: "19.2.6", catalogParts: true, externals: ["react", "react-dom"], typesFrom: { name: "@types/react-dom" } });
    // Nothing of React or react-dom's own entry from esm.sh: those stay the catalog's.
    const urls = [...Object.values(part.development), ...Object.values(part.production)].flatMap((s) => Object.keys(s.modules));
    expect(urls.filter((u) => /\/react@\d|\/react-dom\.(?:development\.)?mjs/.test(u))).toEqual([]);
    expect(Object.keys(part.types ?? {})).toContain("/node_modules/@types/react-dom/server.d.ts");
    expect(Object.keys(part.types ?? {})).not.toContain("/node_modules/@types/react-dom/client.d.ts");
    for (const modo of MODES) {
      const { out, errors } = await outOf(js[modo]);
      expect(errors, modo).toEqual([]);
      expect(out, modo).toEqual(["<b>n=3</b>", "<b>n=3</b>"]);
    }
    // The checker, with an empty cache: it fetches the part's .d.ts again from esm.sh (typesFrom).
    const checked = await checkAppInWorker({ files: Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p))), catalogo: APP.catalogo });
    expect((checked?.typescript ?? []).filter((d) => /react-dom\/server|TS2307/.test(`${d.mensaje} ${d.codigo}`))).toEqual([]);
  }, 300_000);

  it("🔴 zod/v4 next to the catalog's zod: the part comes from esm.sh at the same version, both work — development and production", async () => {
    const { js, files } = await installAndBundle(`import { z } from "zod";
import { z as z4 } from "zod/v4";
(window as any).__out = [z.string().parse("a"), z4.string().parse("b"), typeof z4.email];`);
    const part = readEsmLock(files).packages.zod!;
    expect(part).toMatchObject({ version: "3.25.76", catalogParts: true, externals: ["zod"] });
    expect(readPackageJson(files)?.dependencies?.zod).toBe("^3.25.76");
    for (const modo of MODES) {
      const { out, errors } = await outOf(js[modo]);
      expect(errors, modo).toEqual([]);
      expect(out, modo).toEqual(["a", "b", "function"]);
    }
  }, 300_000);
});
