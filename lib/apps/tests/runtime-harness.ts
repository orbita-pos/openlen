// lib/apps/tests/runtime-harness.ts — SÓLO PARA LAS PRUEBAS del runtime
// (plan 04): una prueba ya compilada + `vitest-runtime.js` + el kit, con el
// esbuild de Node del repo, en un Chromium. El camino de verdad es
// `bundle-tests.ts` (esbuild-wasm en su hilo) + `run-tests.ts`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "esbuild";
import puppeteer from "puppeteer";
import { catalogo } from "@/lib/apps/dependencias";
import { directorioVendor } from "@/lib/apps/servir";
import { EMPTY_TEST_SPECIFIERS, TEST_KIT, TEST_KIT_NAME } from "./test-kit";

const RUNTIME = path.join(process.cwd(), "lib", "apps", "tests", "vitest-runtime.js");

export async function runInChromium(modules: Readonly<Record<string, string>>, file: string, catalogoDeLaApp = "2026-11") {
  const vendor = path.join(directorioVendor(), catalogoDeLaApp, "desarrollo");
  const kit = path.join(directorioVendor(), TEST_KIT_NAME, "desarrollo");
  const porNombre = new Map<string, string>([
    ...catalogo(catalogoDeLaApp)!.dependencias.map((d) => [d.especificador, path.join(vendor, d.fichero)] as const),
    ...TEST_KIT.dependencias.map((d) => [d.especificador, path.join(kit, d.fichero)] as const),
  ]);
  const plugin: Plugin = {
    name: "harness",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.path === "vitest") return { path: RUNTIME };
        if (EMPTY_TEST_SPECIFIERS.includes(a.path)) return { path: a.path, namespace: "empty" };
        if (porNombre.has(a.path)) return { path: porNombre.get(a.path)! };
        if (Object.hasOwn(modules, a.path)) return { path: a.path, namespace: "app" };
        return undefined;
      });
      b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "" }));
      b.onLoad({ filter: /.*/, namespace: "app" }, (a) => ({ contents: modules[a.path], loader: "js", resolveDir: process.cwd() }));
    },
  };
  const entrada = `import { __runFile, __fileFailed } from "vitest";\ntry { await import(${JSON.stringify(file)}); await __runFile(${JSON.stringify(file)}); } catch (e) { __fileFailed(${JSON.stringify(file)}, e); }`;
  const r = await build({
    stdin: { contents: entrada, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    plugins: [plugin],
    logLevel: "error",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head><meta charset=utf-8></head><body></body></html>");
    await page.addScriptTag({ content: r.outputFiles[0]!.text, type: "module" });
    await page.waitForFunction(() => "__openlenTestResult" in globalThis, { timeout: 20_000 });
    return await page.evaluate(() => (globalThis as unknown as { __openlenTestResult: unknown }).__openlenTestResult);
  } finally {
    await browser.close();
  }
}

/** El runtime, leído del disco: lo que `bundle-tests.ts` mete como módulo `vitest`. */
export const runtimeSource = () => readFileSync(RUNTIME, "utf8");
