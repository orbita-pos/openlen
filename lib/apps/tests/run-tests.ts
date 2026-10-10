// lib/apps/tests/run-tests.ts — LAS PRUEBAS DE UNA APP, CORRIDAS DE VERDAD
// (plan 04) en el Chromium de los ojos: el MISMO navegador, el mismo origen de
// medida y el mismo guardia SSRF que `view_page` y `use_page`, que ya ejecutan
// el código de la app. Una página por fichero de prueba (vitest aísla cada
// fichero), uno detrás de otro, dentro del plazo del comando que las pidió
// (120 s por defecto, como un comando de Claude Code).
//
// La traza de un fallo vuelve a su fichero y su línea por el mapa del paquete
// (`traductorDeMapas`): `src/App.test.jsx:7:19`, no la línea del paquete.
import type { Browser } from "puppeteer";
import { esperarALaRed, origenDeMedida } from "@/lib/ai/origen-de-medida";
import { sitioEnLaTraza, traductorDeMapas } from "@/lib/ai/sitio-del-error";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import { esFuenteCompilable } from "@/lib/apps/compilador";
import type { AppDeProyecto } from "@/lib/projects/types";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { bundleAppTests } from "./bundle-tests";
import { isTestFile } from "./test-files";

export interface TestFailure {
  readonly name: string;
  readonly message: string;
  readonly diff: string | null;
  readonly site: { readonly ruta: string; readonly linea: number; readonly columna: number } | null;
}
export interface TestCaseResult {
  readonly name: readonly string[];
  readonly state: "pass" | "fail" | "skip" | "todo";
  readonly ms: number;
  readonly error: TestFailure | null;
}
export interface TestFileResult {
  readonly file: string;
  readonly tests: readonly TestCaseResult[];
  readonly fileError: TestFailure | null;
  readonly unhandled: readonly TestFailure[];
  readonly ms: number;
}
export interface TestRun {
  readonly files: readonly TestFileResult[];
  /** Los que no llegaron a correr: se acabó el plazo. */
  readonly notRun: readonly string[];
  /** Lo que el guardia no dejó salir (red fuera del origen de medida). */
  readonly blocked: readonly string[];
  readonly ms: number;
}

/** Sin plazo dado: el de un comando de Claude Code (120 s) menos el margen
 *  para devolver el informe. La terminal pasa el de SU comando (Tarea 8). */
const PLAZO_MS = 115_000;
/** Lo nuestro: una página bloqueada no puede comerse el comando entero. */
const POR_FICHERO_MS = 30_000;
/** El tope del empaquetado de las pruebas (el de `bundle-tests.ts`), o lo que quede del plazo. */
const TOPE_DEL_PAQUETE_MS = 20_000;

export function findTestFiles(carpeta: Readonly<Record<string, string>>, filters: readonly string[]): string[] {
  const todos = Object.keys(carpeta).filter(isTestFile).sort();
  if (filters.length === 0) return todos;
  return todos.filter((f) => filters.some((x) => f.toLowerCase().includes(x.toLowerCase())));
}

interface Crudo { name: string; message: string; stack: string; diff: string | null }
interface CrudoFichero { file: string; tests: { name: string[]; state: TestCaseResult["state"]; ms: number; error: Crudo | null }[]; fileError: Crudo | null; unhandled: Crudo[]; ms: number }

