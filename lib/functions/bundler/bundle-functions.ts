// lib/functions/bundler/bundle-functions.ts — LAS FUNCIONES DE UN PROYECTO, EN
// UN PAQUETE (spec local 2026-10-11, Parte 2): todas en un zip con el
// envoltorio y un enrutador por nombre; cada función se carga la primera vez.
// El mismo paquete sirve a los dos motores: `index.mjs` (el local) y `worker.mjs` (Cloudflare).
// El hilo es el de las apps (`runOnBundlerThread`); aquí se arma el mensaje y
// se traducen sus errores y avisos a diagnósticos con fichero y línea, que es
// lo que Len lee en `<new-diagnostics>`. Caché por contenido.

import { createHash } from "node:crypto";
import path from "node:path";

import type { Diagnostico, Gravedad } from "@/lib/agent/diagnosticos";
import { runOnBundlerThread, stripNamespaces } from "@/lib/apps/bundler/bundle-app";

import { functionsCatalog } from "../catalog";
import { WORKER_MAIN_MODULE } from "../engines/cloudflare-api";
import { readFunctionsLayout, type FunctionSpec } from "../project-files";
import { bundleHash } from "./bundle-hash";

export type FunctionsBundleMode = "development" | "production";

export type FunctionsBundle =
  | {
      readonly ok: true;
      readonly hash: string;
      readonly files: Readonly<Record<string, string>>;
      readonly maps: Readonly<Record<string, string>>;
      readonly functions: readonly FunctionSpec[];
      readonly warnings: readonly Diagnostico[];
    }
  | { readonly ok: false; readonly errors: readonly Diagnostico[]; readonly warnings: readonly Diagnostico[] };

interface ThreadMessage {
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly text: string;
}

interface ThreadOutput {
  readonly outputs: Readonly<Record<string, string>>;
  readonly errors: readonly ThreadMessage[];
  readonly warnings: readonly ThreadMessage[];
  readonly ms: number;
}

const TOPE_MS = 30_000;
const CACHE_MAX = 20;
const FUENTE = /\.(?:ts|tsx|js|jsx|mjs|json)$/;
const hechos = new Map<string, FunctionsBundle>();
const enCamino = new Map<string, Promise<FunctionsBundle | null>>();

const VACIO: FunctionsBundle = { ok: true, hash: "empty", files: {}, maps: {}, functions: [], warnings: [] };

export function entrySource(functions: readonly FunctionSpec[]): string {
  const loaders = functions.map((f) => `  ${JSON.stringify(f.name)}: () => import(${JSON.stringify(f.entry)}),`).join("\n");
  return (
    'import { createHandler, installGlobals } from "openlen:runtime";\n' +
    "installGlobals();\n" +
    `export const invoke = createHandler({\n${loaders}\n});\n`
  );
}

/** La entrada de Cloudflare (spec local 2026-10-12, Parte 2): el evento entra
 *  como JSON y los marcos salen según los escribe el envoltorio (NDJSON). */
export const WORKER_ENTRY = String.raw`// La entrada de Cloudflare: el evento entra como JSON y los marcos salen
// según los escribe el envoltorio.
import { invoke } from "./index.mjs";

const enc = new TextEncoder();
const linea = (f) => enc.encode(JSON.stringify(f) + "\n");

export default {
  async fetch(request, env, ctx) {
    const event = await request.json();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const hecho = invoke(event, {
      write: (l) => void writer.write(enc.encode(l)).catch(() => {}),
      end: () => void writer.close().catch(() => {}),
    }).catch(async (e) => {
      await writer.write(linea({ t: "error", kind: "uncaught", message: String((e && e.message) || e) })).catch(() => {});
      await writer.write(linea({ t: "end", ms: 0 })).catch(() => {});
      await writer.close().catch(() => {});
    });
    ctx.waitUntil(hecho);
    return new Response(readable, { headers: { "content-type": "application/x-ndjson" } });
  },
};
`;

