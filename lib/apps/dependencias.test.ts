// @vitest-environment node
// El catálogo de las apps web y lo construido en public/app-vendor/: que lo que
// el import map nombra EXISTE en los dos modos, y que nadie cambió sus bytes.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "es-module-lexer/js";
import EXPORTACIONES from "./exportaciones.json";
import { EXPORTS_DEL_ENRUTADOR } from "./enrutador";
import { ICONOS_DEL_EDITOR, ICONOS_DE_LAS_APPS } from "./iconos";
import {
  CATALOGOS,
  CATALOGO_ACTUAL,
  dependenciaDe,
  ficherosDelCatalogo,
  importMapDe,
  rutaDeVendor,
  rutaDeVendorValida,
} from "./dependencias";

const RAIZ = join(import.meta.dirname, "..", "..");

describe("el catálogo", () => {
  it("el actual existe y nombra React, su runtime de JSX, ReactDOM y supabase-js", () => {
    const imports = importMapDe(CATALOGO_ACTUAL).imports;
    expect(Object.keys(imports).sort()).toEqual(
      [
        "@supabase/supabase-js",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        // D3 (2026-10-07): el router, con sus dos nombres, y los iconos.
        "react-router",
        "react-router-dom",
        "lucide-react",
      ].sort(),
    );
    for (const ruta of Object.values(imports)) expect(ruta.startsWith(`/openlen/vendor/${CATALOGO_ACTUAL}/`)).toBe(true);
  });

  it("react-router y react-router-dom son el MISMO fichero: un solo módulo en el navegador", () => {
    const imports = importMapDe(CATALOGO_ACTUAL).imports;
    expect(imports["react-router-dom"]).toBe(imports["react-router"]);
    expect(ficherosDelCatalogo(CATALOGO_ACTUAL).filter((f) => f === "react-router.js")).toHaveLength(1);
  });

  it("dependenciaDe: lo que está, y lo que no (ni un catálogo inventado)", () => {
    expect(dependenciaDe(CATALOGO_ACTUAL, "react")?.fichero).toBe("react.js");
    expect(dependenciaDe(CATALOGO_ACTUAL, "axios")).toBeNull();
    expect(dependenciaDe("1999-01", "react")).toBeNull();
    expect(importMapDe("1999-01")).toEqual({ imports: {} });
  });

  it("rutaDeVendorValida sólo acepta ficheros REALES de un catálogo que existe", () => {
    expect(rutaDeVendorValida(rutaDeVendor(CATALOGO_ACTUAL, "react.js"))).toEqual({ catalogo: CATALOGO_ACTUAL, fichero: "react.js" });
    expect(rutaDeVendorValida(rutaDeVendor(CATALOGO_ACTUAL, "react-todo.js"))?.fichero).toBe("react-todo.js");
    for (const mala of [
      `/openlen/vendor/${CATALOGO_ACTUAL}/axios.js`,
      "/openlen/vendor/1999-01/react.js",
      `/openlen/vendor/${CATALOGO_ACTUAL}/../../etc/passwd`,
      `/openlen/vendor/${CATALOGO_ACTUAL}/react.js?x=1`,
      `/openlen/vendor/${CATALOGO_ACTUAL}/`,
      "/js/react.js",
    ]) {
      expect(rutaDeVendorValida(mala), mala).toBeNull();
    }
  });
});

