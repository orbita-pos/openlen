// scripts/apps-vendor.ts — construye UNA VEZ las dependencias de un catálogo de
// las apps web (lib/apps/dependencias.ts) y las deja en
// public/app-vendor/<catálogo>/<modo>/, que es de donde las sirven el lienzo,
// los ojos de Len y la publicación.
//
//   npm run apps:vendor                 → construye el catálogo actual
//   npm run apps:vendor -- --comprobar  → sólo comprueba que lo guardado es lo
//                                          que saldría (no escribe nada)
//
// 🔴 CONGELADO. Si el catálogo ya existe y lo construido no es byte a byte lo
// guardado, NO SE ESCRIBE: las apps publicadas lo cachean como inmutable.
// Versión nueva = catálogo nuevo (añádelo en dependencias.ts).
//
// POR QUÉ UN SOLO BUNDLE DE REACT. React, ReactDOM y el runtime de JSX van en
// `react-todo.js`, y lo que nombra el import map son FACHADAS que lo
// reexportan. Así hay una sola copia de React: con dos, los hooks fallan
// («Invalid hook call»). Medido el 2026-10-07 en Chromium (spec §6).
//
// POR QUÉ LAS FACHADAS NOMBRAN CADA EXPORTACIÓN. React es CommonJS: un
// `export * from "react"` sobre CJS no exporta nada con nombre en ESM. Los
// nombres se leen del propio paquete al construir.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { CATALOGO_ACTUAL, catalogo, ficherosDelCatalogo, type ModoVendor } from "../lib/apps/dependencias";

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(import.meta.dirname, "..");
const MODOS: readonly ModoVendor[] = ["desarrollo", "produccion"];

function versionInstalada(paquete: string): string {
  return (require(`${paquete}/package.json`) as { version: string }).version;
}

/** Los nombres que exporta un módulo CJS, válidos como identificador. */
function nombres(modulo: string): string[] {
  return Object.keys(require(modulo) as object)
    .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default")
    .sort();
}

function fachada(ns: string, modulo: string, conDefault: boolean): string {
  return (
    `import { ${ns} } from "./react-todo.js";\n` +
    (conDefault ? `export default ${ns};\n` : "") +
    `export const { ${nombres(modulo).join(", ")} } = ${ns};\n`
  );
}

/** Un paquete de npm que acabó dentro de un bundle. */
interface Incluido {
  readonly nombre: string;
  readonly version: string;
  readonly licencia: string;
  readonly dir: string;
}

/**
 * LOS PAQUETES QUE METIÓ ESBUILD, leídos de su metafile. Hacen falta para
 * cumplir sus licencias: estos ficheros se DISTRIBUYEN en la página de cada
 * visitante, y la MIT pide llevar el aviso con cada copia. React ya trae sus
 * `@license` en el código; supabase-js y sus dependencias no traen ninguno.
 */
