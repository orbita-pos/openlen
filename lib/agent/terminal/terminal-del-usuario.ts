/**
 * LA TERMINAL DEL USUARIO (la #17 de plans/len-agente-2026/notas/fase-5-taller.md).
 *
 * Como la de DeepSeek (`2026-09-09-web-sidebar-terminal.md`,
 * `2026-09-16-user-terminal-permissions.md`): una terminal TUYA, aparte de la de
 * Len, sobre los mismos ficheros; lo que escribes e imprimes en ella no le llega
 * al modelo ni crea nada en la conversación. Lo que CAMBIA en los ficheros sí lo
 * ve Len en su siguiente turno: el sitio es uno.
 *
 * Es la misma maquinaria que la de Len (`toolBash`: just-bash en su hilo, sin
 * procesos ni red, lo escrito por el camino de `Write`, y puesta al día antes de
 * cada comando con lo guardado: aquí, lo que Len o el editor cambiaron mientras
 * tanto), con dos diferencias:
 *   · PERSISTE entre comandos, como una terminal de verdad: una por usuario y
 *     proyecto, cerrada a los 10 minutos sin uso.
 *   · Va con `autor: "usuario"`: su versión dice que fue la terminal. Escribe
 *     JavaScript como cualquier otro texto desde el 2026-10-07 (el ⚰️ de
 *     `guardarEnLaCarpeta` en herramientas-de-ficheros.ts).
 * Un comando cada vez por terminal: dos a la vez se pisarían la copia.
 */
import "server-only";

import { realDeps, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { cerrarTerminalDeLaSesion, toolBash } from "./herramienta";
import type { CambiosDelComando } from "./cambios-del-comando";

/** Sin un comando en este tiempo, la terminal se cierra (su hilo muere). */
export const TERMINAL_INACTIVA_MS = 10 * 60_000;
/** Terminales abiertas a la vez en el servidor, como mucho: se cierra la más vieja. */
const MAX_ABIERTAS = 100;

interface Abierta {
  readonly clave: string;
  readonly sesion: AgentSession;
  cola: Promise<unknown>;
  reloj: ReturnType<typeof setTimeout> | null;
  usada: number;
}

const abiertas = new Map<string, Abierta>();

export interface ComandoDelUsuario {
  readonly command: string;
  readonly salida: string;
  readonly exitCode: number;
  /** Cambió algún fichero: el lienzo tiene que volver a leer el proyecto. */
  readonly cambio: boolean;
  /** Lo que cambió, por fichero (la #10), para la lente. */
  readonly cambios?: CambiosDelComando;
}

/**
 * `userId` es el DUEÑO del proyecto (con él se leen y guardan los ficheros);
 * `quien`, la persona que teclea: un miembro del proyecto tiene su propia
 * terminal, no la del dueño (compartir el proyecto, lib/projects/acceso.ts).
 */
export function ejecutarEnLaTerminalDelUsuario(
  projectId: string,
  userId: string,
  command: string,
  deps: AgentDeps = realDeps(),
  quien: string = userId,
): Promise<ComandoDelUsuario> {
  const clave = `${quien}\u0000${projectId}`;
  let a = abiertas.get(clave);
  if (!a) {
    if (abiertas.size >= MAX_ABIERTAS) {
      const vieja = [...abiertas.values()].sort((x, y) => x.usada - y.usada)[0];
      if (vieja) void cerrar(vieja);
    }
    a = {
      clave,
      sesion: {
        projectId,
        userId,
        // Su memoria personal es la suya, no la del dueño (lib/agent/person.ts).
        ...(quien !== userId ? { personId: quien } : {}),
        autor: "usuario",
        page: null,
        ownerEmail: null,
        imageEditsThisTurn: 0,
        photoSearchesThisTurn: 0,
        busquedasVaciasSeguidas: 0,
      },
      cola: Promise.resolve(),
      reloj: null,
      usada: Date.now(),
    };
    abiertas.set(clave, a);
  }
  const abierta = a;
  const turno = abierta.cola.then(() => correr(abierta, deps, command));
  abierta.cola = turno.catch(() => undefined);
  return turno;
}

async function correr(a: Abierta, deps: AgentDeps, command: string): Promise<ComandoDelUsuario> {
  if (a.reloj) clearTimeout(a.reloj);
  a.usada = Date.now();
  try {
    // UNA APP: lo que es el proyecto AHORA. Sin `app` la sesión trataba una app
    // como una página —sin npm, npx tsc ni las pruebas que sí tiene la terminal
    // de Len en el mismo panel, y con las guardas y los diagnósticos de una
    // página— (ensayo de caja del 09/10). Se lee en cada comando: una página
    // puede convertirse en app con la terminal abierta, y entonces la terminal
    // renace con los comandos de la app.
    const app = (await deps.loadProject(a.sesion.projectId, a.sesion.userId))?.data.app ?? null;
    if (JSON.stringify(app) !== JSON.stringify(a.sesion.app ?? null)) {
      await cerrarTerminalDeLaSesion(a.sesion);
      a.sesion.app = app;
    }
    const out = await toolBash(a.sesion, deps, { command });
    const cambio =
      out.updatedHtml !== undefined ||
      (out.masPaginas?.length ?? 0) > 0 ||
      out.mutoDurable === true ||
      out.response.cambio === "cambio";
    if (!out.terminal) {
      const texto = out.response[CLAVE_TOOL_RESULT] ?? out.response.error ?? "";
      return { command, salida: String(texto), exitCode: 1, cambio: false };
    }
    return {
      command,
      salida: out.terminal.salida,
      exitCode: out.terminal.exitCode,
      cambio,
      ...(out.terminal.cambios ? { cambios: out.terminal.cambios } : {}),
    };
  } finally {
    a.reloj = setTimeout(() => void cerrar(a), TERMINAL_INACTIVA_MS);
    a.reloj.unref?.();
  }
}

async function cerrar(a: Abierta): Promise<void> {
  if (a.reloj) clearTimeout(a.reloj);
  if (abiertas.get(a.clave) === a) abiertas.delete(a.clave);
  await cerrarTerminalDeLaSesion(a.sesion);
}

/** Para las pruebas: cierra todas. */
export async function cerrarLasTerminalesDelUsuario(): Promise<void> {
  await Promise.all([...abiertas.values()].map(cerrar));
}
