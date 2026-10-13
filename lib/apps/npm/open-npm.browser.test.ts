// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { ficherosDeLaApp } from "@/lib/apps/servir";
import { installForApp, pendingInstall } from "./install";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { __setModuleStoreForTest, memoryStore } from "./store";
import { startFakeNpm, type FakeNpm } from "./test-support/fake-npm";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const COUNTER = `import { useState, createElement } from "react";\nexport function Counter() { const [n] = useState(41); return createElement("p", { id: "out" }, String(n + 1)); }`;
let npm: FakeNpm;
let restore: () => void;

beforeAll(async () => {
  const mods: Record<string, string> = {};
  for (const [q, f] of [["?target=es2022&external=react&dev", "hooky.development.mjs"], ["?target=es2022&external=react", "hooky.mjs"]] as const) {
    mods[`/hooky@1.0.0${q}`] = `export * from "/hooky@1.0.0/X-ZXJlYWN0/es2022/${f}";`;
    mods[`/hooky@1.0.0/X-ZXJlYWN0/es2022/${f}`] = COUNTER;
  }
  npm = await startFakeNpm({
    now: NOW,
    packages: [{ name: "hooky", createdDaysAgo: 400, versions: { "1.0.0": { daysAgo: 300, peerDependencies: { react: ">=19" } } } }],
    modules: mods,
  });
  restore = npm.useEnv();
  __setModuleStoreForTest(memoryStore());
});
afterAll(async () => {
  restore();
  __setModuleStoreForTest(null);
  stopBundlerWorker();
  await npm.close();
});

async function render(js: string): Promise<{ text: string | null; errors: string[] }> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setContent(`<!doctype html><div id="root"></div><script type="module">${js.replace(/<\/script/g, "<\\/script")}</script>`, { waitUntil: "load" });
    await page.waitForSelector("#out", { timeout: 10_000 }).catch(() => null);
    return { text: await page.$eval("#out", (e) => e.textContent).catch(() => null), errors };
  } finally {
    await browser.close();
  }
}

describe("open npm end to end", () => {
  it("🔴 an import installs on save, bundles with the catalog's React (one copy: hooks work), and never ships package.json or the lock", async () => {
    const files: Record<string, string> = {
      "/src/main.tsx": `import { createRoot } from "react-dom/client";\nimport { Counter } from "hooky";\ncreateRoot(document.getElementById("root")!).render(<Counter />);`,
    };
    const out = await installForApp({ files, app: APP, request: pendingInstall(files, APP), deps: { fetch, now: () => NOW, store: memoryStore() } });
    expect(out.notes[0]?.message).toBe("Installed hooky@1.0.0 from npm (esm.sh).");
    Object.assign(files, out.files);
    const inputs = Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p)));
    for (const modo of ["desarrollo", "produccion"] as const) {
      const bundle = await bundleApp({ carpeta: inputs, app: APP, modo });
      if (!bundle?.ok) throw new Error(JSON.stringify(bundle));
      const { text, errors } = await render(bundle.js);
      expect(errors.filter((e) => /Invalid hook call|more than one copy of React/i.test(e))).toEqual([]);
      expect(text).toBe("42");
      const released = ficherosDeLaApp(inputs, APP, bundle.js);
      expect(Object.keys(released)).not.toContain(PACKAGE_JSON_PATH);
      expect(Object.keys(released)).not.toContain(ESM_LOCK_PATH);
    }
  }, 120_000);
});
