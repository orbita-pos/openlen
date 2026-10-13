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
import { compilarCarpeta, esFuenteCompilable, JSX_DEV_RUNTIME, type Diagnostico } from "@/lib/apps/compilador";
import { JSX_DEV_RUNTIME_MODULE } from "@/lib/apps/design/jsx-dev-runtime";
import { catalogo, RAIZ_VENDOR, type ModoVendor } from "@/lib/apps/dependencias";
import { npmForBundle, type NpmBundleInput } from "@/lib/apps/npm/for-bundle";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { parseBareSpecifier } from "@/lib/apps/npm/specifier";
import { defaultModuleStore } from "@/lib/apps/npm/store";
import { BUNDLER_DID_NOT_ANSWER, directorioVendor } from "@/lib/apps/servir";
import { WorkerQueue } from "@/lib/apps/worker-queue";
import type { AppDeProyecto } from "@/lib/projects/types";

const RUTA_DEL_HILO = path.join(process.cwd(), "lib", "apps", "bundler", "bundler-worker.mjs");
const TOPE_MS = 30_000;
const CACHE_MAX = 20;

// Vive en servir.ts (la entrada servida lo usa); se reexporta para quien empaqueta.
export { BUNDLER_DID_NOT_ANSWER };

export type AppBundle =
  | { readonly ok: true; readonly js: string; readonly map: string | null; readonly bytes: number; readonly gzipBytes: number; readonly ms: number }
  | { readonly ok: false; readonly errores: readonly Diagnostico[] };

/** Lo que se le pide al hilo (`bundler-worker.mjs`): la app y, desde el plan
 *  04, sus pruebas — varias entradas, módulos virtuales y simulados. */
export type BundlerMessage = {
  readonly entries: readonly string[];
  readonly modules: Readonly<Record<string, string>>;
  readonly virtual: Readonly<Record<string, string>>;
  readonly mocked: readonly string[];
  readonly empty: readonly string[];
  /** Especificador → su ruta pública (`/openlen/vendor/2026-11/react.js`). */
  readonly catalogFiles: Readonly<Record<string, string>>;
  /** Prefijo de ruta pública → la carpeta del disco donde están sus ficheros. */
  readonly vendorRoots: Readonly<Record<string, string>>;
  readonly minify: boolean;
  readonly nodeEnv: string;
  readonly sourcemap: boolean;
  /** OPEN NPM (spec 2026-10-13): what the esm lock serves; null when the app has none. */
  readonly npm?: NpmBundleInput | null;
};

export interface BundlerOutput {
  /** Nombre del fichero de salida (`main.js`, `main.js.map`) → su texto. */
  readonly outputs: Readonly<Record<string, string>>;
  readonly errors: readonly { file: string | null; line: number | null; column: number | null; text: string }[];
  readonly ms: number;
}