describe("lo construido (npm run apps:vendor)", () => {
  for (const nombre of Object.keys(CATALOGOS)) {
    const dir = join(RAIZ, "public", "app-vendor", nombre);
    const manifiesto = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      versiones: Record<string, string>;
      ficheros: Record<string, Record<string, string>>;
    };

    it(`${nombre}: cada fichero existe en los dos modos y coincide con su manifiesto`, () => {
      for (const modo of ["desarrollo", "produccion"]) {
        for (const f of ficherosDelCatalogo(nombre)) {
          const ruta = join(dir, modo, f);
          expect(existsSync(ruta), `${modo}/${f}`).toBe(true);
          const huella = `sha256-${createHash("sha256").update(readFileSync(ruta)).digest("base64")}`;
          expect(huella, `🔴 ${modo}/${f} cambió de bytes: un catálogo no cambia`).toBe(manifiesto.ficheros[modo]?.[f]);
        }
      }
    });

    it(`${nombre}: el manifiesto dice las mismas versiones que el catálogo`, () => {
      expect(manifiesto.versiones).toEqual(CATALOGOS[nombre]!.versiones);
    });

    it(`${nombre}: las licencias van con él`, () => {
      const texto = readFileSync(join(dir, "LICENCIAS.txt"), "utf8");
      for (const paquete of Object.keys(CATALOGOS[nombre]!.versiones)) expect(texto).toContain(`${paquete}@`);
    });

    it(`${nombre}: las fachadas importan el bundle compartido (una sola copia de React)`, () => {
      for (const f of ["react.js", "react-dom.js", "react-dom-client.js", "react-jsx-runtime.js"]) {
        expect(readFileSync(join(dir, "produccion", f), "utf8")).toMatch(/from "\.\/react-todo\.js"/);
      }
      expect(readFileSync(join(dir, "produccion", "react.js"), "utf8")).toMatch(/\buseState\b/);
    });

    it(`${nombre}: lo que exporta cada fichero es lo que dice exportaciones.json (de ahí lee el compilador)`, () => {
      const delCatalogo = (EXPORTACIONES as Record<string, Record<string, string[]>>)[nombre];
      expect(delCatalogo, "npm run apps:vendor").toBeDefined();
      for (const f of ficherosDelCatalogo(nombre)) {
        const [, exps] = parse(readFileSync(join(dir, "produccion", f), "utf8"));
        const nombres = exps.flatMap((e) => ("name" in e ? [e.name] : []));
        expect(nombres.length, `${f}: un «export *» dejaría la lista incompleta`).toBe(exps.length);
        expect(delCatalogo![f], f).toEqual([...new Set(nombres)].sort());
      }
    });

    it(`${nombre}: lo que no es React importa React de su fachada, nunca otra copia`, () => {
      for (const f of ficherosDelCatalogo(nombre)) {
        const [imps] = parse(readFileSync(join(dir, "produccion", f), "utf8"));
        for (const i of imps) {
          // `import.meta` y un `import(variable)` no traen nada: el router los
          // lleva en código de su modo framework que una app no llama.
          const especificador = "specifier" in i ? i.specifier : undefined;
          if (typeof especificador !== "string") continue;
          expect(["./react-todo.js", "./react.js", "./react-dom.js", "./react-jsx-runtime.js", "./react-dom-client.js"], `${f} importa ${especificador}`).toContain(especificador);
        }
      }
    });
  }
});

describe("el router y los iconos del catálogo 2026-10 (D3)", () => {
  const exportan = (EXPORTACIONES as Record<string, Record<string, string[]>>)["2026-10"]!;

  it("el router exporta su lista, y BrowserRouter no", () => {
    expect([...EXPORTS_DEL_ENRUTADOR].sort()).toEqual(exportan["react-router.js"]);
    expect(exportan["react-router.js"]).not.toContain("BrowserRouter");
    expect(exportan["react-router.js"]).not.toContain("createBrowserRouter");
  });

  it("los iconos del editor siguen siendo los que importa lib/lucide-curated.ts, y están todos", () => {
    const fuente = readFileSync(join(RAIZ, "lib", "lucide-curated.ts"), "utf8");
    const lista = /import \{([\s\S]*?)\} from "lucide-react"/.exec(fuente)![1]!;
    const delEditor = lista
      .split(",")
      .map((x) => x.trim().split(/\s+as\s+/)[0]!)
      .filter((x) => x && x !== "type");
    expect([...ICONOS_DEL_EDITOR].sort()).toEqual(delEditor.sort());
    for (const icono of ICONOS_DE_LAS_APPS) expect(exportan["lucide-react.js"], icono).toContain(icono);
  });
});
