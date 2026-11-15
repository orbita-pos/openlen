// lib/len-bench/casos/clientes/rendered.ts — A CUSTOMER'S PAGE AS A VISITOR SEES IT, for the calibration sheet.
//
// In a run the judge reads the published page painted in Chromium (graders.ts `textoPintadoDelSitio`). The sheet it is
// calibrated on (judge-sheet.ts) and the calibration's questions (calibration.ts) must show the same thing, so each
// page of the final state is painted here too: what its own script builds counts, the «Cargando…» it replaces
// does not. Same browser as the bench (`lanzarNavegador`) and the same guard against private addresses.
import type { Browser } from "puppeteer";

import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { cerrarPestana } from "../../navegador";
import type { DatosDelCaso } from "../../tipos";

async function paint(navegador: Browser, html: string): Promise<string> {
  if (html.trim() === "") return "";
  const page = await navegador.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await installSubresourceSsrfGuard(page, { allowOrigins: [] });
    // A run opens the served page with `networkidle2` (graders.ts `abrir`); `setContent` only waits for `load`, so the
    // idle network is waited for apart: a script that builds the page from a CDN has finished, as in a run.
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 500, concurrency: 2, timeout: 30_000 });
    return await page.evaluate(() => document.body?.innerText ?? "");
  } finally {
    await cerrarPestana(page);
  }
}

/** The visible text of every page of a state, painted, home first. */
export async function renderedText(navegador: Browser, d: DatosDelCaso): Promise<string> {
  const parts = [await paint(navegador, d.html ?? "")];
  for (const p of Object.values(d.pages ?? {})) parts.push(await paint(navegador, p.html));
  return parts.join("\n");
}
