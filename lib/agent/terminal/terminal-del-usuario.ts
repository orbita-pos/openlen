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
 * procesos ni red, y lo escrito por el camino de `Write`), con tres diferencias:
 *   · PERSISTE entre comandos, como una terminal de verdad: una por usuario y
 *     proyecto, cerrada a los 10 minutos sin uso.
 *   · Se PONE AL DÍA antes de cada comando con lo guardado: si no, un `sed -i`
 *     sobre su copia vieja desharía en silencio lo que Len o el editor
 *     cambiaron mientras tanto.
 *   · Va con `autor: "usuario"`: no puede meter código que el sitio no tenía
 *     (`javascript-del-usuario.ts`) y su versión dice que fue la terminal.
 * Un comando cada vez por terminal: dos a la vez se pisarían la copia.
 */
import "server-only";

import { realDeps, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
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

export function ejecutarEnLaTerminalDelUsuario(
  projectId: string,
  userId: string,
  command: string,
  deps: AgentDeps = realDeps(),
): Promise<ComandoDelUsuario> {
  const clave = `${userId}\u0000${projectId}`;
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
    await ponerAlDia(a.sesion, deps);
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

/**
 * La copia de la terminal, igual a lo guardado AHORA. La primera vez no hace
 * falta: la terminal carga los ficheros al arrancar.
 */
async function ponerAlDia(sesion: AgentSession, deps: AgentDeps): Promise<void> {
  const foto = sesion.fotoDeLaTerminal;
  if (!sesion.terminal || !foto) return;
  const ahora = await cargarFicherosDeLaTerminal(sesion, deps);
  const cambios: Record<string, string | null> = {};
  for (const [ruta, contenido] of Object.entries(ahora)) if (foto[ruta] !== contenido) cambios[ruta] = contenido;
  for (const ruta of Object.keys(foto)) if (!(ruta in ahora)) cambios[ruta] = null;
  if (Object.keys(cambios).length === 0) return;
  await sesion.terminal.poner(cambios);
  sesion.fotoDeLaTerminal = { ...foto, ...ahora };
  for (const [ruta, contenido] of Object.entries(cambios)) if (contenido === null) delete sesion.fotoDeLaTerminal[ruta];
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
