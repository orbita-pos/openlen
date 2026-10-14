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
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { formatStylish, formatTsc } from "@/lib/apps/checker/format.mjs";
import { catalogo } from "@/lib/apps/dependencias";
import { listPackages, pendingInstall, type InstallOutcome, type InstallRequest } from "@/lib/apps/npm/install";
import { readEsmLock, sourceOf } from "@/lib/apps/npm/lock";
import { nodeModulesOf } from "@/lib/apps/npm/node-modules";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { parseBareSpecifier } from "@/lib/apps/npm/specifier";
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

/** `three`, `three@^0.186`, `@scope/pkg@1.2.3` → name and range, like npm. */
export function parseInstallArg(arg: string): { name: string; range: string | null } {
  const at = arg.indexOf("@", 1);
  return at > 0 ? { name: arg.slice(0, at), range: arg.slice(at + 1) || null } : { name: arg, range: null };
}

function npmOutput(outcome: InstallOutcome, request: InstallRequest, ms: number): { stdout: string; stderr: string; exitCode: number } {
  const errors = outcome.notes.filter((n) => n.severity === "Error");
  const stderr = [
    ...outcome.notes.filter((n) => n.severity === "Warning").map((n) => `npm warn ${n.message}`),
    ...errors.map((n) => `npm error ${n.message}`),
  ];
  const secs = (ms / 1000).toFixed(1);
  const plural = (n: number) => `${n} package${n === 1 ? "" : "s"}`;
  const lines = outcome.installed.map((p) => `+ ${p}`);
  if (request.remove.length > 0) lines.push(`removed ${plural(request.remove.length)} in ${secs}s`);
  else lines.push(outcome.installed.length > 0 ? `added ${plural(outcome.installed.length)} in ${secs}s` : `up to date in ${secs}s`);
  return { stdout: `${lines.join("\n")}\n`, stderr: stderr.length > 0 ? `${stderr.join("\n")}\n` : "", exitCode: errors.length > 0 ? 1 : 0 };
}

/** Lo que `npm install` no tiene que traer de npm porque ya está: el kit de
 *  pruebas (plan 04) y los `@types` del paquete de tipos del catálogo. Su línea
 *  es la de antes de npm abierto; `null` si hay que instalarlo. */
function alreadyThere(name: string, typesPackages: readonly string[], typesOfInstalled: ReadonlyMap<string, string>): string | null {
  if (name === "vitest") return "vitest: already available (tests run with OpenLen's test kit)";
  if (/^@(?:testing-library|vitest)\//.test(name)) return `${name}: already available (test kit)`;
  if (name === "jsdom" || name === "happy-dom") return `${name}: not needed: tests run in a real browser (Chromium), like Vitest's browser mode`;
  if (typesPackages.includes(name)) return `${name}: already available (its types come with the catalog)`;
  const of = typesOfInstalled.get(name);
  if (of) return `${name}: already available (its types come with ${of})`;
  return null;
}

/** The @types an installed esm.sh package's types already came from: "@types/leaflet" → "leaflet". */
function typesOfInstalled(files: Readonly<Record<string, string>>, catalogName: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, locked] of Object.entries(readEsmLock(files).packages)) {
    const from = locked.typesFrom?.name;
    if (from?.startsWith("@types/") && from !== name && sourceOf(name, files, catalogName).kind === "esm") out.set(from, name);
  }
  return out;
}