function incluidos(inputs: Readonly<Record<string, unknown>>): Incluido[] {
  const dirs = new Set<string>();
  for (const entrada of Object.keys(inputs)) {
    const m = /^(.*?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(entrada.replaceAll("\\", "/"));
    if (m) dirs.add(path.resolve(RAIZ, m[1]!));
  }
  return [...dirs]
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string; version: string; license?: string };
      return { nombre: pkg.name, version: pkg.version, licencia: pkg.license ?? "desconocida", dir };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function textoDeLicencia(dir: string): string | null {
  for (const f of ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"]) {
    // A LF: algunos paquetes traen su licencia con CRLF, y la salida tiene que
    // ser la misma en cualquier máquina.
    if (existsSync(path.join(dir, f))) return readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n").trim();
  }
  return null;
}

async function construir(modo: ModoVendor, destino: string): Promise<Incluido[]> {
  mkdirSync(destino, { recursive: true });
  const fuentes = path.join(tmpdir(), `openlen-apps-vendor-${process.pid}`);
  mkdirSync(fuentes, { recursive: true });
  const comun = {
    bundle: true,
    format: "esm" as const,
    minify: true,
    legalComments: "inline" as const,
    target: "es2022",
    logLevel: "error" as const,
    metafile: true,
    define: { "process.env.NODE_ENV": JSON.stringify(modo === "produccion" ? "production" : "development") },
    nodePaths: [path.join(RAIZ, "node_modules")],
  };
  /** El aviso que abre cada bundle: qué lleva y dónde están las licencias. */
  const aviso = (lista: Incluido[]) =>
    `/*! ${lista.map((p) => `${p.nombre}@${p.version} (${p.licencia})`).join(", ")} — licencias completas en LICENCIAS.txt */`;
  const todos: Incluido[] = [];
  try {
    writeFileSync(
      path.join(fuentes, "react-todo.js"),
      'import * as React from "react";\n' +
        'import * as ReactDOM from "react-dom";\n' +
        'import * as ReactDOMClient from "react-dom/client";\n' +
        'import * as JSXRuntime from "react/jsx-runtime";\n' +
        "export { React, ReactDOM, ReactDOMClient, JSXRuntime };\n",
    );
    writeFileSync(path.join(fuentes, "supabase-js.js"), 'export * from "@supabase/supabase-js";\n');
    for (const nombre of ["react-todo.js", "supabase-js.js"]) {
      // Dos pasadas: la primera dice qué paquetes entran; la segunda los nombra
      // en la cabecera. esbuild es determinista, así que la segunda es la misma
      // salida más el aviso.
      const r = await build({ ...comun, entryPoints: [path.join(fuentes, nombre)], write: false, outfile: path.join(destino, nombre) });
      const lista = incluidos(r.metafile!.inputs);
      todos.push(...lista);
      await build({ ...comun, entryPoints: [path.join(fuentes, nombre)], outfile: path.join(destino, nombre), banner: { js: aviso(lista) } });
    }
    writeFileSync(path.join(destino, "react.js"), fachada("React", "react", true));
    writeFileSync(path.join(destino, "react-jsx-runtime.js"), fachada("JSXRuntime", "react/jsx-runtime", false));
    writeFileSync(path.join(destino, "react-dom.js"), fachada("ReactDOM", "react-dom", false));
    writeFileSync(path.join(destino, "react-dom-client.js"), fachada("ReactDOMClient", "react-dom/client", false));
  } finally {
    rmSync(fuentes, { recursive: true, force: true });
  }
  return todos;
}

function licencias(lista: readonly Incluido[]): string {
  const unicos = [...new Map(lista.map((p) => [`${p.nombre}@${p.version}`, p])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  return (
    unicos
      .map((p) => {
        const texto = textoDeLicencia(p.dir);
        if (!texto) throw new Error(`${p.nombre}@${p.version} no trae fichero de licencia: no se distribuye sin él.`);
        return `${p.nombre}@${p.version} — ${p.licencia}\n${"=".repeat(60)}\n${texto}\n`;
      })
      .join("\n") + "\n"
  );
}

function huella(fichero: string): string {
  return `sha256-${createHash("sha256").update(readFileSync(fichero)).digest("base64")}`;
}

async function main(): Promise<void> {
  const soloComprobar = process.argv.includes("--comprobar");
  const nombre = CATALOGO_ACTUAL;
  const c = catalogo(nombre);
  if (!c) throw new Error(`el catálogo ${nombre} no existe en lib/apps/dependencias.ts`);

  for (const [paquete, version] of Object.entries(c.versiones)) {
    const instalada = versionInstalada(paquete);
    if (instalada !== version) {
      throw new Error(`${paquete}: el catálogo ${nombre} dice ${version} y está instalada ${instalada}. No se construye con otra versión.`);
    }
  }

  const guardado = path.join(RAIZ, "public", "app-vendor", nombre);
  const nuevo = path.join(tmpdir(), `openlen-apps-vendor-salida-${process.pid}`);
  rmSync(nuevo, { recursive: true, force: true });
  try {
    const manifiesto: Record<string, Record<string, string>> = {};
    const paquetes: Incluido[] = [];
    for (const modo of MODOS) {
      paquetes.push(...(await construir(modo, path.join(nuevo, modo))));
      manifiesto[modo] = Object.fromEntries(ficherosDelCatalogo(nombre).map((f) => [f, huella(path.join(nuevo, modo, f))]));
    }
    const textoLicencias = licencias(paquetes);

    const rutaManifiesto = path.join(guardado, "manifest.json");
    if (existsSync(rutaManifiesto)) {
      const antes = JSON.parse(readFileSync(rutaManifiesto, "utf8")) as { ficheros: Record<string, Record<string, string>> };
      const distintos = MODOS.flatMap((modo) =>
        Object.entries(antes.ficheros[modo] ?? {})
          .filter(([f, h]) => manifiesto[modo]![f] !== h)
          .map(([f]) => `${modo}/${f}`),
      );
      if (distintos.length > 0) {
        throw new Error(
          `🔴 el catálogo ${nombre} ya está publicado y estos ficheros saldrían DISTINTOS: ${distintos.join(", ")}. ` +
            "Un catálogo no cambia de bytes: crea uno nuevo en lib/apps/dependencias.ts.",
        );
      }
      const faltan = MODOS.flatMap((modo) => ficherosDelCatalogo(nombre).filter((f) => !existsSync(path.join(guardado, modo, f))).map((f) => `${modo}/${f}`));
      if (faltan.length === 0) {
        // Las licencias no son código servido ni van en el manifiesto: se dejan
        // al día también cuando el catálogo ya está (salvo al sólo comprobar).
        const rutaLicencias = path.join(guardado, "LICENCIAS.txt");
        const licenciasAlDia = existsSync(rutaLicencias) && readFileSync(rutaLicencias, "utf8") === textoLicencias;
        if (soloComprobar && !licenciasAlDia) throw new Error(`LICENCIAS.txt del catálogo ${nombre} no está al día (npm run apps:vendor)`);
        if (!licenciasAlDia) writeFileSync(rutaLicencias, textoLicencias);
        console.log(`apps:vendor — ${nombre} ya está construido y coincide byte a byte.`);
        return;
      }
      if (soloComprobar) throw new Error(`faltan ficheros del catálogo ${nombre}: ${faltan.join(", ")}`);
    } else if (soloComprobar) {
      throw new Error(`el catálogo ${nombre} no está construido (npm run apps:vendor)`);
    }
    if (soloComprobar) return;

    for (const modo of MODOS) {
      mkdirSync(path.join(guardado, modo), { recursive: true });
      for (const f of ficherosDelCatalogo(nombre)) {
        const destino = path.join(guardado, modo, f);
        if (!existsSync(destino)) writeFileSync(destino, readFileSync(path.join(nuevo, modo, f)));
      }
    }
    writeFileSync(path.join(guardado, "LICENCIAS.txt"), textoLicencias);
    writeFileSync(
      rutaManifiesto,
      JSON.stringify(
        {
          catalogo: nombre,
          versiones: c.versiones,
          esbuild: versionInstalada("esbuild"),
          ficheros: manifiesto,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`apps:vendor — ${nombre} construido en public/app-vendor/${nombre}/.`);
  } finally {
    rmSync(nuevo, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
