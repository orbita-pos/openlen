// @vitest-environment node
// THE GAME MODE (spec local 2026-11-05-modo-juego-design, §10): a game is born without an engine, so everything
// rides on three and Phaser coming through open npm — the gate, esm.sh, the bundler within its 30 s — and painting
// in Len's eyes (software WebGL). Against the real npm registry, OSV and esm.sh. Run on purpose:
//   OPENLEN_REAL_ESM=1 npx vitest run lib/games/engines-real-esm.browser.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "puppeteer";

import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { decodificarPng, leerPixel } from "@/lib/ai/png-crudo";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { installForApp, pendingInstall } from "@/lib/apps/npm/install";
import { readEsmLock } from "@/lib/apps/npm/lock";
import { __setModuleStoreForTest, memoryStore } from "@/lib/apps/npm/store";

const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const REAL = process.env.OPENLEN_REAL_ESM === "1";
const MODES = ["desarrollo", "produccion"] as const;
type Mode = (typeof MODES)[number];
const BUNDLER_CAP_MS = 30_000;

beforeAll(() => __setModuleStoreForTest(memoryStore()));
afterAll(() => {
  __setModuleStoreForTest(null);
  stopBundlerWorker();
});

async function installAndBundle(main: string): Promise<{ js: Record<Mode, string>; files: Record<string, string>; ms: Record<Mode, number> }> {
  const files: Record<string, string> = { "/src/main.tsx": main };
  const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { fetch, now: () => new Date(), store: memoryStore() } });
  const errors = out.notes.filter((n) => n.severity === "Error");
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("\n"));
  Object.assign(files, out.files);
  const carpeta = Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p)));
  const js = {} as Record<Mode, string>;
  const ms = {} as Record<Mode, number>;
  for (const modo of MODES) {
    const t0 = performance.now();
    const bundle = await bundleApp({ carpeta, app: APP, modo });
    ms[modo] = Math.round(performance.now() - t0);
    if (!bundle?.ok) throw new Error(`${modo}: ${JSON.stringify(bundle)}`);
    js[modo] = bundle.js;
  }
  return { js, files, ms };
}

/** Runs the bundle in the eyes' Chromium (software WebGL) and reads the center pixel once `window.__ok` is set. */
async function centerPixel(js: string): Promise<{ rgb: [number, number, number]; errors: string[]; out: unknown }> {
  const browser = await lanzarChromium();
  try {
    const page: Page = await browser.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewport({ width: 300, height: 300 });
    await page.setContent(
      `<!doctype html><body style="margin:0;background:#000"><div id="root" style="width:300px;height:300px"></div><script type="module">${js.replace(/<\/script/g, "<\\/script")}</script></body>`,
      { waitUntil: "load" },
    );
    await page.waitForFunction("window.__ok === true", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 500));
    const [r, g, b] = leerPixel(decodificarPng(new Uint8Array(await page.screenshot({ type: "png" }))), 150, 150)!;
    return { rgb: [r, g, b], errors, out: await page.evaluate("window.__out") };
  } finally {
    await browser.close();
  }
}

describe.skipIf(!REAL)("a game's engines through the real open npm", () => {
  it("🔴 three with WebGLRenderer, GLTFLoader and meshopt's decoder: installs, bundles within the cap, and the eyes see the red cube", async () => {
    const { js, files, ms } = await installAndBundle(`import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
const host = document.getElementById("root")!;
const renderer = new THREE.WebGLRenderer();
renderer.setSize(300, 300);
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.z = 3;
scene.add(new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshBasicMaterial({ color: 0xff0000 })));
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  (window as any).__out = [THREE.REVISION, typeof loader.loadAsync, typeof MeshoptDecoder.decodeGltfBuffer];
  (window as any).__ok = true;
});`);
    const three = readEsmLock(files).packages.three!;
    console.log(`three ${three.version}: bundled in ${ms.desarrollo} ms (development), ${ms.produccion} ms (production)`);
    for (const modo of MODES) {
      expect(ms[modo], modo).toBeLessThan(BUNDLER_CAP_MS);
      const { rgb, errors, out } = await centerPixel(js[modo]);
      expect(errors, modo).toEqual([]);
      expect((out as unknown[]).slice(1), modo).toEqual(["function", "function"]);
      expect([rgb[0] > 200, rgb[1] < 60, rgb[2] < 60], `${modo}: rgb(${rgb.join(",")})`).toEqual([true, true, true]);
    }
  }, 300_000);

  it("🔴 Phaser 4: installs, bundles within the cap, and the eyes see its scene draw", async () => {
    const { js, files, ms } = await installAndBundle(`import { AUTO, Game, Scene } from "phaser";
class Red extends Scene {
  constructor() { super("Red"); }
  create() {
    this.add.rectangle(150, 150, 300, 300, 0xff0000);
    (window as any).__out = [this.sys.game.config.renderType];
    this.time.delayedCall(50, () => ((window as any).__ok = true));
  }
}
new Game({ type: AUTO, width: 300, height: 300, parent: "root", backgroundColor: "#000000", scene: [Red], audio: { noAudio: true } });`);
    const phaser = readEsmLock(files).packages.phaser!;
    console.log(`phaser ${phaser.version}: bundled in ${ms.desarrollo} ms (development), ${ms.produccion} ms (production)`);
    for (const modo of MODES) {
      expect(ms[modo], modo).toBeLessThan(BUNDLER_CAP_MS);
      const { rgb, errors } = await centerPixel(js[modo]);
      expect(errors, modo).toEqual([]);
      expect([rgb[0] > 200, rgb[1] < 60, rgb[2] < 60], `${modo}: rgb(${rgb.join(",")})`).toEqual([true, true, true]);
    }
  }, 300_000);
});
