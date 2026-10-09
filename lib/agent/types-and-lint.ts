// lib/agent/types-and-lint.ts — TIPOS Y LINT TRAS CADA EDICIÓN DE UNA APP, como
// los diagnósticos del LSP en Claude Code (plan 03): sólo lo NUEVO, por el mismo
// canal `<new-diagnostics>` que los errores del compilador.
//
// «Nuevo» es como en `diagnosticosDeLaApp`: lo que no estaba al empezar el turno
// (la línea base se calcula una vez, con `carpetaAlEmpezar`) y no se ha dicho
// ya en este turno. Se espera `budgetMs`; si no llega, se dice con la
// herramienta que lo enseña —en vez de un aviso tardío que podría ser de un
// estado que ya cambió—. No bloquea nada: ni sirve ni publica distinto.
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import { claveDeDiagnostico, type Diagnostico } from "@/lib/agent/diagnosticos";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";

const BUDGET_MS = 3_000;
const TARDE = Symbol("tarde");

/** Sólo los fuentes de la web: ni /memoria, ni las pruebas, ni lo de Supabase. */
function publicable(c: ReadonlyMap<string, string> | Readonly<Record<string, string>>): Record<string, string> {
  const pares = c instanceof Map ? [...c.entries()] : Object.entries(c);
  return Object.fromEntries(pares.filter(([ruta]) => isPublishableFolderPath(ruta)));
}

/** Al empezar un turno de una app, despierta el hilo sin esperarlo, como Claude
 *  Code arranca sus LSP al abrir la sesión: en frío tarda ~2 s (TypeScript,
 *  ESLint y los tipos del catálogo), y la primera edición llega mientras el
 *  modelo piensa —con el hilo ya caliente, cabe en `BUDGET_MS`—. */
export function warmTypesAndLint(session: Pick<AgentSession, "app">, deps: Pick<AgentDeps, "checkApp">): void {
  if (!session.app || !deps.checkApp) return;
  void deps.checkApp({}, session.app.catalogo).catch(() => null);
}

export async function typesAndLintDiagnostics(args: {
  readonly session: AgentSession;
  readonly deps: AgentDeps;
  readonly now: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
  readonly compileErrors: number;
  readonly budgetMs?: number;
}): Promise<Diagnostico[]> {
  const { session, deps } = args;
  const app = session.app;
  if (!app || !deps.checkApp || args.compileErrors > 0) return [];
  const check = deps.checkApp;
  session.typesBaseline ??= (session.carpetaAlEmpezar ? check(publicable(session.carpetaAlEmpezar), app.catalogo) : Promise.resolve(null)).then(
    (r) => new Set(r ? [...r.typescript, ...r.eslint].map(claveDeDiagnostico) : []),
  );
  const ahora = check(publicable(args.now), app.catalogo);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const r = await Promise.race([
    Promise.all([session.typesBaseline, ahora]),
    new Promise<typeof TARDE>((ok) => {
      timer = setTimeout(() => ok(TARDE), args.budgetMs ?? BUDGET_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (r === TARDE) {
    return [
      {
        ruta: app.entrada,
        linea: 1,
        columna: 1,
        gravedad: "Info",
        mensaje: "Type checking and lint didn't finish in time for this change. Run npx tsc --noEmit and npm run lint to see them.",
        codigo: "pending",
        fuente: "typescript",
      },
    ];
  }
  const [base, resultado] = r;
  if (!resultado) return [];
  const entregados = (session.typesDelivered ??= new Set());
  const nuevos: Diagnostico[] = [];
  for (const d of [...resultado.typescript, ...resultado.eslint]) {
    const clave = claveDeDiagnostico(d);
    if (base.has(clave) || entregados.has(clave)) continue;
    entregados.add(clave);
    nuevos.push(d);
  }
  return nuevos;
}
