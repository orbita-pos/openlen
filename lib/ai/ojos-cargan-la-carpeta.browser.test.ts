// @vitest-environment node
//
// LOS OJOS DE LEN CARGAN LA CARPETA (pieza 9 de Len 2.5), en un Chromium de
// verdad: una página con `<script src="/js/app.js">` y `fetch("data/menu.json")`
// se mide como funcionaría publicada, y sin service workers.
//
// Montaje: el mismo que los ojos — el origen de medida, el guardia SSRF con su
// hueco exacto, y `cargarEnOrigenReal`.
import { describe, expect, it } from "vitest";
import { cargarEnOrigenReal, origenDeMedida } from "./origen-de-medida";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

const PAGINA = `<!doctype html><html><head><title>antes</title></head><body>
<p id="menu">sin menú</p>
<script type="module" src="/js/app.js"></script>
<script>
  window.__sw = "serviceWorker" in navigator ? "con" : "sin";
</script>
</body></html>`;

const APP = `import { platos } from "./platos.mjs";
document.title = "cargó";
const r = await fetch("data/menu.json");
document.getElementById("menu").textContent = platos((await r.json()).length);`;

async function medir(files: Record<string, string> | undefined): Promise<{ title: string; menu: string; sw: string }> {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    const { origin } = await origenDeMedida();
    await installSubresourceSsrfGuard(page, { allowOrigins: [origin] });
    await cargarEnOrigenReal(page, PAGINA, files ? { files } : {});
    await page.waitForFunction(() => document.getElementById("menu")?.textContent !== "sin menú", { timeout: 3000 }).catch(() => undefined);
    return (await page.evaluate(() => ({
      title: document.title,
      menu: document.getElementById("menu")?.textContent ?? "",
      sw: String((window as unknown as { __sw: string }).__sw),
    }))) as { title: string; menu: string; sw: string };
  } finally {
    await browser.close();
  }
}

describe("🔴 los ojos de Len cargan la carpeta", () => {
  it("el módulo, su import y el JSON relativo llegan; sin service workers", async () => {
    const r = await medir({
      "/js/app.js": APP,
      "/js/platos.mjs": "export const platos = (n) => `${n} platos`;",
      "/data/menu.json": '[{"p":"sopa"},{"p":"caldo"}]',
      "/tests/a.spec.ts": "no se sirve",
    });
    expect(r).toEqual({ title: "cargó", menu: "2 platos", sw: "sin" });
  }, 30_000);

  it("BRAZO DE CONTROL: sin la carpeta, el script no llega y la página se queda como estaba", async () => {
    const r = await medir(undefined);
    expect(r.title).toBe("antes");
    expect(r.menu).toBe("sin menú");
  }, 30_000);
});
