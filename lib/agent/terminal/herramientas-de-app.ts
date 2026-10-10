// lib/agent/terminal/herramientas-de-app.ts — `tsc` y `eslint` de la terminal de
// UNA APP, del lado del hilo de la app (plan 03 de plans/app-catalog-and-bundler).
//
// La terminal (`trabajador.mjs`) pide; aquí se corre el comprobador de verdad
// (`deps.checkApp`, en su propio hilo y con tope) sobre los fuentes de la web, y
// la salida vuelve como la imprimen `tsc --noEmit` y el `stylish` de ESLint, con
// su código de salida: 2 si `tsc` encuentra errores, 1 si ESLint los encuentra.
// Y `npm run build` (plan 02): el paquete de producción de verdad
// (`deps.buildApp`), con su tamaño como lo imprime Vite. Y `npm test` (plan 04):
// las pruebas de la app en el Chromium de los ojos (`deps.testApp`), con el
// informe de vitest.
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { formatStylish, formatTsc } from "@/lib/apps/checker/format.mjs";
import { catalogo } from "@/lib/apps/dependencias";
import { formatVitestReport } from "@/lib/apps/tests/report";
import { typesPackagesOf } from "@/lib/apps/checker/types-pack";
import type { TerminalDeLen } from "./terminal";

type AppTools = NonNullable<ConstructorParameters<typeof TerminalDeLen>[0]["appTools"]>;

/** `.`, `src`, `./src/lib/`, `src/App.tsx` → si `ruta` (absoluta) cae dentro. */
function dentroDe(rutas: readonly string[], ruta: string): boolean {
  if (rutas.length === 0) return true;
  return rutas.some((p) => {
    const limpia = p.replace(/^\.\/?/, "").replace(/\/+$/, "");
    return limpia === "" || ruta === `/${limpia}` || ruta.startsWith(`/${limpia}/`);
  });
}

export function appToolsFor(
  session: Pick<AgentSession, "app" | "projectId">,
  deps: Pick<AgentDeps, "checkApp" | "buildApp" | "testApp" | "entornoDeLaApp">,
): AppTools | undefined {
  const app = session.app;
  const check = deps.checkApp;
  if (!app || !check) return undefined;
  return {
    // Todo lo que se puede importar, también los `@radix-ui/react-*` que el
    // manual no lista (son los que instala shadcn).
    catalogSpecifiers: (catalogo(app.catalogo)?.dependencias ?? []).map((d) => d.especificador),
    // Y los @types que trae su paquete de tipos: `npm install -D @types/react` ya está.
    typesPackages: typesPackagesOf(app.catalogo),
    run: async (program, args, ficheros, timeLeftMs = 120_000, signal) => {
      if (program === "test") {
        if (args.some((a) => a === "--coverage" || a.startsWith("--coverage."))) return { stdout: "", stderr: "vitest: coverage isn't available here.\n", exitCode: 1 };
        if (args.some((a) => a === "-u" || a === "--update")) return { stdout: "", stderr: "vitest: snapshots aren't available here (there is no snapshot file).\n", exitCode: 1 };
        if (!deps.testApp) return { stdout: "", stderr: "npm test: not available here.\n", exitCode: 1 };
        // Los argumentos de vitest: `run`/`--run`/`--watch=false` sobran (aquí
        // siempre corre una vez); `-t x`/`--testNamePattern=x` filtra por nombre;
        // lo demás que no empieza por `-` filtra ficheros, como `vitest run carrito`.
        let testNamePattern: string | undefined;
        const filters: string[] = [];
        for (let i = 0; i < args.length; i++) {
          const a = args[i]!;
          if (a === "-t" || a === "--testNamePattern") testNamePattern = args[++i];
          else if (a.startsWith("--testNamePattern=")) testNamePattern = a.slice("--testNamePattern=".length);
          else if (a === "run" && i === 0) continue;
          else if (!a.startsWith("-")) filters.push(a);
        }
        // Su `import.meta.env` de borrador (las variables del dueño, y la URL y la clave publicable de su backend), como en los ojos.
        const entorno = session.projectId && deps.entornoDeLaApp ? await deps.entornoDeLaApp(session.projectId).catch(() => null) : null;
        // A `testApp` van TODOS los ficheros, no sólo los publicables: una prueba puede vivir en /tests.
        // Dentro del tiempo de SU comando (120 s por defecto, el de Claude Code), con 1 s para devolver
        // lo impreso: si no acaba, el comando se corta como cuando Claude Code mata a vitest.
        const r = await deps.testApp(ficheros, app, {
          filters,
          deadlineMs: Math.max(1, timeLeftMs - 1_000),
          ...(testNamePattern ? { testNamePattern } : {}),
          ...(entorno ? { entorno } : {}),
          // `timeout N npm test` dentro del guion: si corta, Chromium para.
          ...(signal ? { signal } : {}),
        });
        if (!r) return { stdout: "", stderr: "vitest: didn't finish in time; try again.\n", exitCode: 1 };
        const { stdout, exitCode, timedOut } = formatVitestReport(r, ficheros);
        return { stdout, stderr: "", exitCode, ...(timedOut ? { timedOut } : {}) };
      }
      const fuentes = Object.fromEntries(Object.entries(ficheros).filter(([ruta]) => isPublishableFolderPath(ruta)));
      if (program === "build") {
        if (!deps.buildApp) return { stdout: "", stderr: "npm run build: not available here.\n", exitCode: 1 };
        const r = await deps.buildApp(fuentes, app);
        if (!r) return { stdout: "", stderr: "build: didn't finish in time; try again.\n", exitCode: 1 };
        if (!r.ok) {
          const errores = r.errores
            .map((e) => `✘ [ERROR] ${e.mensaje}\n\n    ${e.ruta.slice(1)}${e.linea === null ? "" : `:${e.linea}${e.columna === null ? "" : `:${e.columna}`}`}:\n\n`)
            .join("");
          return { stdout: "", stderr: `${errores}${r.errores.length} error${r.errores.length === 1 ? "" : "s"}\n`, exitCode: 1 };
        }
        // Como lo imprime Vite: el fichero, su tamaño y su gzip, en kB (1000).
        const kb = (n: number) => (n / 1000).toFixed(2);
        return {
          stdout: `${app.entrada.slice(1)}  ${kb(r.bytes)} kB │ gzip: ${kb(r.gzipBytes)} kB\n✓ built in ${(r.ms / 1000).toFixed(2)}s\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      const r = await check(fuentes, app.catalogo);
      if (!r) return { stdout: "", stderr: `${program}: didn't finish in time; try again.\n`, exitCode: 1 };
      if (program === "tsc") return { stdout: formatTsc(r.typescript), stderr: "", exitCode: r.typescript.length > 0 ? 2 : 0 };
      const rutas = args.filter((a) => !a.startsWith("-"));
      const ds = r.eslint.filter((d) => dentroDe(rutas, d.ruta));
      return { stdout: formatStylish(ds), stderr: "", exitCode: ds.some((d) => d.gravedad === "Error") ? 1 : 0 };
    },
  };
}
