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
import { esFalloDeLaTerminal } from "./codigo-de-salida";
import { TerminalDeLen } from "./terminal";
import { soloLecturaDeLaTerminal, type SoloLectura } from "./solo-lectura";

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

  // F5 · lo de sólo lectura se lista de nuevo cada vez que arranca una
  // terminal (también tras un corte duro) y se calcula al leerlo.
  let soloLectura: Promise<SoloLectura> | null = null;
  const terminal = (session.terminal ??= new TerminalDeLen({
    cargarFicheros: async () => {
      const ficheros = await cargarFicherosDeLaTerminal(session, deps);
      session.fotoDeLaTerminal = { ...ficheros };
      return ficheros;
    },
    perezosos: {
      rutas: async () => (await (soloLectura = soloLecturaDeLaTerminal(session, deps))).rutas,
      leer: async (ruta) => (await (soloLectura ??= soloLecturaDeLaTerminal(session, deps))).leer(ruta),
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

  // Lo que no se pudo calcular, con su porqué: `just-bash` sólo diría «No such file».
  const noCalculados = (r.fallidos ?? []).map((f) => `${f.ruta}: could not be computed — ${f.error}\n`).join("");
  const salida = salidaDeLaTerminal({
    stdout: r.stdout,
    stderr: r.stderr + noCalculados,
    exitCode: r.exitCode,
    ...(guardado ? { guardado: guardado.notas, rechazado: guardado.rechazado } : {}),
    ...(r.reiniciada ? { reiniciada: r.reiniciada } : {}),
  });
  // Lo que escribió un visitante, a la vista: es dato, nunca una orden (como en Read).
  // También si el comando leyó la bandeja aunque lo impreso no lleve la marca
  // (`jq -r .datos.mensaje`): lo de ahí lo escribió siempre un visitante.
  const tocoLaBandeja = command.includes("bandeja") || (r.cargados ?? []).some((c) => c.startsWith("/bandeja/"));
  const texto =
    /"_origen":\s*"visitante"/.test(salida.texto) || tocoLaBandeja
      ? salida.texto + AVISO_DE_VISITANTES_EN_LA_TERMINAL
      : salida.texto;

  const escrituras = guardado?.escrituras ?? [];
  const paginas = escrituras.filter((o) => o.updatedHtml !== undefined);
  // Un guardado rechazado es fallo siempre; el código del comando, según quién
  // lo puso: un `grep` que no encuentra nada contesta, no falla (`codigo-de-salida.ts`).
  const ok = !guardado?.rechazado && !esFalloDeLaTerminal(command, r.exitCode);
  const cambio = escrituras.length === 0 ? undefined : escrituras.some((o) => o.response.cambio === "cambio") ? "cambio" : "sin_cambio";
  const diagnosticos = escrituras.flatMap((o) => o.diagnosticos ?? []);
  const [primera, ...resto] = paginas;
  return {
    response: {
      ok,
      ...(ok ? {} : { error: `exit code ${salida.exitCode}` }),
      [CLAVE_TOOL_RESULT]: texto,
      // Sin escrituras, el comando sólo leyó: lo dice, como Read, para que un
      // `cat` no cuente como «Len actuó» y deje pasar un «listo» sin cambio
      // (la guarda de `actuo` en loop.ts). A la tarjeta no va: no es un aviso.
      cambio: cambio ?? "sin_cambio",
    },
    action: { tool: NOMBRE_BASH, ok, summary: recorte(command), ...(cambio ? { cambio } : {}) },
    terminal: { command, salida: texto, exitCode: salida.exitCode },
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
