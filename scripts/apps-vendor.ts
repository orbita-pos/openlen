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
import { build, type Plugin } from "esbuild";
import { parse } from "es-module-lexer/js";
import { CATALOGO_ACTUAL, catalogo, ficherosDelCatalogo, type ModoVendor } from "../lib/apps/dependencias";
import { EXPORTS_DEL_ENRUTADOR } from "../lib/apps/enrutador";
import { ICONOS_DE_LAS_APPS } from "../lib/apps/iconos";

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

/**
 * REACT, DESDE SUS FACHADAS. Lo que importa React dentro de otra librería del
 * catálogo (el router, los iconos) se deja fuera de su bundle y apunta a la
 * fachada vecina (`./react.js`): así sigue habiendo UNA copia de React, la de
 * `react-todo.js`. Relativo y no por su nombre, para no depender del import map.
 */
const reactDesdeLasFachadas: Plugin = {
  name: "react-desde-las-fachadas",
  setup(b) {
    const fachadas: Record<string, string> = {
      react: "./react.js",
      "react/jsx-runtime": "./react-jsx-runtime.js",
      "react-dom": "./react-dom.js",
      "react-dom/client": "./react-dom-client.js",
    };
    b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
      const fachada = fachadas[args.path];
      if (!fachada) throw new Error(`apps:vendor — "${args.path}" no tiene fachada en el catálogo`);
      return { path: fachada, external: true };
    });
  },
};

/**
 * LOS ICONOS CON SUS ALIAS. `lucide-react` exporta cada icono con varios
 * nombres (`CircleCheck`, `CheckCircle2`, `CircleCheckIcon`, `LucideCircleCheck`).
 * Se exportan todos menos los `Lucide*`, que nadie escribe: los modelos usan el
 * nombre viejo o el nuevo, con o sin `Icon`. Un alias más no añade un icono,
 * sólo un nombre que apunta al mismo.
 */
function iconosConSusAlias(): string[] {
  const barril = readFileSync(require.resolve("lucide-react/dist/esm/lucide-react.mjs"), "utf8");
  const aliasDe = new Map<string, string[]>();
  const ficheroDe = new Map<string, string>();
  for (const m of barril.matchAll(/export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g)) {
    const nombres = [...m[1]!.matchAll(/default as (\w+)/g)].map((n) => n[1]!);
    aliasDe.set(m[2]!, nombres);
    for (const n of nombres) ficheroDe.set(n, m[2]!);
  }
  const ficheros = new Set<string>();
  for (const icono of ICONOS_DE_LAS_APPS) {
    const f = ficheroDe.get(icono);
    if (!f) throw new Error(`apps:vendor — lucide-react no tiene el icono «${icono}» (lib/apps/iconos.ts)`);
    ficheros.add(f);
  }
  return [...ficheros].flatMap((f) => aliasDe.get(f)!.filter((n) => !n.startsWith("Lucide"))).sort();
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
    // D3 (2026-10-07): el router y los iconos, cada uno con SU lista cerrada.
    writeFileSync(path.join(fuentes, "react-router.js"), `export { ${EXPORTS_DEL_ENRUTADOR.join(", ")} } from "react-router";\n`);
    writeFileSync(path.join(fuentes, "lucide-react.js"), `export { ${iconosConSusAlias().join(", ")} } from "lucide-react";\n`);
    const conReactFuera = new Set(["react-router.js", "lucide-react.js"]);
    for (const nombre of ["react-todo.js", "supabase-js.js", "react-router.js", "lucide-react.js"]) {
      const opciones = { ...comun, entryPoints: [path.join(fuentes, nombre)], ...(conReactFuera.has(nombre) ? { plugins: [reactDesdeLasFachadas] } : {}) };
      // Dos pasadas: la primera dice qué paquetes entran; la segunda los nombra
      // en la cabecera. esbuild es determinista, así que la segunda es la misma
      // salida más el aviso.
      const r = await build({ ...opciones, write: false, outfile: path.join(destino, nombre) });
      // Lo que ESTÁ en la salida, no todo lo que esbuild leyó: el router lee
      // `cookie` y `set-cookie-parser` para su modo servidor, y el tree-shaking
      // los deja fuera. Sus licencias no van donde no va su código.
      const salida = Object.values(r.metafile!.outputs)[0]!;
      const lista = incluidos(Object.fromEntries(Object.entries(salida.inputs).filter(([, v]) => v.bytesInOutput > 0)));
      todos.push(...lista);
      await build({ ...opciones, outfile: path.join(destino, nombre), banner: { js: aviso(lista) } });
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

/**
 * LO QUE EXPORTA CADA FICHERO, para que el compilador diga en el acto que
 * `import { Cafe } from "lucide-react"` no existe, en vez de que la app se
 * quede en blanco en el navegador. Se lee de los bytes ya construidos con el
 * mismo analizador que usa el compilador, así que no puede discrepar de ellos.
 * Es igual en los dos modos: se lee el de producción.
 */
const RUTA_EXPORTACIONES = path.join(RAIZ, "lib", "apps", "exportaciones.json");

function exportacionesDe(dir: string, ficheros: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(
    ficheros.map((f) => {
      const [, exps] = parse(readFileSync(path.join(dir, f), "utf8"));
      const nombres = exps.flatMap((e) => ("name" in e ? [e.name] : []));
      // Un `export * from` no dice sus nombres: la lista quedaría corta y el
      // compilador rechazaría imports buenos. Un bundle no debería tenerlo.
      if (nombres.length !== exps.length) throw new Error(`apps:vendor — ${f} tiene un «export *»: no se pueden listar sus nombres`);
      return [f, [...new Set(nombres)].sort()];
    }),
  );
}

/** El JSON de todos los catálogos, con éste al día. Estable: claves ordenadas. */
function textoDeExportaciones(nombre: string, deEste: Record<string, string[]>): string {
  const todas = existsSync(RUTA_EXPORTACIONES)
    ? (JSON.parse(readFileSync(RUTA_EXPORTACIONES, "utf8")) as Record<string, Record<string, string[]>>)
    : {};
  todas[nombre] = Object.fromEntries(Object.entries(deEste).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(Object.fromEntries(Object.entries(todas).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n";
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
        // Lo mismo con lo que exporta cada fichero: sale de los bytes guardados.
        const exportaciones = textoDeExportaciones(nombre, exportacionesDe(path.join(guardado, "produccion"), ficherosDelCatalogo(nombre)));
        const exportacionesAlDia = existsSync(RUTA_EXPORTACIONES) && readFileSync(RUTA_EXPORTACIONES, "utf8") === exportaciones;
        if (soloComprobar && !exportacionesAlDia) throw new Error(`lib/apps/exportaciones.json no está al día con el catálogo ${nombre} (npm run apps:vendor)`);
        if (!exportacionesAlDia) writeFileSync(RUTA_EXPORTACIONES, exportaciones);
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
      RUTA_EXPORTACIONES,
      textoDeExportaciones(nombre, exportacionesDe(path.join(guardado, "produccion"), ficherosDelCatalogo(nombre))),
    );
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