/** Sólo los mapas que tienen fuentes del proyecto (`app:`): los trozos que son
 *  sólo catálogo no traducen ninguna traza de Len y pesan megas. */
export function projectMapsOnly(maps: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(maps).filter(([, texto]) => {
      try {
        return ((JSON.parse(texto) as { sources?: string[] }).sources ?? []).some((s) => s.startsWith("app:"));
      } catch {
        return false;
      }
    }),
  );
}

function diagnostico(m: ThreadMessage, gravedad: Gravedad, codigo: string): Diagnostico {
  return {
    ruta: m.file ? stripNamespaces(m.file) : "/supabase/functions/",
    linea: m.line ?? 1,
    columna: (m.column ?? 0) + 1,
    gravedad,
    mensaje: stripNamespaces(m.text),
    codigo,
    fuente: "esbuild",
  };
}

export function bundleFunctions(args: {
  readonly files: Readonly<Record<string, string>>;
  readonly catalog: string;
  readonly mode: FunctionsBundleMode;
  readonly timeoutMs?: number;
}): Promise<FunctionsBundle | null> {
  const layout = readFunctionsLayout(args.files);
  if (!layout.ok) {
    return Promise.resolve({
      ok: false,
      warnings: [],
      errors: layout.errors.map((e) => ({ ruta: e.path, linea: e.line ?? 1, columna: 1, gravedad: "Error" as const, mensaje: e.message, codigo: "functions-layout", fuente: "supabase" })),
    });
  }
  if (layout.functions.length === 0) return Promise.resolve(VACIO);
  const catalog = functionsCatalog(args.catalog);
  if (!catalog) throw new Error(`no hay catálogo de funciones ${args.catalog}`);
  const sources = Object.fromEntries(Object.entries(args.files).filter(([r]) => r.startsWith("/supabase/") && FUENTE.test(r)));
  const importMaps = Object.fromEntries(layout.functions.map((f) => [f.name, f.importMap]));
  const clave = createHash("sha256")
    .update(JSON.stringify([args.mode, args.catalog, layout.functions, layout.sharedImportMap, Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))]))
    .digest("hex");
  const hecho = hechos.get(clave);
  if (hecho) return Promise.resolve(hecho);
  const ya = enCamino.get(clave);
  if (ya) return ya;
  const promesa = runOnBundlerThread<ThreadOutput>(
    {
      kind: "functions",
      entry: entrySource(layout.functions),
      sources,
      importMaps,
      sharedImportMap: layout.sharedImportMap,
      catalog: { dependencies: catalog.dependencies.map((d) => ({ name: d.name, version: d.version, file: d.file, ...(d.subpaths ? { subpaths: d.subpaths } : {}) })) },
      vendorDir: path.join(process.cwd(), "lib", "functions", "vendor", args.catalog),
      runtimeFile: path.join(process.cwd(), "lib", "functions", "runtime", "runtime.mjs"),
      minify: args.mode === "production",
    },
    args.timeoutMs ?? TOPE_MS,
  ).then((r): FunctionsBundle | null => {
    enCamino.delete(clave);
    if (!r) return null;
    const warnings = r.warnings.map((w) => diagnostico(w, "Warning", "functions-version"));
    if (r.errors.length > 0) return { ok: false, errors: r.errors.map((e) => diagnostico(e, "Error", "functions-bundle")), warnings };
    const files: Record<string, string> = {};
    const maps: Record<string, string> = {};
    for (const [nombre, texto] of Object.entries(r.outputs)) {
      if (nombre.endsWith(".map")) maps[nombre.slice(0, -".map".length)] = texto;
      else files[nombre] = texto;
    }
    files[WORKER_MAIN_MODULE] = WORKER_ENTRY;
    const hash = bundleHash(files);
    const bundle: FunctionsBundle = { ok: true, hash, files, maps: projectMapsOnly(maps), functions: layout.functions, warnings };
    hechos.set(clave, bundle);
    if (hechos.size > CACHE_MAX) hechos.delete(hechos.keys().next().value!);
    return bundle;
  });
  enCamino.set(clave, promesa);
  return promesa;
}
