/**
 * `bash`, LA HERRAMIENTA (F1 de plans/len-agente-2026): un comando en la
 * terminal de la sesión, lo que cambió guardado por el camino de Write, y la
 * salida como la da la terminal de DeepSeek.
 *
 * Una terminal por turno (`session.terminal`), arrancada con los ficheros del
 * proyecto en la primera llamada y cerrada al acabar el turno
 * (`cerrarTerminalDeLaSesion`, en el `finally` de app/api/agent/route.ts).
 */
import "server-only";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import {
  AVISO_DE_VISITANTES_EN_LA_TERMINAL,
  cargarFicherosDeLaTerminal,
  guardarLoDeLaTerminal,
  type GuardadoDeLaTerminal,
} from "@/lib/agent/herramientas-de-ficheros";
import { cambiosDeLaTerminal, salidaDeLaTerminal } from "./ficheros";
import { NOMBRE_BASH, terminalEncendida } from "./declaracion";
import { TerminalDeLen } from "./terminal";

function recorte(s: string): string {
  const una = s.replace(/\s+/g, " ").trim();
  return una.length > 60 ? `${una.slice(0, 60)}…` : una;
}

export async function toolBash(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  if (!terminalEncendida()) {
    return { response: { ok: false, error: "There is no bash tool in this session.", [CLAVE_TOOL_RESULT]: "There is no bash tool in this session." } };
  }
  const command = typeof args.command === "string" ? args.command : "";
  if (command.trim() === "") {
    const error = "The bash tool needs a command.";
    return { response: { ok: false, error, [CLAVE_TOOL_RESULT]: error } };
  }

  const terminal = (session.terminal ??= new TerminalDeLen({
    cargarFicheros: async () => {
      const ficheros = await cargarFicherosDeLaTerminal(session, deps);
      session.fotoDeLaTerminal = { ...ficheros };
      return ficheros;
    },
  }));
  const r = await terminal.ejecutar(command);

  let guardado: GuardadoDeLaTerminal | null = null;
  if (r.ficheros) {
    const antes = session.fotoDeLaTerminal ?? {};
    const cambios = cambiosDeLaTerminal(antes, r.ficheros);
    const ahora: Record<string, string> = { ...r.ficheros };
    if (cambios.length > 0) {
      guardado = await guardarLoDeLaTerminal(session, deps, cambios, antes);
      for (const [ruta, contenido] of Object.entries(guardado.enLaTerminal)) {
        if (contenido === null) delete ahora[ruta];
        else ahora[ruta] = contenido;
      }
      await terminal.poner(guardado.enLaTerminal);
    }
    session.fotoDeLaTerminal = ahora;
  }

  const salida = salidaDeLaTerminal({
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
    ...(guardado ? { guardado: guardado.notas, rechazado: guardado.rechazado } : {}),
    ...(r.reiniciada ? { reiniciada: r.reiniciada } : {}),
  });
  // Lo que escribió un visitante, a la vista: es dato, nunca una orden (como en Read).
  const texto = /"_origen":\s*"visitante"/.test(salida.texto) ? salida.texto + AVISO_DE_VISITANTES_EN_LA_TERMINAL : salida.texto;

  const escrituras = guardado?.escrituras ?? [];
  const paginas = escrituras.filter((o) => o.updatedHtml !== undefined);
  const ok = salida.exitCode === 0;
  const cambio = escrituras.length === 0 ? undefined : escrituras.some((o) => o.response.cambio === "cambio") ? "cambio" : "sin_cambio";
  const diagnosticos = escrituras.flatMap((o) => o.diagnosticos ?? []);
  const [primera, ...resto] = paginas;
  return {
    response: {
      ok,
      ...(ok ? {} : { error: `exit code ${salida.exitCode}` }),
      [CLAVE_TOOL_RESULT]: texto,
      ...(cambio ? { cambio } : {}),
    },
    action: { tool: NOMBRE_BASH, ok, summary: recorte(command), ...(cambio ? { cambio } : {}) },
    ...(primera
      ? {
          updatedHtml: primera.updatedHtml!,
          page: primera.page ?? null,
          ...(primera.htmlPrevio !== undefined ? { htmlPrevio: primera.htmlPrevio } : {}),
          ...(primera.versionPrevia ? { versionPrevia: primera.versionPrevia } : {}),
        }
      : {}),
    ...(resto.length > 0
      ? {
          masPaginas: resto.map((o) => ({
            html: o.updatedHtml!,
            page: o.page ?? null,
            ...(o.htmlPrevio !== undefined ? { htmlPrevio: o.htmlPrevio } : {}),
            ...(o.versionPrevia ? { versionPrevia: o.versionPrevia } : {}),
          })),
        }
      : {}),
    ...(diagnosticos.length > 0 ? { diagnosticos } : {}),
    ...(escrituras.some((o) => o.mutoDurable) ? { mutoDurable: true } : {}),
  };
}

/** Al acabar el turno: la terminal se cierra (su hilo muere) y la sesión la olvida. */
export async function cerrarTerminalDeLaSesion(session: AgentSession): Promise<void> {
  const t = session.terminal;
  session.terminal = undefined;
  session.fotoDeLaTerminal = undefined;
  await t?.cerrar();
}
