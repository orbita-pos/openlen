// @vitest-environment node
//
// EL CATÁLOGO CONGELADO DE LAS FUNCIONES (lib/functions/vendor/<catálogo>/):
// cada fichero es el del manifiesto, y cada uno, cargado por Node de verdad
// (no por vite), exporta lo que los ejemplos de Supabase importan.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { FUNCTIONS_CATALOG_CURRENT, functionsCatalog } from "./catalog";

const DIR = path.join(process.cwd(), "lib", "functions", "vendor", FUNCTIONS_CATALOG_CURRENT);
const manifest = JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8")) as { catalog: string; files: Record<string, string> };

/** Las exportaciones de un fichero, preguntadas a un Node aparte. */
function exportsOf(file: string): string[] {
  const url = pathToFileURL(path.join(DIR, file)).href;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(Object.keys(m)))`], { encoding: "utf8" });
  return JSON.parse(out.trim()) as string[];
}

describe(`el catálogo ${FUNCTIONS_CATALOG_CURRENT} de las Edge Functions`, () => {
  it("cada fichero del manifiesto existe y es el que dice", () => {
    expect(manifest.catalog).toBe(FUNCTIONS_CATALOG_CURRENT);
    for (const [f, sha] of Object.entries(manifest.files)) {
      expect(createHash("sha256").update(readFileSync(path.join(DIR, f), "utf8")).digest("hex"), f).toBe(sha);
    }
  });

  it("cada dependencia del catálogo tiene su fichero en el manifiesto", () => {
    for (const d of functionsCatalog(FUNCTIONS_CATALOG_CURRENT)!.dependencies) expect(manifest.files, d.name).toHaveProperty(d.file);
  });

  it("cargados por Node, exportan lo de los ejemplos de Supabase", { timeout: 60_000 }, () => {
    expect(exportsOf("supabase-js.mjs")).toContain("createClient");
    expect(exportsOf("stripe.mjs")).toContain("default");
    expect(exportsOf("resend.mjs")).toContain("Resend");
    expect(exportsOf("openai.mjs")).toContain("default");
    expect(exportsOf("mercadopago.mjs")).toEqual(expect.arrayContaining(["MercadoPagoConfig", "Preference", "Payment"]));
    expect(exportsOf("zod.mjs")).toContain("z");
  });
});