const cola = new WorkerQueue<BundlerOutput>({ workerPath: RUTA_DEL_HILO, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
const hechos = new Map<string, AppBundle>();
const enCamino = new Map<string, Promise<AppBundle | null>>();
/** `supersedes` de `bundleApp` (un texto) → la marca de la cola (un objeto). */
const marcas = new Map<string, object>();

/** El empaquetador, tal cual: para `bundleApp` y para las pruebas (`bundle-tests.ts`). */
export function runBundler(m: BundlerMessage, timeoutMs: number, supersedes?: object): Promise<BundlerOutput | null> {
  return cola.run(m, { timeoutMs, ...(supersedes ? { supersedes } : {}) });
}

/** LAS EDGE FUNCTIONS (lib/functions/bundler/) usan el MISMO hilo: un solo
 *  esbuild-wasm en memoria en la caja. Su mensaje lleva `kind: "functions"`. */
export function runOnBundlerThread<T>(m: Record<string, unknown>, timeoutMs: number): Promise<T | null> {
  return (cola as unknown as WorkerQueue<T>).run(m, { timeoutMs });
}

// Los espacios de nombres del hilo (`bundler-worker.mjs`) salen en las rutas
// de esbuild —`app:/src/x.js`, `virtual:hoist:/src/x.test.js`,
// `npm:https://esm.sh/…`—, también dentro del texto del error; Len escribió
// rutas, y es lo que lee.
const NAMESPACE = /\b(?:app|virtual|mock|empty|vendor):(?:(?:hoist|suite):)?(?=\/)|\bnpm:(?=https?:)|\bnpm-(?:style|url):/g;

export function stripNamespaces(texto: string): string {
  return texto.replace(NAMESPACE, "");
}

/** Un error de esbuild como diagnóstico: su ruta (o `ruta`, si no trae) y su texto, sin espacios de nombres. */
export function esbuildDiagnostic(e: BundlerOutput["errors"][number], ruta: string): Diagnostico {
  return {
    ruta: e.file ? stripNamespaces(e.file) : ruta,
    linea: e.line,
    columna: e.column === null ? null : e.column + 1,
    mensaje: stripNamespaces(e.text),
  };
}

function aBundle(r: BundlerOutput, entrada: string): AppBundle {
  if (r.errors.length > 0) return { ok: false, errores: r.errors.map((e) => esbuildDiagnostic(e, entrada)) };
  const nombre = path.posix.basename(entrada).replace(/\.[cm]?[jt]sx?$/, ".js");
  const js = r.outputs[nombre] ?? "";
  return { ok: true, js, map: r.outputs[`${nombre}.map`] ?? null, bytes: Buffer.byteLength(js), gzipBytes: gzipSync(js).length, ms: r.ms };
}

export async function bundleApp(args: {
  readonly carpeta: Readonly<Record<string, string>>;
  readonly app: AppDeProyecto;
  readonly entorno?: Readonly<Record<string, string>>;
  readonly modo: ModoVendor;
  readonly timeoutMs?: number;
  /** Quién pide, si lo que pidió antes deja de importar en cuanto pide otra
   *  cosa: el lienzo de un proyecto (`lienzo:<id>`), cuya recarga deja atrás
   *  el iframe que esperaba. Su petición nueva SUSTITUYE (`null`) a la suya que
   *  aún espera en la cola. Una petición sin marca —los ojos, publicar— nunca
   *  se sustituye, ni se suma a una con marca: no puede perderla. */
  readonly supersedes?: string;
}): Promise<AppBundle | null> {
  const { app, modo, supersedes } = args;
  const compilada = compilarCarpeta({
    carpeta: args.carpeta,
    catalogo: app.catalogo,
    ...(args.entorno ? { entorno: args.entorno } : {}),
    // EL MODO DISEÑO: el lienzo y los ojos saben de qué línea sale cada cosa.
    ...(modo === "desarrollo" ? { development: true } : {}),
  });
  if (compilada.errores.length > 0) return { ok: false, errores: compilada.errores };
  if (!Object.hasOwn(compilada.ficheros, app.entrada)) {
    return { ok: false, errores: [{ ruta: app.entrada, linea: null, columna: null, mensaje: "the app's entry module does not exist" }] };
  }
  // OPEN NPM (spec 2026-10-13): the lock's packages, from the cache.
  const npm = await npmForBundle(args.carpeta, app, modo === "produccion" ? "production" : "development", { store: defaultModuleStore(), fetch });
  if (!npm.ok) return { ok: false, errores: npm.errores };
  const servedByEsm = new Set(npm.npm?.servedByEsm ?? []);
  // /package.json y el lock son entradas del compilador, no módulos de la app.
  const modules = Object.fromEntries(
    Object.entries(compilada.ficheros).filter(
      ([r]) => r !== PACKAGE_JSON_PATH && r !== ESM_LOCK_PATH && (esFuenteCompilable(r, true) || r.endsWith(".json")),
    ),
  );
  const clave = createHash("sha256")
    .update(JSON.stringify([modo, app.catalogo, app.entrada, Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)), npm.key]))
    .digest("hex");
  const hecho = hechos.get(clave);
  if (hecho) return hecho;
  // Con marca, se suma a una sin marca (nadie la sustituye) o a la suya.
  const claveEnCamino = supersedes ? `${clave}|${supersedes}` : clave;
  const ya = enCamino.get(clave) ?? enCamino.get(claveEnCamino);
  if (ya) return ya;
  let marca: object | undefined;
  if (supersedes) {
    marca = marcas.get(supersedes);
    if (!marca) marcas.set(supersedes, (marca = {}));
  }
  const raiz = `${RAIZ_VENDOR}/${app.catalogo}/`;
  const promesa = runBundler(
    {
      entries: [app.entrada],
      modules,
      virtual: modo === "desarrollo" ? { [JSX_DEV_RUNTIME]: JSX_DEV_RUNTIME_MODULE } : {},
      mocked: [],
      empty: [],
      catalogFiles: Object.fromEntries(
        (catalogo(app.catalogo)?.dependencias ?? [])
          .filter((d) => !servedByEsm.has(parseBareSpecifier(d.especificador)?.name ?? ""))
          .map((d) => [d.especificador, raiz + d.fichero]),
      ),
      vendorRoots: { [raiz]: path.join(directorioVendor(), app.catalogo, modo) },
      minify: modo === "produccion",
      nodeEnv: modo === "produccion" ? "production" : "development",
      sourcemap: modo === "desarrollo",
      npm: npm.npm,
    },
    args.timeoutMs ?? TOPE_MS,
    marca,
  )
    .then((r) => {
      enCamino.delete(claveEnCamino);
      if (!r) return null;
      const bundle = aBundle(r, app.entrada);
      hechos.set(clave, bundle);
      if (hechos.size > CACHE_MAX) hechos.delete(hechos.keys().next().value!);
      return bundle;
    });
  enCamino.set(claveEnCamino, promesa);
  return promesa;
}

/** Para las pruebas y el apagado. */
export function stopBundlerWorker(): void {
  cola.stop();
}

/** NUNCA se llama: está para el trazador del standalone (como `toolchainForTracing`). */
export const bundlerForTracing = () => import("esbuild-wasm/lib/browser.js");