export function appToolsFor(
  session: Pick<AgentSession, "app" | "projectId" | "autor" | "nodeModulesView">,
  deps: Pick<AgentDeps, "checkApp" | "buildApp" | "testApp" | "entornoDeLaApp" | "projectFiles" | "installPackages" | "saveProjectFile">,
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
    run: async (program, args, deLaTerminal, timeLeftMs = 120_000, signal) => {
      // NPM ABIERTO (spec 2026-10-13): el lock de esm.sh vive en /.openlen, que
      // es de sólo lectura y no viaja a la terminal; sin él, los paquetes
      // instalados no los sirve nadie. Se suma el del servidor; lo demás es lo
      // de la terminal, como está AHORA.
      const server = session.projectId && deps.projectFiles ? await deps.projectFiles(session.projectId).catch(() => ({}) as Record<string, string>) : {};
      const ficheros = server[ESM_LOCK_PATH] !== undefined ? { ...deLaTerminal, [ESM_LOCK_PATH]: server[ESM_LOCK_PATH] } : deLaTerminal;
      // NPM ABIERTO: `npm install|uninstall|ls`, por el mismo instalador que
      // guardar un import (`deps.installPackages`). El lock se guarda aquí (la
      // terminal no escribe /.openlen); el /package.json nuevo vuelve en `files`
      // y lo guarda el comando, por la puerta de siempre.
      if (program === "npm-install" || program === "npm-uninstall" || program === "npm-ls") {
        if (!deps.installPackages) return { stdout: "", stderr: "npm: not available here.\n", exitCode: 1 };
        if (program === "npm-ls") return { stdout: listPackages(ficheros, app), stderr: "", exitCode: 0 };
        const names = args.filter((a) => !a.startsWith("-"));
        const typesPackages = typesPackagesOf(app.catalogo);
        const installedTypes = typesOfInstalled(ficheros, app.catalogo);
        const here = program === "npm-install" ? names.map((n) => alreadyThere(parseInstallArg(n).name, typesPackages, installedTypes)) : [];
        const local = here.filter((l): l is string => l !== null).map((l) => `${l}\n`).join("");
        const toInstall = names.filter((_, i) => !here[i]);
        if (program === "npm-install" && names.length > 0 && toInstall.length === 0) return { stdout: local, stderr: "", exitCode: 0 };
        const request: InstallRequest =
          program === "npm-uninstall"
            ? { add: [], remove: names.map((n) => parseInstallArg(n).name) }
            : toInstall.length === 0
              ? pendingInstall(ficheros, app)
              : {
                  add: toInstall.map((n) => {
                    const p = parseInstallArg(n);
                    return { name: parseBareSpecifier(p.name)?.name ?? p.name, range: p.range, subpaths: [""], explicit: true };
                  }),
                  remove: [],
                };
        const started = Date.now();
        const outcome = await deps.installPackages(ficheros, app, request);
        const lock = outcome.files[ESM_LOCK_PATH];
        if (lock !== undefined && deps.saveProjectFile && session.projectId) {
          const verb = program === "npm-uninstall" ? "uninstall" : "install";
          await deps.saveProjectFile(session.projectId, ESM_LOCK_PATH, lock, {
            before: ficheros[ESM_LOCK_PATH] ?? null,
            label: `npm ${verb} ${names.join(" ")}`.trim(),
            source: session.autor === "usuario" ? "manual" : "chat",
          });
        }
        const out = npmOutput(outcome, request, Date.now() - started);
        const pkg = outcome.files[PACKAGE_JSON_PATH];
        // /node_modules como lo deja npm, YA: la terminal lo monta en este mismo
        // comando y la sesión lo lee de aquí hasta que el comando se guarde.
        const after = { ...ficheros, ...(lock !== undefined ? { [ESM_LOCK_PATH]: lock } : {}), ...(pkg !== undefined ? { [PACKAGE_JSON_PATH]: pkg } : {}) };
        const nodeModules = nodeModulesOf(after, app.catalogo);
        session.nodeModulesView = nodeModules;
        return {
          ...out,
          stdout: local + out.stdout,
          ...(pkg !== undefined ? { files: { [PACKAGE_JSON_PATH]: pkg } } : {}),
          nodeModules: nodeModules.paths,
        };
      }
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
      const fuentes = Object.fromEntries(Object.entries(ficheros).filter(([ruta]) => isCompileInputPath(ruta)));
      if (program === "build") {
        if (!deps.buildApp) return { stdout: "", stderr: "npm run build: not available here.\n", exitCode: 1 };
        // Con `/.env` y el `import.meta.env` de borrador, como el lienzo y los
        // ojos (spec local 2026-10-10): el paquete mide lo que de verdad lleva.
        const aCompilar = Object.fromEntries(Object.entries(ficheros).filter(([ruta]) => isCompileInputPath(ruta)));
        const entorno = session.projectId && deps.entornoDeLaApp ? await deps.entornoDeLaApp(session.projectId).catch(() => null) : null;
        const r = await deps.buildApp(aCompilar, app, entorno ? { entorno } : undefined);
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
