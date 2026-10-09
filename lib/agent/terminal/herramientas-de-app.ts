// lib/agent/terminal/herramientas-de-app.ts — `tsc` y `eslint` de la terminal de
// UNA APP, del lado del hilo de la app (plan 03 de plans/app-catalog-and-bundler).
//
// La terminal (`trabajador.mjs`) pide; aquí se corre el comprobador de verdad
// (`deps.checkApp`, en su propio hilo y con tope) sobre los fuentes de la web, y
// la salida vuelve como la imprimen `tsc --noEmit` y el `stylish` de ESLint, con
// su código de salida: 2 si `tsc` encuentra errores, 1 si ESLint los encuentra.
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import { formatStylish, formatTsc } from "@/lib/apps/checker/format.mjs";
import { catalogo } from "@/lib/apps/dependencias";
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

export function appToolsFor(session: Pick<AgentSession, "app">, deps: Pick<AgentDeps, "checkApp">): AppTools | undefined {
  const app = session.app;
  const check = deps.checkApp;
  if (!app || !check) return undefined;
  return {
    // Todo lo que se puede importar, también los `@radix-ui/react-*` que el
    // manual no lista (son los que instala shadcn).
    catalogSpecifiers: (catalogo(app.catalogo)?.dependencias ?? []).map((d) => d.especificador),
    // Y los @types que trae su paquete de tipos: `npm install -D @types/react` ya está.
    typesPackages: typesPackagesOf(app.catalogo),
    run: async (program, args, ficheros) => {
      const fuentes = Object.fromEntries(Object.entries(ficheros).filter(([ruta]) => isPublishableFolderPath(ruta)));
      const r = await check(fuentes, app.catalogo);
      if (!r) return { stdout: "", stderr: `${program}: didn't finish in time; try again.\n`, exitCode: 1 };
      if (program === "tsc") return { stdout: formatTsc(r.typescript), stderr: "", exitCode: r.typescript.length > 0 ? 2 : 0 };
      const rutas = args.filter((a) => !a.startsWith("-"));
      const ds = r.eslint.filter((d) => dentroDe(rutas, d.ruta));
      return { stdout: formatStylish(ds), stderr: "", exitCode: ds.some((d) => d.gravedad === "Error") ? 1 : 0 };
    },
  };
}
