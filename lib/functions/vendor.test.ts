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

import { FUNCTIONS_CATALOG_CURRENT, FUNCTIONS_CATALOGS, functionsCatalog } from "./catalog";

const DIR = path.join(process.cwd(), "lib", "functions", "vendor", FUNCTIONS_CATALOG_CURRENT);
const manifest = JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8")) as { catalog: string; files: Record<string, string> };

/** Las exportaciones de un fichero, preguntadas a un Node aparte. */
function exportsOf(file: string): string[] {
  const url = pathToFileURL(path.join(DIR, file)).href;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(Object.keys(m)))`], { encoding: "utf8" });
  return JSON.parse(out.trim()) as string[];
}

describe(`el catálogo ${FUNCTIONS_CATALOG_CURRENT} de las Edge Functions`, () => {
  it("cada fichero del manifiesto existe y es el que dice, en TODOS los catálogos (congelados)", () => {
    expect(manifest.catalog).toBe(FUNCTIONS_CATALOG_CURRENT);
    for (const catalogo of Object.keys(FUNCTIONS_CATALOGS)) {
      const dir = path.join(process.cwd(), "lib", "functions", "vendor", catalogo);
      const m = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { catalog: string; files: Record<string, string> };
      expect(m.catalog).toBe(catalogo);
      for (const [f, sha] of Object.entries(m.files)) {
        expect(createHash("sha256").update(readFileSync(path.join(dir, f), "utf8")).digest("hex"), `${catalogo}/${f}`).toBe(sha);
      }
    }
  });

  it("2026-12 is 2026-11 plus React Email, the old entries untouched, and it is the current one", () => {
    expect(FUNCTIONS_CATALOG_CURRENT).toBe("2026-12");
    const viejo = functionsCatalog("2026-11")!.dependencies;
    const nuevo = functionsCatalog("2026-12")!.dependencies;
    for (const d of viejo) expect(nuevo).toContainEqual(d);
    expect(nuevo.map((d) => d.name)).toEqual(expect.arrayContaining(["react", "react-dom", "react-email", "@react-email/render"]));
  });

  it("React Email, loaded by Node: one React for the templates, render and hooks", { timeout: 60_000 }, () => {
    expect(exportsOf("react.mjs")).toEqual(expect.arrayContaining(["createElement", "useState", "default"]));
    expect(exportsOf("react-email.mjs")).toEqual(expect.arrayContaining(["Html", "Button", "Text", "render"]));
    expect(exportsOf("react-email-render.mjs")).toContain("render");
    expect(exportsOf("react-dom-server.mjs")).toContain("renderToStaticMarkup");
    const url = (f: string) => JSON.stringify(pathToFileURL(path.join(DIR, f)).href);
    const script = [
      `const React = (await import(${url("react.mjs")})).default;`,
      `const { Html, Button, render } = await import(${url("react-email.mjs")});`,
      // A hook in the template: it only works if render's React is the template's.
      "function Hola() { const [n] = React.useState(3); return React.createElement(Html, null, React.createElement(Button, { href: 'https://taller.mx/menu' }, 'Ver ' + n)); }",
      "console.log(JSON.stringify(await render(React.createElement(Hola))));",
    ].join("\n");
    const html = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim()) as string;
    expect(html).toContain('href="https://taller.mx/menu"');
    expect(html).toContain("Ver 3");
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
