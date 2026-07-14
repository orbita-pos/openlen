import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformTemplateCached } from "./template-cache";
import type { RunPage } from "./bake";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;
const PAGE = doc(`<div id="g"></div><script>document.getElementById("g").innerHTML="x";</script>`);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ol-tpl-cache-"));
  vi.stubEnv("OPENLEN_TRANSFORM_CACHE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("transformTemplateCached — una vez por versión de plantilla", () => {
  it("primer clon transforma (Chrome corre); el segundo sale del cache sin tocar Chrome", async () => {
    const spy = vi.fn<RunPage>(async () => ({ containers: { "0": "<b>vivo</b>" }, geoms: {} }));
    const first = await transformTemplateCached("mirror", PAGE, { runPage: spy });
    expect(first).toContain("<b>vivo</b>");
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await transformTemplateCached("mirror", PAGE, { runPage: spy });
    expect(second).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("html distinto (nueva versión) = clave distinta → re-transforma", async () => {
    const spy = vi.fn<RunPage>(async () => ({ containers: { "0": "<b>v</b>" }, geoms: {} }));
    await transformTemplateCached("mirror", PAGE, { runPage: spy });
    await transformTemplateCached("mirror", PAGE.replace("</body>", "<p>v2</p></body>"), { runPage: spy });
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("un fallback (Chrome truena) NO se cachea — el siguiente clon reintenta", async () => {
    const boom = vi.fn<RunPage>(async () => {
      throw new Error("x");
    });
    const out = await transformTemplateCached("mirror", PAGE, { runPage: boom });
    expect(out).toBe(PAGE);
    const ok = vi.fn<RunPage>(async () => ({ containers: { "0": "<b>v</b>" }, geoms: {} }));
    const second = await transformTemplateCached("mirror", PAGE, { runPage: ok });
    expect(second).toContain("<b>v</b>");
  });
});
