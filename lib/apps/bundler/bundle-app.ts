// lib/apps/bundler/bundle-app.ts — LA APP, EMPAQUETADA (plan 02), desde el hilo
// de la app: un fichero con sus fuentes y SÓLO lo que usa del catálogo.
//
// Medido el 2026-10-08: el código propio de una app es el 0,5–1 % de lo que se
// descarga; lo que pesa es el catálogo, y sacudirlo por app lo baja un 26–47 %
// (shadcn 352 → 260 KB gzip; el esqueleto 146 → 78), de 41 descargas a 1.
//
// El COMPILADOR va primero y es la puerta: si `compilarCarpeta` da errores, ésos
// son la respuesta —con su fichero y su línea, los mismos que ven Len, el lienzo
// y la publicación—, y esbuild ni se llama. Lo que entra a esbuild son los
// módulos ya compilados (`bundler-worker.mjs`).
//
// Caché por contenido (una carpeta = un paquete) y las peticiones iguales a la
// vez comparten una: el lienzo y los ojos piden lo mismo tras cada edición.
import { createHash } from "node:crypto";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { compilarCarpeta, esFuenteCompilable, type Diagnostico } from "@/lib/apps/compilador";
import { catalogo, RAIZ_VENDOR, type ModoVendor } from "@/lib/apps/dependencias";
import { directorioVendor } from "@/lib/apps/servir";
import { WorkerQueue } from "@/lib/apps/worker-queue";
import type { AppDeProyecto } from "@/lib/projects/types";

const RUTA_DEL_HILO = path.join(process.cwd(), "lib", "apps", "bundler", "bundler-worker.mjs");
const TOPE_MS = 30_000;
const CACHE_MAX = 20;

export const BUNDLER_DID_NOT_ANSWER = "The bundler didn't answer in time: nothing was built. Try again.";

export type AppBundle =
  | { readonly ok: true; readonly js: string; readonly map: string | null; readonly bytes: number; readonly gzipBytes: number; readonly ms: number }
  | { readonly ok: false; readonly errores: readonly Diagnostico[] };

interface WorkerResult {
  readonly js: string;
  readonly map: string | null;
  readonly errors: readonly { file: string | null; line: number | null; column: number | null; text: string }[];
  readonly ms: number;
}

const cola = new WorkerQueue<WorkerResult>({ workerPath: RUTA_DEL_HILO, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
const hechos = new Map<string, AppBundle>();
const enCamino = new Map<string, Promise<AppBundle | null>>();

function aBundle(r: WorkerResult, entrada: string): AppBundle {
  if (r.errors.length > 0) {
    return {
      ok: false,
      errores: r.errors.map((e) => ({
        ruta: e.file ? e.file.replace(/^app:/, "") : entrada,
        linea: e.line,
        columna: e.column === null ? null : e.column + 1,
        mensaje: e.text,
      })),
    };
  }
  return { ok: true, js: r.js, map: r.map, bytes: Buffer.byteLength(r.js), gzipBytes: gzipSync(r.js).length, ms: r.ms };
}

export function bundleApp(args: {
  readonly carpeta: Readonly<Record<string, string>>;
  readonly app: AppDeProyecto;
  readonly entorno?: Readonly<Record<string, string>>;
  readonly modo: ModoVendor;
  readonly timeoutMs?: number;
}): Promise<AppBundle | null> {
  const { app, modo } = args;
  const compilada = compilarCarpeta({
    carpeta: args.carpeta,
    catalogo: app.catalogo,
    ...(args.entorno ? { entorno: args.entorno } : {}),
  });
  if (compilada.errores.length > 0) return Promise.resolve({ ok: false, errores: compilada.errores });
  if (!Object.hasOwn(compilada.ficheros, app.entrada)) {
    return Promise.resolve({ ok: false, errores: [{ ruta: app.entrada, linea: null, columna: null, mensaje: "the app's entry module does not exist" }] });
  }
  const modules = Object.fromEntries(
    Object.entries(compilada.ficheros).filter(([r]) => esFuenteCompilable(r, true) || r.endsWith(".json")),
  );
  const clave = createHash("sha256")
    .update(JSON.stringify([modo, app.catalogo, app.entrada, Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))]))
    .digest("hex");
  const hecho = hechos.get(clave);
  if (hecho) return Promise.resolve(hecho);
  const ya = enCamino.get(clave);
  if (ya) return ya;
  const promesa = cola
    .run(
      {
        modules,
        entry: app.entrada,
        catalogFiles: Object.fromEntries((catalogo(app.catalogo)?.dependencias ?? []).map((d) => [d.especificador, d.fichero])),
        vendorDir: path.join(directorioVendor(), app.catalogo, modo),
        vendorPrefix: `${RAIZ_VENDOR}/${app.catalogo}/`,
        minify: modo === "produccion",
        nodeEnv: modo === "produccion" ? "production" : "development",
        sourcemap: modo === "desarrollo",
      },
      { timeoutMs: args.timeoutMs ?? TOPE_MS },
    )
    .then((r) => {
      enCamino.delete(clave);
      if (!r) return null;
      const bundle = aBundle(r, app.entrada);
      hechos.set(clave, bundle);
      if (hechos.size > CACHE_MAX) hechos.delete(hechos.keys().next().value!);
      return bundle;
    });
  enCamino.set(clave, promesa);
  return promesa;
}

/** Para las pruebas y el apagado. */
export function stopBundlerWorker(): void {
  cola.stop();
}

/** NUNCA se llama: está para el trazador del standalone (como `toolchainForTracing`). */
export const bundlerForTracing = () => import("esbuild-wasm/lib/browser.js");
