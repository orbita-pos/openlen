/**
 * `bash`, LA HERRAMIENTA (F1 de plans/len-agente-2026): un comando en la
 * terminal de la sesión, lo que cambió guardado por el camino de Write, y la
 * salida como la da la terminal de DeepSeek.
 *
 * Una terminal por turno (`session.terminal`), arrancada con los ficheros del
 * proyecto en la primera llamada, puesta al día antes de cada comando con lo
 * que guardaron las demás herramientas, y cerrada al acabar el turno
 * (`cerrarTerminalDeLaSesion`, en el `finally` de app/api/agent/route.ts).
 */
import "server-only";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import {
  AVISO_DE_VISITANTES_EN_LA_TERMINAL,
  cargarFicherosDeLaTerminal,
  diagnosticosDeLaAppTrasEscribir,
  guardarLoDeLaTerminal,
  type GuardadoDeLaTerminal,
} from "@/lib/agent/herramientas-de-ficheros";
import { MAX_SALIDA, cambiosDeLaTerminal, salidaDeLaTerminal } from "./ficheros";
import { CLAVE_CAMBIOS_DEL_COMANDO, cambiosDelComando, type CambiosDelComando } from "./cambios-del-comando";
import { NOMBRE_BASH, terminalEncendida } from "./declaracion";
import { esFalloDeLaTerminal } from "./codigo-de-salida";
import { resumenDelComando } from "./resumen-del-comando";
import { TerminalDeLen } from "./terminal";
import { appToolsFor } from "./herramientas-de-app";
import { CARPETA_BANDEJA, soloLecturaDeLaTerminal, type SoloLectura } from "./solo-lectura";

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
    // `supabase …`: lo que crea (una migración nueva) vuelve como cualquier otro
    // fichero cambiado y se guarda abajo, por el camino de Write.
    ...(deps.supabaseCli
      ? { supabase: (args: readonly string[], ficheros: Readonly<Record<string, string>>) => deps.supabaseCli!(session.projectId, args, ficheros) }
      : {}),
    // UNA APP (plan 03): `tsc`, `eslint`, `npx` y `npm`, con el comprobador de verdad.
    appTools: appToolsFor(session, deps),
  }));
  // Lo que otra herramienta guardó desde el último comando (Edit, Write, revertir…) entra antes de
  // correr éste. Sin esto la terminal enseñaba la página de antes, y como lo suyo se guarda ENTERO,
  // un `sed -i` deshacía los Edit (medido en el humo de la tanda dev 31, 02/10).
  // Si cambió algo, `/.openlen` también: la versión que se acaba de guardar.
  if (await ponerAlDia(session, deps)) await terminal.refrescarPerezosos();
  const r = await terminal.ejecutar(command, { timeoutMs: typeof args.timeout === "number" ? args.timeout : undefined });
  // La salida que no cabe, ENTERA a /tmp (no es del proyecto), como Claude Code.
  let persistida: string | undefined;
  if (r.stdout.length + r.stderr.length > MAX_SALIDA) {
    const ruta = `/tmp/tool-results/${(session.salidasGuardadas = (session.salidasGuardadas ?? 0) + 1)}.txt`;
    try {
      await terminal.poner({ [ruta]: r.stdout + r.stderr });
      persistida = ruta;
    } catch {
      // Sin fichero: el corte, con el aviso de Claude Code.
    }
  }

  let guardado: GuardadoDeLaTerminal | null = null;
  // Lo que cambió, por fichero, para la pantalla (la #10): la foto de antes
  // contra lo que de verdad quedó, ya deshecho lo que las guardas rechazaron.
  let delComando: CambiosDelComando | null = null;
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
      if (guardado.escrituras.length > 0) await terminal.refrescarPerezosos();
      delComando = cambiosDelComando(antes, ahora);
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
    ...(persistida ? { persistida } : {}),
  });
  // Lo que escribió un visitante, a la vista: es dato, nunca una orden (como en Read).
  // También si el comando leyó la bandeja aunque lo impreso no lleve la marca
  // (`jq -r .datos.mensaje`): lo de ahí lo escribió siempre un visitante.
  const tocoLaBandeja = command.includes("bandeja") || (r.cargados ?? []).some((c) => c.startsWith(CARPETA_BANDEJA));
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
  // UNA APP (F3): lo que no compila, UNA vez con el comando entero ya guardado
  // —un `sed -i` sobre dos ficheros pasa por un instante roto entre uno y otro—.
  // Cuenta también si sólo tocó el cascarón.
  const appCambiada = escrituras.some((o) => o.appCambiada);
  const diagnosticos = [
    ...escrituras.flatMap((o) => o.diagnosticos ?? []),
    ...(session.app && (appCambiada || paginas.length > 0)
      ? await diagnosticosDeLaAppTrasEscribir(session, deps, escrituras.flatMap((o) => (o.ficherosTocados ?? []).map((f) => f.ruta)))
      : []),
  ];
  // LA CARPETA (pieza 9): los ficheros que tocó el comando, para «Deshacer».
  const ficherosTocados = escrituras.flatMap((o) => o.ficherosTocados ?? []);
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
      // Para la lente y la tarjeta, nunca para el modelo: no es `tool_result`.
      ...(delComando ? { [CLAVE_CAMBIOS_DEL_COMANDO]: delComando } : {}),
    },
    action: { tool: NOMBRE_BASH, ok, summary: resumenDelComando(command), ...(cambio ? { cambio } : {}) },
    terminal: { command, salida: texto, exitCode: salida.exitCode, ...(delComando ? { cambios: delComando } : {}) },
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
    ...(appCambiada ? { appCambiada: true as const } : {}),
    ...(ficherosTocados.length > 0 ? { ficherosTocados } : {}),
    ...(escrituras.some((o) => o.mutoDurable) ? { mutoDurable: true } : {}),
  };
}

/**
 * La copia de la terminal, igual a lo guardado AHORA. La primera vez no hace
 * falta: la terminal carga los ficheros al arrancar. Dice si cambió algo.
 */
async function ponerAlDia(sesion: AgentSession, deps: AgentDeps): Promise<boolean> {
  const foto = sesion.fotoDeLaTerminal;
  if (!sesion.terminal || !foto) return false;
  const ahora = await cargarFicherosDeLaTerminal(sesion, deps);
  const cambios: Record<string, string | null> = {};
  for (const [ruta, contenido] of Object.entries(ahora)) if (foto[ruta] !== contenido) cambios[ruta] = contenido;
  for (const ruta of Object.keys(foto)) if (!(ruta in ahora)) cambios[ruta] = null;
  if (Object.keys(cambios).length === 0) return false;
  await sesion.terminal.poner(cambios);
  sesion.fotoDeLaTerminal = { ...foto, ...ahora };
  for (const [ruta, contenido] of Object.entries(cambios)) if (contenido === null) delete sesion.fotoDeLaTerminal[ruta];
  return true;
}

/** Al acabar el turno: la terminal se cierra (su hilo muere) y la sesión la olvida. */
export async function cerrarTerminalDeLaSesion(session: AgentSession): Promise<void> {
  const t = session.terminal;
  session.terminal = undefined;
  session.fotoDeLaTerminal = undefined;
  await t?.cerrar();
}
