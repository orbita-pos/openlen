// @vitest-environment node
// Against the real npm registry, OSV and esm.sh. Run on purpose:
//   OPENLEN_REAL_ESM=1 npx vitest run lib/apps/npm/real-esm.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { decodificarPng, leerPixel } from "@/lib/ai/png-crudo";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { installForApp, pendingInstall } from "./install";
import { readEsmLock } from "./lock";
import { __setModuleStoreForTest, memoryStore } from "./store";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const REAL = process.env.OPENLEN_REAL_ESM === "1";

beforeAll(() => __setModuleStoreForTest(memoryStore()));
afterAll(() => {
  __setModuleStoreForTest(null);
  stopBundlerWorker();
});

async function installAndBundle(main: string): Promise<{ js: string; files: Record<string, string> }> {
  const files: Record<string, string> = { "/src/main.tsx": main };
  const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { fetch, now: () => new Date(), store: memoryStore() } });
  const errors = out.notes.filter((n) => n.severity === "Error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("\n"));
  Object.assign(files, out.files);
  const bundle = await bundleApp({ carpeta: Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p))), app: APP, modo: "desarrollo" });
  if (!bundle?.ok) throw new Error(JSON.stringify(bundle));
  return { js: bundle.js, files };
}

describe.skipIf(!REAL)("open npm against the real esm.sh", () => {
  it("🔴 three + @react-three/fiber: one copy of three, useThree works inside <Canvas>, and the eyes see the red cube", async () => {
    const { js, files } = await installAndBundle(`import { createRoot } from "react-dom/client";
import { Canvas, useThree } from "@react-three/fiber";
function Probe() { const { gl } = useThree(); (window as any).__ok = Boolean(gl); return null; }
createRoot(document.getElementById("root")!).render(
  <Canvas style={{ width: 300, height: 300 }}><Probe /><mesh><boxGeometry args={[3, 3, 3]} /><meshBasicMaterial color="red" /></mesh></Canvas>,
);`);
    const lock = readEsmLock(files);
    expect(Date.now() - Date.parse(lock.packages["@react-three/fiber"]!.publishedAt)).toBeGreaterThan(7 * 86_400_000);
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      const warnings: string[] = [];
      page.on("console", (m) => warnings.push(m.text()));
      await page.setViewport({ width: 300, height: 300 });
      await page.setContent(`<!doctype html><body style="margin:0;background:#000"><div id="root"></div><script type="module">${js.replace(/<\/script/g, "<\\/script")}</script></body>`, { waitUntil: "load" });
      await page.waitForFunction("window.__ok === true", { timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 500));
      expect(warnings.filter((w) => w.includes("Multiple instances of Three.js"))).toEqual([]);
      const [r, g, b] = leerPixel(decodificarPng(new Uint8Array(await page.screenshot({ type: "png" }))), 150, 150)!;
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("leaflet + react-leaflet: its CSS applies and the marker image loads with the usual Vite fix", async () => {
    const { js } = await installAndBundle(`import { createRoot } from "react-dom/client";
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
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><div id="root"></div><script type="module">${js.replace(/<\/script/g, "<\\/script")}</script>`, { waitUntil: "load" });
      await page.waitForSelector(".leaflet-marker-icon", { timeout: 20_000 });
      expect(await page.$eval(".leaflet-container", (e) => getComputedStyle(e).overflow)).toBe("hidden");
      await page.waitForFunction(() => (document.querySelector(".leaflet-marker-icon") as HTMLImageElement).naturalWidth > 0, { timeout: 10_000 });
    } finally {
      await browser.close();
    }
  }, 240_000);
});
