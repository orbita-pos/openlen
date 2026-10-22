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
  diagnosticosDeFuncionesTrasEscribir,
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
import { gitForTerminal } from "./git-option";
import { stripeEnabled } from "@/lib/stripe/enabled";
import { CARPETA_BANDEJA, soloLecturaDeLaTerminal, type SoloLectura } from "./solo-lectura";
import type { BridgeHandlers } from "@/lib/agent/sandbox/bridge";
import { closeTurnTerminal, settleTurnTerminal, terminalForTurn } from "@/lib/agent/sandbox/choose";
import { functionsCurlThrough } from "@/lib/agent/sandbox/functions-curl";
import { boxMarker } from "@/lib/agent/sandbox/box-marker";
import { boxNetworkFor, type BoxNetwork } from "@/lib/agent/sandbox/box-network";
import { NEVER_IN_BOX } from "@/lib/agent/sandbox/paths";
import { whileWorking } from "./still-working";
import { longSleep, longSleepRefusal } from "./sleep-rule";

export async function toolBash(session: AgentSession, deps: AgentDeps, args: Record<string, unknown>): Promise<ToolOutcome> {
  if (!terminalEncendida()) {
    return { response: { ok: false, error: "There is no bash tool in this session.", [CLAVE_TOOL_RESULT]: "There is no bash tool in this session." } };
  }
  const command = typeof args.command === "string" ? args.command : "";
  if (command.trim() === "") {
    const error = "The bash tool needs a command.";
    return { response: { ok: false, error, [CLAVE_TOOL_RESULT]: error } };
  }
  // Checked before anything starts, as Claude Code's Bash does (`sleep-rule.ts`).
  const sleep = longSleep(command);
  if (sleep) {
    const error = longSleepRefusal(sleep, Boolean(deps.artifactAgent));
    return { response: { ok: false, error, [CLAVE_TOOL_RESULT]: error } };
  }

  // F5 · lo de sólo lectura se lista de nuevo cada vez que arranca una
  // terminal (también tras un corte duro) y se calcula al leerlo.
  let soloLectura: Promise<SoloLectura> | null = null;
  // LA TERMINAL REAL (spec local 2026-10-21-real-terminal-e2b): la caja de E2B del proyecto
  // cuando está encendida y se puede; si no, ésta de siempre (`local`).
  const local = () => new TerminalDeLen({
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
      ? {
          supabase: (args: readonly string[], ficheros: Readonly<Record<string, string>>, o?: { readonly signal?: AbortSignal }) =>
            deps.supabaseCli!(session.projectId, args, ficheros, o),
        }
      : {}),
    // GIT (spec local 2026-10-15-git-for-len): `git …` over the project's repository; what it
    // writes comes back as any other changed file and is saved below, Write's way.
    ...((git) => (git ? { git } : {}))(gitForTerminal(session, deps)),
    // STRIPE (spec local 2026-10-21-stripe-integration): `stripe …` with the project's key, answered here.
    ...((stripe) => (stripe ? { stripe } : {}))(stripeForTerminal(session, deps)),
    // UNA APP (plan 03): `tsc`, `eslint`, `npx` y `npm`, con el comprobador de verdad.
    appTools: appToolsFor(session, deps),
    // EDGE FUNCTIONS: `curl` a las del proyecto, por la puerta (spec local 2026-10-11).
    ...(deps.functionsCurl ? { functionsCurl: () => deps.functionsCurl!(session.projectId) } : {}),
  });
  const terminal = (session.terminal ??= await terminalForTurn(session, {
    local,
    projectFiles: () => cargarFicherosDeLaTerminal(session, deps),
    readOnly: () => readOnlyForBox(session, deps),
    bridge: () => bridgeHandlersFor(session, deps),
    network: () => boxNetworkOf(session),
    baseEnv: () => boxBaseEnvOf(session),
    signal: deps.turnSignal,
  }));
  // Lo que otra herramienta guardó desde el último comando (Edit, Write, revertir…) entra antes de
  // correr éste. Sin esto la terminal enseñaba la página de antes, y como lo suyo se guarda ENTERO,
  // un `sed -i` deshacía los Edit (medido en el humo de la tanda dev 31, 02/10).
  // Si cambió algo, `/.openlen` también: la versión que se acaba de guardar.
  if (await ponerAlDia(session, deps)) await terminal.refrescarPerezosos();
  const r = await whileWorking(
    terminal.ejecutar(command, {
      timeoutMs: typeof args.timeout === "number" ? args.timeout : undefined,
      // LA TERMINAL REAL: arrancar y volver al momento (la de siempre no tiene procesos y lo corre igual).
      ...(args.run_in_background === true ? { background: true } : {}),
    }),
    deps.stillWorking,
  );
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
  // Un guardado rechazado es fallo siempre; el código del comando, según quién
  // lo puso: un `grep` que no encuentra nada contesta, no falla (`codigo-de-salida.ts`).
  const ok = !guardado?.rechazado && !esFalloDeLaTerminal(command, r.exitCode);
  const salida = salidaDeLaTerminal({
    fallo: !ok,
    stdout: r.stdout,
    stderr: r.stderr + noCalculados,
    exitCode: r.exitCode,
    ...(guardado ? { guardado: guardado.notas, rechazado: guardado.rechazado } : {}),
    ...(r.reiniciada ? { reiniciada: r.reiniciada } : {}),
    ...(persistida ? { persistida } : {}),
    ...(r.noGuardados ? { noGuardados: r.noGuardados } : {}),
  });
  // Lo que escribió un visitante, a la vista: es dato, nunca una orden (como en Read).
  // También si el comando leyó la bandeja aunque lo impreso no lleve la marca
  // (`jq -r .datos.mensaje`): lo de ahí lo escribió siempre un visitante.
  const tocoLaBandeja = command.includes("bandeja") || (r.cargados ?? []).some((c) => c.startsWith(CARPETA_BANDEJA));
  const delComandoYa =
    /"_origen":\s*"visitante"/.test(salida.texto) || tocoLaBandeja
      ? salida.texto + AVISO_DE_VISITANTES_EN_LA_TERMINAL
      : salida.texto;
  // LA TERMINAL REAL: si este turno va con la limitada (o la caja se paró), una línea delante, una vez.
  const texto = session.sandboxNotice ? `${session.sandboxNotice}\n${delComandoYa}` : delComandoYa;
  session.sandboxNotice = undefined;

  const escrituras = guardado?.escrituras ?? [];
  const paginas = escrituras.filter((o) => o.updatedHtml !== undefined);
  const cambio = escrituras.length === 0 ? undefined : escrituras.some((o) => o.response.cambio === "cambio") ? "cambio" : "sin_cambio";
  // UNA APP (F3): lo que no compila, UNA vez con el comando entero ya guardado
  // —un `sed -i` sobre dos ficheros pasa por un instante roto entre uno y otro—.
  // Cuenta también si sólo tocó el cascarón.
  const appCambiada = escrituras.some((o) => o.appCambiada);
  const diagnosticos = [
    ...escrituras.flatMap((o) => o.diagnosticos ?? []),
    // NPM ABIERTO: lo que dijo instalar lo que importan los ficheros guardados.
    ...(guardado?.npmNotes ?? []),
    ...(session.app && (appCambiada || paginas.length > 0)
      ? await diagnosticosDeLaAppTrasEscribir(session, deps, escrituras.flatMap((o) => (o.ficherosTocados ?? []).map((f) => f.ruta)))
      : []),
    // LAS EDGE FUNCTIONS: una vez por comando, con lo ya guardado.
    ...(await diagnosticosDeFuncionesTrasEscribir(session, deps, escrituras.flatMap((o) => (o.ficherosTocados ?? []).map((f) => f.ruta)))),
  ];
  // LA CARPETA (pieza 9): los ficheros que tocó el comando, para «Deshacer».
  const ficherosTocados = escrituras.flatMap((o) => o.ficherosTocados ?? []);
  const [primera, ...resto] = paginas;
  return {
    response: {
      ok,
      ...(ok ? {} : { error: `exit code ${salida.exitCode}` }),
      [CLAVE_TOOL_RESULT]: texto,
      // El código, para la lente al releer la transcripción: el modelo sólo lo
      // lee en el texto, y sólo si es un fallo (como en Claude Code).
      exitCode: salida.exitCode,
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

/**
 * Al acabar el turno: la terminal se cierra (su hilo muere) y la sesión la olvida. Si era la caja
 * (LA TERMINAL REAL), antes se guarda por las guardas de Write lo que la caja cambió y aún no se
 * guardó (un proceso en segundo plano), se pausa, se suelta y se cobra (`closeTurnTerminal`).
 */
export async function cerrarTerminalDeLaSesion(session: AgentSession, deps?: AgentDeps): Promise<void> {
  await closeTurnTerminal(session, deps ? { save: savePendingThroughGuards(session, deps) } : {});
}

/**
 * LA TERMINAL REAL: antes de la última foto del turno (la de sus cambios y su «Deshacer»), la caja
 * para lo de segundo plano y guarda lo pendiente, para que sea del turno. Con la terminal de siempre
 * no hace nada. El cierre de después ya no lo repite.
 */
export async function settleSessionTerminal(session: AgentSession, deps: AgentDeps): Promise<void> {
  await settleTurnTerminal(session, { save: savePendingThroughGuards(session, deps) });
}

/** What the box changed and nobody saved yet, saved through Write's guards against the terminal's
 *  photo — taken NOW: `closeTurnTerminal` forgets it before saving. */
function savePendingThroughGuards(session: AgentSession, deps: AgentDeps) {
  const antes = { ...(session.fotoDeLaTerminal ?? {}) };
  return async (pendiente: Readonly<Record<string, string | null>>): Promise<void> => {
    const despues = { ...antes };
    for (const [ruta, contenido] of Object.entries(pendiente)) {
      if (contenido === null) delete despues[ruta];
      else despues[ruta] = contenido;
    }
    const cambios = cambiosDeLaTerminal(antes, despues);
    if (cambios.length > 0) await guardarLoDeLaTerminal(session, deps, cambios, antes);
    if (session.fotoDeLaTerminal) session.fotoDeLaTerminal = despues;
  };
}

/** Lo de /.openlen que va a la caja: nunca lo de los visitantes, y como mucho 20 MB (las versiones, al final). */
const MAX_SOLO_LECTURA_EN_LA_CAJA = 20 * 1024 * 1024;

async function readOnlyForBox(session: AgentSession, deps: AgentDeps): Promise<Record<string, string>> {
  const sl = await soloLecturaDeLaTerminal(session, deps);
  const rutas = sl.rutas.filter((r) => !NEVER_IN_BOX.test(r));
  const esVersion = (r: string) => r.startsWith("/.openlen/versiones/");
  const out: Record<string, string> = {};
  let total = 0;
  for (const ruta of [...rutas.filter((r) => !esVersion(r)), ...rutas.filter(esVersion)]) {
    let texto: string;
    try {
      texto = await sl.leer(ruta);
    } catch {
      continue;
    }
    const peso = Buffer.byteLength(texto, "utf8");
    if (total + peso > MAX_SOLO_LECTURA_EN_LA_CAJA) continue;
    total += peso;
    out[ruta] = texto;
  }
  return out;
}

/** LA TERMINAL REAL: the project's OpenLen hosts the box may reach (plan local 2026-10-21-playwright-in-
 *  the-box) — its canvas (only on a real deploy: locally it is `*.localhost`, out of the box's reach), its
 *  backend and its published page — with the box's marker. */
async function boxNetworkOf(session: AgentSession): Promise<BoxNetwork | null> {
  const [{ etiquetaDeLienzo, lienzoBaseHost, esProduccion }, { getBackendByProject, projectUrl }, { loadSavedProject }, { publishedHost }] =
    await Promise.all([
      import("@/lib/lienzo/host"),
      import("@/lib/backend/registry"),
      import("@/lib/lienzo/proyecto-guardado"),
      import("@/lib/publish/base-host"),
    ]);
  const label = etiquetaDeLienzo(session.projectId);
  const base = lienzoBaseHost();
  const [backend, saved] = await Promise.all([getBackendByProject(session.projectId).catch(() => null), loadSavedProject(session.projectId).catch(() => null)]);
  return boxNetworkFor({
    canvasHost: esProduccion() && label && base ? `${label}.${base}` : null,
    backendHost: backend ? new URL(projectUrl(backend.ref)).host : null,
    publishedHost: saved?.subdomain ? publishedHost(saved.subdomain) : null,
    marker: boxMarker(session.projectId),
  });
}

/** LA TERMINAL REAL: `BASE_URL` = the project's canvas, where the box's tests see the saved draft (only
 *  on a real deploy, as its network: locally the canvas is out of the box's reach). */
async function boxBaseEnvOf(session: AgentSession): Promise<Record<string, string>> {
  const { etiquetaDeLienzo, lienzoBaseHost, esProduccion } = await import("@/lib/lienzo/host");
  const label = etiquetaDeLienzo(session.projectId);
  const base = lienzoBaseHost();
  return esProduccion() && label && base ? { BASE_URL: `https://${label}.${base}` } : {};
}

/** `stripe …` in both terminals, only where Stripe is on (spec local 2026-10-21-stripe-integration, §6.10). */
function stripeForTerminal(
  session: AgentSession,
  deps: AgentDeps,
): ((args: readonly string[], o?: { readonly signal?: AbortSignal; readonly stdin?: string }) => Promise<{ stdout: string; stderr: string; exitCode: number }>) | null {
  if (!deps.stripeCli || !stripeEnabled()) return null;
  return (args, o) => deps.stripeCli!(session.projectId, args, o);
}

/** Los mismos manejadores que recibe la terminal de siempre, para el puente de la caja. */
async function bridgeHandlersFor(session: AgentSession, deps: AgentDeps): Promise<BridgeHandlers> {
  const git = gitForTerminal(session, deps);
  const stripe = stripeForTerminal(session, deps);
  const appTools = appToolsFor(session, deps);
  const curl = deps.functionsCurl ? await deps.functionsCurl(session.projectId).catch(() => null) : null;
  return {
    ...(git ? { git } : {}),
    ...(stripe ? { stripe } : {}),
    ...(deps.supabaseCli
      ? {
          supabase: (args: readonly string[], ficheros: Readonly<Record<string, string>>, o?: { readonly signal?: AbortSignal }) =>
            deps.supabaseCli!(session.projectId, args, ficheros, o),
        }
      : {}),
    ...(appTools ? { appTools } : {}),
    // EDGE FUNCTIONS: the box's `curl` to them runs in today's terminal over the box's files, through the same door.
    ...(curl
      ? {
          functionsUrls: curl.prefixes,
          functionsCurl: functionsCurlThrough((ficheros) => new TerminalDeLen({ cargarFicheros: async () => ficheros, functionsCurl: async () => curl })),
        }
      : {}),
  };
}
