// lib/agent/types-and-lint.ts — TIPOS Y LINT TRAS CADA EDICIÓN DE UNA APP, como
// los diagnósticos del LSP en Claude Code (plan 03; leído en su binario 2.1.293,
// el registro `ydt` y su `takePending`):
//
//   · al escribir, la herramienta NO espera: olvida lo entregado y lo pendiente
//     de los ficheros que escribió (`clearDeliveredForFile`,
//     `clearPendingForFile`) y lanza el chequeo;
//   · lo que vuelve de un chequeo que ya no es el último se tira («Dropping
//     stale publishDiagnostics»); lo demás queda PENDIENTE, sólo de los ficheros
//     «abiertos» —los que Len escribió—, como un servidor de lenguaje sólo
//     publica los documentos abiertos;
//   · antes de cada llamada al modelo, el bucle recoge lo pendiente
//     (`takeTypesAndLint`): sin lo ya entregado de cada fichero —la identidad
//     lleva el rango, como en Claude Code— y va al mismo `<new-diagnostics>`.
//
// Lo que no llega antes de que el turno acabe se pierde: en Claude Code iría con
// el mensaje siguiente del usuario, y aquí la sesión es de un turno.
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import type { Diagnostico } from "@/lib/agent/diagnosticos";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";

/** El registro de un turno: el `ydt` de Claude Code. */
export interface TypesAndLintState {
  /** El último chequeo lanzado: un resultado de otro anterior es viejo. */
  version: number;
  /** Los ficheros que Len escribió: los únicos de los que se dice algo. */
  readonly abiertos: Set<string>;
  /** Lo ya entregado, por fichero. */
  readonly entregados: Map<string, Set<string>>;
  /** Lo que llegó y aún no se entregó. */
  pendientes: Diagnostico[];
}

/** La identidad de Claude Code (`hdt`): mensaje, gravedad, rango, fuente y código. */
function clave(d: Diagnostico): string {
  return JSON.stringify([d.mensaje, d.gravedad, d.linea, d.columna, d.fuente ?? null, d.codigo ?? null]);
}

function estadoDe(session: AgentSession): TypesAndLintState {
  return (session.typesAndLint ??= { version: 0, abiertos: new Set(), entregados: new Map(), pendientes: [] });
}

/** Tras una escritura de la app: no espera nada. */
export function typesAndLintAfterWrite(args: {
  readonly session: AgentSession;
  readonly deps: AgentDeps;
  readonly now: Readonly<Record<string, string>> | ReadonlyMap<string, string>;
  /** Lo que escribió ESTA herramienta. */
  readonly written: readonly string[];
  /** Lo que el compilador acaba de decir que no compila. */
  readonly compileErrors: number;
}): void {
  const { session, deps } = args;
  const app = session.app;
  if (!app || !deps.checkApp) return;
  const estado = estadoDe(session);
  const escritos = new Set(args.written.filter(isPublishableFolderPath));
  for (const ruta of escritos) {
    estado.abiertos.add(ruta);
    estado.entregados.delete(ruta);
  }
  estado.pendientes = estado.pendientes.filter((d) => !escritos.has(d.ruta));
  // El compilador ya habló de lo que no compila; TypeScript diría lo mismo.
  if (args.compileErrors > 0) return;
  const mia = ++estado.version;
  const pares = args.now instanceof Map ? [...args.now.entries()] : Object.entries(args.now);
  const fuentes = Object.fromEntries(pares.filter(([ruta]) => isPublishableFolderPath(ruta)));
  void deps
    // La marca de la sesión: su petición nueva sustituye a la que aún espera.
    .checkApp(fuentes, app.catalogo, { supersedes: estado })
    .then((r) => {
      if (!r || estado.version !== mia) return;
      estado.pendientes = [...r.typescript, ...r.eslint].filter((d) => estado.abiertos.has(d.ruta));
    })
    .catch(() => undefined);
}

/** Antes de cada llamada al modelo: lo pendiente que no se ha entregado. */
export function takeTypesAndLint(session: Pick<AgentSession, "typesAndLint">): Diagnostico[] {
  const estado = session.typesAndLint;
  if (!estado || estado.pendientes.length === 0) return [];
  const fuera: Diagnostico[] = [];
  for (const d of estado.pendientes) {
    const ya = estado.entregados.get(d.ruta) ?? new Set<string>();
    const k = clave(d);
    if (ya.has(k)) continue;
    ya.add(k);
    estado.entregados.set(d.ruta, ya);
    fuera.push(d);
  }
  estado.pendientes = [];
  return fuera;
}