const HTML = (entrada: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>tests</title></head><body><script type="module" src="${entrada}"></script></body></html>`;

export async function runAppTests(args: {
  readonly carpeta: Readonly<Record<string, string>>;
  readonly app: AppDeProyecto;
  readonly entorno?: Readonly<Record<string, string>>;
  readonly filters?: readonly string[];
  readonly testNamePattern?: string;
  readonly deadlineMs?: number;
  readonly perFileMs?: number;
  readonly lanzar?: () => Promise<Browser>;
  /** El comando se abortó (`timeout N npm test` dentro del guion): no se lanza
   *  nada más y la página que corre se cierra. Lo que quedó, «sin correr». */
  readonly signal?: AbortSignal;
}): Promise<TestRun | null> {
  const t0 = Date.now();
  const cancelado = () => args.signal?.aborted === true;
  const plazo = t0 + (args.deadlineMs ?? PLAZO_MS);
  const porFichero = args.perFileMs ?? POR_FICHERO_MS;
  const testFiles = findTestFiles(args.carpeta, args.filters ?? []);
  if (testFiles.length === 0) return { files: [], notRun: [], blocked: [], ms: Date.now() - t0 };
  // Empaquetar también va dentro del plazo del comando: lo que arrancó el
  // comando muere con él, como en Claude Code.
  const paquete = await bundleAppTests({
    carpeta: args.carpeta,
    app: args.app,
    ...(args.entorno ? { entorno: args.entorno } : {}),
    testFiles,
    timeoutMs: Math.max(1, Math.min(TOPE_DEL_PAQUETE_MS, plazo - Date.now())),
  });
  if (Date.now() >= plazo || cancelado()) return { files: [], notRun: testFiles, blocked: [], ms: Date.now() - t0 };
  if (!paquete) return null;
  const files: TestFileResult[] = paquete.failed.map(({ file, errores }) => ({
    file,
    tests: [],
    fileError: { name: "Error", message: errores.map((e) => `${e.ruta}${e.linea ? `:${e.linea}` : ""} — ${e.mensaje}`).join("\n"), diff: null, site: errores[0]?.linea ? { ruta: errores[0].ruta, linea: errores[0].linea, columna: errores[0].columna ?? 1 } : null },
    unhandled: [],
    ms: 0,
  }));
  const notRun: string[] = [];
  const blocked = new Set<string>();
  const porCorrer = Object.entries(paquete.entries);
  if (porCorrer.length > 0) {
    // Lo que la app sirve tal cual (hojas, .svg, .json…): lo piden sus módulos.
    const estaticos = Object.fromEntries(Object.entries(args.carpeta).filter(([r]) => isPublishableFolderPath(r) && !esFuenteCompilable(r, true)));
    const traducir = traductorDeMapas(paquete.maps);
    const browser = await (args.lanzar ?? lanzarChromium)();
    try {
      const origen = await origenDeMedida();
      for (const [file, entrada] of porCorrer) {
        const queda = plazo - Date.now();
        if (queda < 1_000 || cancelado()) {
          notRun.push(file);
          continue;
        }
        const tope = Math.min(porFichero, queda);
        const page = await browser.newPage();
        // Cerrar la página hace fallar en el acto lo que espera dentro.
        const alCancelar = () => void page.close().catch(() => undefined);
        args.signal?.addEventListener("abort", alCancelar, { once: true });
        const doc = origen.publicar(HTML(entrada), { files: estaticos, platformFiles: paquete.files });
        const t1 = Date.now();
        try {
          // Lo que corta el guardia (lo privado o interno) y una navegación que
          // sacaría la página de su origen: las dos se dicen en el informe. La
          // red pública sale, como en los ojos y como en vitest.
          await installSubresourceSsrfGuard(page, {
            allowOrigins: [origen.origin],
            onBlocked: (u) => blocked.add(u),
            alSalir: (u) => blocked.add(u),
          });
          if (args.testNamePattern) await page.evaluateOnNewDocument((p) => ((globalThis as { __openlenTestOptions?: unknown }).__openlenTestOptions = { testNamePattern: p }), args.testNamePattern);
          await page.goto(doc.url, { waitUntil: "load", timeout: tope });
          await page.waitForFunction(() => "__openlenTestResult" in globalThis, { timeout: Math.max(1, tope - (Date.now() - t1)), polling: 100 });
          const crudo = (await page.evaluate(() => (globalThis as unknown as { __openlenTestResult: unknown }).__openlenTestResult)) as CrudoFichero;
          files.push(aResultado(crudo, traducir));
        } catch {
          // Lo cortó el plazo del COMANDO, no el suyo, o se canceló: queda sin
          // correr (vitest, al morir, no imprime el fichero que estaba corriendo).
          if (cancelado() || (tope < porFichero && Date.now() >= plazo - 50)) {
            notRun.push(file);
            continue;
          }
          files.push({
            file,
            tests: [],
            fileError: { name: "Error", message: `didn't finish in ${Math.round(tope / 1000)}s: a test blocked the page (an endless loop?).`, diff: null, site: null },
            unhandled: [],
            ms: Date.now() - t1,
          });
        } finally {
          args.signal?.removeEventListener("abort", alCancelar);
          doc.soltar();
          await page.close().catch(() => undefined);
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  const orden = (f: TestFileResult) => testFiles.indexOf(f.file);
  return { files: files.sort((a, b) => orden(a) - orden(b)), notRun, blocked: [...blocked], ms: Date.now() - t0 };
}

function aFallo(c: Crudo, traducir: ReturnType<typeof traductorDeMapas>): TestFailure {
  const site = sitioEnLaTraza(c.stack, traducir);
  return { name: c.name, message: c.message, diff: c.diff, site: site ? { ruta: site.ruta, linea: site.linea, columna: site.columna } : null };
}

function aResultado(c: CrudoFichero, traducir: ReturnType<typeof traductorDeMapas>): TestFileResult {
  return {
    file: c.file,
    tests: c.tests.map((t) => ({ name: t.name, state: t.state, ms: t.ms, error: t.error ? aFallo(t.error, traducir) : null })),
    fileError: c.fileError ? aFallo(c.fileError, traducir) : null,
    unhandled: c.unhandled.map((u) => aFallo(u, traducir)),
    ms: c.ms,
  };
}
