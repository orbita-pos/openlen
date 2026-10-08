import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { accesoAlProyecto, puede } from "@/lib/projects/acceso";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import { hiloDelProyecto, mencionesValidas, personasDelProyecto, respuestaDeLen } from "@/lib/projects/hilos";
import { apuntarMencionesDelTurno } from "@/lib/projects/chat-equipo";
import { mencionesDe } from "@/lib/workspace-v2/menciones";
import { registrarCorredorDeTurnos, type PedidoDelHilo } from "@/lib/agent/turnos-desde-el-servidor";
import { cabeEnElTope, margenDeMiembros, sumarGasto } from "@/lib/projects/miembros";
import { correoDelUsuario } from "@/lib/movil/llaves";
import type { InlineImage } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { credencialDelTurno, faltaCredencial } from "@/lib/ai/turn-credentials";
import {
  getCreditState,
  noCreditsMessage,
  debitCredits,
  creditsForUsage,
  techoDelTurno,
} from "@/lib/credits";
import { stripOpIds } from "@/lib/html-ops";
import { seleccionDelLienzo } from "@/lib/agent/seleccion-del-lienzo";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { scriptDelDocumento } from "@/lib/page-engine/conservar-scripts";
import { persistPage } from "@/lib/page-engine/persist";
import { buildAgentMessages } from "@/lib/agent/context";
import { formaDelTurno, lineaDeForma } from "@/lib/agent/forma-del-turno";
import {
  creaGrabadora,
  directorioDeGrabacion,
  nombreDeFichero,
} from "@/lib/agent/grabacion";
import { getUserMemoryBounded } from "@/lib/agent/user-memory";
import { memoriaSembrada } from "@/lib/agent/ficheros/memoria";
import { leerFichero, sinOpIds } from "@/lib/agent/ficheros/sitio";
import {
  NO_CABE,
  historialDesdeLaBase,
  leidosSembrados,
  stateOnlyTranscript,
  transcripcionParaGuardar,
  type FilaDelHistorial,
  type MensajeDelHistorial,
} from "@/lib/agent/transcripcion";
import { conseguirFotos, fotosQueCaben } from "@/lib/agent/fotos-de-la-conversacion";
import { filasParaElHistorialConEquipo, turnosParaElHistorial } from "@/lib/projects/chat";
import { plegarEquipo } from "@/lib/agent/plegar-equipo";
import { quienPide } from "@/lib/agent/equipo";
import { parseStyleDirection } from "@/lib/style-match/parse-direction";
import { MAX_PHOTOS_PER_MESSAGE, photosForRow, photosOf, type ChatPhoto } from "@/lib/projects/chat-photos";
import type { Message } from "@/lib/ai-gateway";
import { ESFUERZOS } from "@/lib/agent/esfuerzo";
import { DYNAMIS_MAX_OUTPUT_TOKENS, modeOfTurn } from "@/lib/agent/dynamis";
import { resolveCompaction } from "@/lib/agent/compaction/policy";
import { SPILL_MAX_INLINE_TOKENS } from "@/lib/agent/compaction/spill";
import { NOMBRE_BASH, terminalEncendida } from "@/lib/agent/terminal/declaracion";
import { getEsfuerzoGuardado } from "@/lib/agent/esfuerzo-guardado";
import { ZONA_SIN_DATO, zonaValida } from "@/lib/resultados/zona";
import { guardarZona, leerZona } from "@/lib/resultados/zona-guardada";
import { getVersionHtml, listVersions } from "@/lib/projects/versions";
import { loQueCambioElDueno } from "@/lib/agent/cambios-del-dueno";
import { cambiosParaElAgente } from "@/lib/projects/cambios-para-el-agente";
import { runAgentLoop, type AgentErrorCode, type AgentLoopResult } from "@/lib/agent/loop";
import { randomUUID } from "node:crypto";

import { abrirTurno, cerrarTurno, esperarRespuesta, leerDireccion, rondaSiguiente } from "@/lib/agent/direcciones";
import { ASK_USER_TIMEOUT_MS, type UserQuestion } from "@/lib/agent/ask-user-question";
import { planModeFromRows, resolveTurnPlanMode, withPlanSection } from "@/lib/agent/plan-mode";
import {
  GoalError,
  blockGoal,
  createGoal,
  goalFromRows,
  goalRoundPrompt,
  pauseGoal,
  resumeGoal,
  startRound,
  type GoalSnapshot,
} from "@/lib/agent/goal";
import { armGoal, disarmGoal, goalActivation } from "@/lib/agent/goal-activation";
import { crearDiarioDelTurno } from "@/lib/agent/diario-del-turno";
import { corteDelTurno, crearRegistroDelTurno } from "@/lib/agent/registro-del-turno";
import {
  abrirFilaDelTurno,
  avanceDelTurno,
  quitarFilaDelTurno,
  registrarTurnoDelServidor,
} from "@/lib/projects/chat";
import { crearAvance } from "@/lib/agent/avance-del-turno";
import { avisoDelTurno } from "@/lib/agent/aviso-del-turno";
import { streamWithRetry } from "@/lib/agent/retry";
import { conSenales, relojDeSilencio } from "@/lib/agent/reloj-de-silencio";
import { realDeps, runAgentTool, summarizeProjectState, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import { cerrarTerminalDeLaSesion } from "@/lib/agent/terminal/herramienta";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { cambiosEntreFotos } from "@/lib/agent/cambios-del-turno";
import { cambiosDelTurnoParaDeshacer, conForma } from "@/lib/projects/deshacer-turno-plan";
import { guardarCambiosDelTurno } from "@/lib/projects/deshacer-turno";
import { nacerComoApp } from "@/lib/projects/nacer-como-app";
import { observarPagina } from "@/lib/agent/verify";
import { usarPagina } from "@/lib/agent/usar-pagina";
import {
  createVisualQualityRendererPool,
  renderVisualQualityViewports,
  type VisualQualityRenderOptions,
  type VisualQualityRendererPool,
  type VisualQualityViewports,
} from "@/lib/ai/visual-quality-renderer";
import {
  sanearDichoAntes,
  sanearHistorial,
  turnoAnteriorMudoDe,
  turnosTotalesDe,
  ventanaVisibleDe,
} from "@/lib/agent/historial-saneado";
import { medirUnaVezPorDocumento } from "@/lib/ai/medir-una-vez";
import { recordAgentEyes } from "@/lib/ai/quality-metrics";
import { jsonResponse, sseChannel } from "@/lib/ai/sse";
import { MAX_PROMPT } from "@/lib/workspace-v2/comentarios-de-lineas";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent — the OpenLen Agent's agentic loop (F1 Task 9).
//
// Body: { projectId, prompt, history?, attachedImage?, attachedImages?, scope? }
// attachedImage/scope validated with the same limits/posture as
// /api/templates/ai-design (F2 Task 8) — see the constants + validation
// block below.
//
// Streams Server-Sent Events as the model reasons + calls tools:
//   - text   { text }                                — assistant prose delta
//   - action { tool, status, summary }                — tool call lifecycle
//   - html   { html }                                 — refreshed doc after editar_pagina
//   - done   { turns, toolCalls }                      — terminal, synthesized by
//                                                        THIS route (runAgentLoop
//                                                        never emits its own `done`)
//   - error  { message, code? }                        — code (F2-T10) lets
//                                                        the panel localize;
//                                                        message stays as the
//                                                        Spanish fallback.
//
// Aqui decia «Provider: Gemini Flash only»; Gemini salio de los cuatro papeles
// el 2026-08-28. Quien razona lo elige `model-policy.ts`. Las tool calls
// (Read / Edit / Write, y las del catálogo) do the heavy lifting; the model itself
// only needs to reason + dispatch, so there's no Pro tier here (unlike
// ai-design, which lets the user pick).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

/** H4 · cuántos turnos de la base forman el historial. Los mismos ~12 que
 *  cabían en la ventana del navegador (36 mensajes); lo que pesa lo acota el
 *  microcompact (`PRESUPUESTO_DE_RESULTADOS`), no este número. */
const TURNOS_DEL_HISTORIAL = 12;
const ENCODER = new TextEncoder();
// ⚰️ Aquí vivía `STREAM_TIMEOUT_MS = 360_000`, un reloj de PARED: el turno se
// abortaba a los 6 minutos trabajara o no. Retirado con los topes (H1,
// 2026-09-25): Claude Code no pone plazo a un turno. Lo que corta un cuelgue es
// el SILENCIO — `relojDeSilencio` se rearma con cada evento del modelo y con
// cada cosa que se le manda al dueño, y sólo aborta tras `SILENCIO_MS` sin
// ninguna. 3 minutos: más que cualquier llamada sana al modelo o que los ojos
// (un arranque de Chromium y una llamada con visión).
const SILENCIO_MS = 180_000;
// 🔴 CADA CUÁNTO LATE EL TURNO CUANDO NO TIENE NADA QUE DECIR.
//
// El techo de arriba acota un turno ETERNO. Esto acota uno MUDO, que es un
// fallo distinto y el que nos costó un turno de verdad el 2026-09-15: una
// medición que no volvía dejó el stream abierto y callado, y a los 90 segundos
// EXACTOS Caddy cortó la respuesta a medias (`read_timeout 90s` en su
// transporte hacia Next, infra/caddy/Caddyfile). El usuario leyó «network
// error» sobre un turno que había guardado bien.
//
// 15 s da SEIS latidos de margen antes de ese muro. El latido es un comentario
// SSE —sin `data:`— así que no le llega al cliente como nada; la mecánica y su
// porqué viven en `sseChannel` (lib/ai/sse.ts), que es donde tiene que estar
// para que la cuarta superficie no tenga que acordarse.
const LATIDO_MS = 15_000;
// LA VENTANA REAL DEL MODELO en Fireworks (deepseek-v4p1-flash: 1.048.576
// tokens, fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash, leído el
// 04/10/2026). Sólo un turno que no cabe AHÍ se rechaza al empezar. El techo de
// 240.000 que había venía del 07/07, de cuando Len era Gemini Flash
// (`7b38e227`, «Same ceiling as ai-design»).
const MODEL_WINDOW_TOKENS = 1_048_576;
// La salida más grande de los dos modos (Dynamis pide 65.536; Len, 32.768): el
// umbral vale para los dos.
const MAX_LOOP_OUTPUT_TOKENS = DYNAMIS_MAX_OUTPUT_TOKENS;
const MAX_PROMPT_TOKENS = MODEL_WINDOW_TOKENS - MAX_LOOP_OUTPUT_TOKENS;
// DÓNDE EMPIEZA A COMPACTAR (pieza 2 de Len 2.5): sobre la ventana REAL del
// modelo, como DeepSeek, que deriva su umbral del `contextWindow` del modelo
// (1.000.000 en su catálogo para este mismo DeepSeek-V41-Flash,
// packages/llm/llm-deepseek/src/defaults.ts @ 5badb15). Jesús, 05/10: las dudas
// se deciden como DeepSeek o Claude Code. ⚰️ Era una «ventana efectiva» de
// 240.000 elegida por coste, pendiente de él. El coste de un turno largo lo
// sigue acotando el techo de dinero del turno (`techoDelTurno`).
const COMPACTION_POLICY = resolveCompaction({
  windowTokens: MODEL_WINDOW_TOKENS,
  maxOutputTokens: MAX_LOOP_OUTPUT_TOKENS,
});

// F2 Task 8 — attached image + scope, validated with the SAME limits/posture
// as app/api/templates/ai-design/route.ts (read that file first if editing
// this block): outerHtml is only size-capped (unused otherwise, kept for
// parity/defense-in-depth), hint/path are trimmed+capped, and a bad
// attachment is silently dropped rather than 400ing the whole turn.
interface ScopeBody {
  outerHtml?: string;
  hint?: string;
  /** CSS-selector breadcrumb from the iframe's section-select script. When it
   *  resolves, `seleccionDelLienzo` turns it into LINES of the file (fichero +
   *  desde–hasta + el texto), como la selección de líneas de Claude Code;
   *  if it does not, the hint travels alone. The model never sees an id. */
  path?: string;
}

interface AttachedImageBody {
  url?: string;
  alt?: string;
}

const SCOPE_OUTER_MAX = 50_000;
const ATTACHED_URL_MAX = 2_000;
const ATTACHED_ALT_MAX = 300;

export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  // F4 Task 7 — emergency kill-switch: OPENLEN_AGENT=0 refuses BEFORE any
  // auth/credit/stream work, in the SAME coded-SSE-error shape (F2-T10)
  // every other agent error uses — a 200 stream with a single `error`
  // event — so the panel's existing SSE reader picks it up without a
  // special-cased non-2xx path. The panel (chat-panel.tsx) intercepts
  // `code: "agent_off"` and silently re-sends the same turn through
  // classic ai-design instead of showing an error.
  if (process.env.OPENLEN_AGENT === "0") {
    const code: AgentErrorCode = "agent_off";
    const sse = `event: error\ndata: ${JSON.stringify({
      message: "El Agente está desactivado temporalmente.",
      code,
    })}\n\n`;
    return new Response(ENCODER.encode(sse), {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  }

  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return errorJson(401, "unauthorized");

  const body = (await req.json().catch(() => null)) as CuerpoDelTurno | null;
  // Lo que el turno guarde (versiones de páginas y ficheros) lleva el nombre de
  // quien lo pidió: un miembro, si no fue el dueño (lib/projects/autor-del-cambio.ts).
  return conAutor(userId, () => correrTurno(userId, body, { url: req.url, signal: req.signal }));
});

/** Lo que manda el cliente en el cuerpo de un turno. Todo entra de fuera y se sanea abajo. */
type CuerpoDelTurno = {
  projectId?: string;
  prompt?: string;
  page?: string;
  /** Id de la fila de la transcripción, elegido por el cliente. Ver abajo. */
  turnId?: string;
  history?: {
    role: "user" | "assistant";
    content: string;
    functionCalls?: unknown;
    functionResponses?: unknown;
  }[];
  /** Cuántos turnos tiene la conversación entera (el cliente sólo manda los
   *  últimos). Sólo sirve para avisarle al modelo de que no lo ve todo. */
  historyTotal?: number;
  /** Lo que el dueño dijo en los turnos que ya no caben (H08-a). Se sanea
   *  con `sanearDichoAntes`: aquí es `unknown` a efectos prácticos. */
  dichoAntes?: unknown;
  scope?: ScopeBody;
  attachedImage?: AttachedImageBody;
  /** Crear es Len: hasta `MAX_PHOTOS_PER_MESSAGE` fotos en un mensaje. */
  attachedImages?: unknown;
  /** Crear es Len: la referencia por URL, validada con `parseStyleDirection`. */
  styleDirection?: unknown;
  /** EL ESFUERZO DE ESTE TURNO, fijado por el cliente al ENVIAR. Ver
   *  `esfuerzoDelTurno` más abajo: se manda por turno, no se lee en vivo. */
  esfuerzo?: unknown;
  /** EL MODO DE ESTE TURNO: `"dynamis"` o nada (Len). Viaja como el esfuerzo;
   *  se sanea con `modeOfTurn` (`lib/agent/dynamis.ts`). */
  mode?: unknown;
  /** La zona IANA del navegador (plans/len-resultados/diseno.md §7). Se
   *  sanea con `zonaValida`: entra de fuera. */
  zonaHoraria?: unknown;
  /** Pieza 3 de Len 2.5: el cliente SABE contestar las preguntas de
   *  `ask_user_question` dentro del turno (el chat). La voz y Len-Bench no lo
   *  mandan: para ellos la pregunta sigue cerrando el turno. */
  answersQuestions?: unknown;
  /** Pieza 7: el modo plan que el dueño veía al mandar (la ficha «Plan» del
   *  compositor). Sólo `true`/`false` cuentan; sin él, lo plegado. */
  plan?: unknown;
  /** Pieza 8: la puerta del dueño al encargo — `"create"` (la opción «Encargo»:
   *  el mensaje es el objetivo) o `"resume"` («Reanudar»). Otra cosa no cuenta. */
  goal?: unknown;
  /** UNA APP NACE (H10 de la spec local 2026-10-07-apps): `"app"` en el primer
   *  mensaje de un proyecto en blanco lo convierte en app antes del turno. Otra
   *  cosa no cuenta, y en un proyecto con algo dentro no hace nada. */
  naceComo?: unknown;
  /** El idioma de la interfaz, para el `lang` del cascarón de una app que nace. */
  idioma?: unknown;
};

/** La ronda de un encargo que abre el conductor (pieza 8). Nunca sale del cuerpo. */
type RondaDelEncargo = { goalId: string; revision: number; round: number };

/**
 * EL TURNO, sin la puerta HTTP (pieza 8 de Len 2.5). Lo llama `POST` con el
 * usuario de la petición y lo llama el conductor del encargo para abrir la
 * ronda siguiente en el servidor, sin nadie delante: `opts.round` es lo único
 * que hace de un turno una ronda, y no sale del cuerpo. `req` es lo que el
 * turno usaba de la petición (su URL, para las fotos, y su señal).
 */
async function correrTurno(
  userId: string,
  body: CuerpoDelTurno | null,
  req: { url: string; signal: AbortSignal },
  opts: { round?: RondaDelEncargo; hilo?: PedidoDelHilo } = {},
): Promise<Response> {
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  // `let`: en una ronda del encargo (pieza 8) el mensaje del turno es el de
  // ronda de DeepSeek, que se compone abajo, con el encargo plegado.
  let prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  // Pieza 8: la puerta del dueño al encargo. Sólo los dos literales cuentan.
  const pedidoDelEncargo = body?.goal === "create" || body?.goal === "resume" ? body.goal : null;
  // EL ID DE LA FILA DE LA TRANSCRIPCIÓN, elegido por el cliente para que su
  // fila optimista y la que escribe el servidor sean la MISMA. Distinto del
  // `turnoId` de las correcciones, que lo sigue minteando el servidor porque es
  // una dirección y una elegible por el cliente sería falsificable.
  //
  // Se sanea, no se confía: el id es una PK, así que sólo se acepta la forma de
  // un uuid. Un cliente viejo no lo manda y la fila se escribe bajo el id del
  // turno — sigue existiendo, que es lo que importa.
  // EL PESTILLO POR TURNO, copiado de Claude Code. Allí el esfuerzo se FIJA al
  // enviar el mensaje, por mensaje, para que cambiar el mando a mitad de turno no reescriba
  // retroactivamente con qué esfuerzo corrió lo que ya se mandó. Aquí el pin es
  // que el nivel VIAJA EN EL CUERPO del turno en vez de releerse del perfil: el
  // valor que llega es el que el usuario veía cuando pulsó enviar.
  //
  // Se sanea contra `ESFUERZOS`, no se confía: entra de fuera y `esfuerzoEfectivo`
  // confía en el tipo de su parámetro. Basura -> `null` -> se sigue bajando por
  // las capas hasta la preferencia guardada, que es la degradación correcta.
  const esfuerzoCrudo = typeof body?.esfuerzo === "string" ? body.esfuerzo.trim().toLowerCase() : "";
  const esfuerzoDelTurno = ESFUERZOS.find((e) => e === esfuerzoCrudo) ?? null;
  // LEN DYNAMIS, con el mismo pestillo: el modo que el usuario veía al pulsar
  // enviar. Con la terminal apagada no existe, y el turno es de Len.
  const mode = modeOfTurn(body?.mode);
  // Pieza 3: sólo el literal `true` cuenta (entra de fuera).
  const answersQuestions = body?.answersQuestions === true;
  // Pieza 7: la elección del dueño, con el mismo pestillo (lo que veía al
  // mandar). Basura o ausente (voz, Len-Bench, un cliente viejo) = `null`: no
  // es «apagado», es «lo que ya estaba».
  const planElegido = typeof body?.plan === "boolean" ? body.plan : null;
  // LA HORA DEL USUARIO (plans/len-resultados/diseno.md §7). Se sanea: entra de
  // fuera. Basura -> null -> la zona guardada.
  const zonaDelCuerpo = zonaValida(body?.zonaHoraria);

  const turnIdRaw = typeof body?.turnId === "string" ? body.turnId.trim() : "";
  const turnIdDelCliente =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(turnIdRaw)
      ? turnIdRaw
      : null;
  if (!projectId) return errorJson(400, "projectId is required");
  // El tope es el del mensaje ENTERO: lo que escribes sigue en 2.000 en la caja,
  // y los comentarios de líneas van dentro (la #8, `comentarios-de-lineas.ts`).
  // Reanudar un encargo y una ronda no traen mensaje: lo pone el de ronda.
  const sinMensajeDelDueno = pedidoDelEncargo === "resume" || opts.round !== undefined;
  if ((prompt.length === 0 && !sinMensajeDelDueno) || prompt.length > MAX_PROMPT) return errorJson(400, `prompt must be 1–${MAX_PROMPT} chars`, "promptLength");
  // COMPARTIR EL PROYECTO (lib/projects/acceso.ts): un EDITOR también habla con
  // Len. Desde aquí `userId` es el DUEÑO —con él se lee y se escribe el proyecto
  // y él paga, como un canal en Claude Tag lo paga la organización— y `quien`,
  // la persona que pidió el turno. Lo que gasta un miembro cuenta contra el
  // tope del proyecto, y el turno no ve los datos de los visitantes. Las rondas
  // del encargo las abre el servidor para el dueño: no pasan por aquí.
  const quien = userId;
  let miembro = false;
  if (!opts.round) {
    const acceso = await accesoAlProyecto(projectId, userId);
    if (!acceso) return errorJson(404, "project not found");
    if (!puede(acceso.rol, "editar")) return errorJson(403, "you can view this project but not edit it", "solo_lectura");
    if (acceso.rol !== "dueno") {
      miembro = true;
      userId = acceso.duenoId;
      // Un encargo corre rondas solo, sin nadie delante: eso lo decide el dueño.
      if (pedidoDelEncargo) return errorJson(403, "only the project owner can start or resume a goal", "solo_dueno");
      if (!(await cabeEnElTope(projectId, 1))) return errorJson(402, "the project's monthly limit for members is used up", "tope_de_miembros");
    }
  }
  // HILOS EN EL CÓDIGO: un `@Len` desde un hilo lo lanza el SERVIDOR
  // (lib/agent/turnos-desde-el-servidor.ts), nunca el cuerpo de una petición.
  // Al cerrar, Len contesta en el hilo; el contexto del hilo va sólo al modelo.
  const hiloDelTurno = opts.hilo && (await hiloDelProyecto(projectId, opts.hilo.hiloId).catch(() => null)) ? opts.hilo : null;
  // F4 Task 1 — multi-page base: page slug, validated CLONED from
  // app/api/templates/ai-design/route.ts (read that file first if editing
  // this block). Absent/empty ⇒ home; a non-empty slug MUST already exist in
  // data.pages or the turn 404s rather than silently falling back to home.
  const pageSlugRaw = typeof body?.page === "string" ? body.page.trim() : "";
  // La página se resuelve ANTES de construir cualquier catálogo. Así un
  // slug inválido no se convierte en Home ni siquiera durante el saneamiento
  // del historial, y las declaraciones se construyen una sola vez con la
  // misma capacidad que recibirán prompt y sesión.
  // `observarPagina` se enchufa AQUÍ y no dentro de `realDeps()` a propósito:
  // vive en verify.ts, que arrastra el render de Chromium, y `lib/agent/tools`
  // lo importan muchas pruebas que no quieren ese grafo detrás.
  // 🔴 UN NAVEGADOR PARA TODO EL TURNO.
  //
  // MEDIDO el 2026-09-03 sobre una plantilla real de 59,6 KB: abrir Chromium y
  // medir cuesta 4,80 s; medir con el navegador YA abierto, 2,16 s. El arranque
  // son ~2,6 s y se pagaba ENTERO en cada mirada — las dos verificaciones del
  // turno y cada `view_page` que pida el modelo. En una página de 8,8 KB la
  // medición baja a 1,63 s, así que el arranque llega a ser MÁS caro que el
  // trabajo.
  //
  // El pool existía desde antes (`createVisualQualityRendererPool`) y sólo lo
  // usaba la hoja de contactos de plantillas. Aquí se comparte uno POR REQUEST y
  // se cierra en el `finally` del turno.
  //
  // POR QUÉ POR REQUEST Y NO POR PROCESO. Un Chromium residente ahorraría
  // también el primer arranque, pero la caja es una CX22 que además lleva
  // Postgres: dejar un navegador vivo entre turnos es una decisión de
  // infraestructura con su propia medición, y ésta no lo es.
  //
  // Perezoso a propósito: un turno que no mira nada —la mayoría de los de
  // charla— no abre ningún navegador. Y una sola promesa, no una por llamada,
  // para que dos miradas en paralelo no arranquen dos.
  let poolDelTurno: Promise<VisualQualityRendererPool | null> | null = null;
  // 🔴 Y UNA MEDIDA POR DOCUMENTO, NO POR LLAMADOR.
  //
  // Un turno que edita renderizaba DOS VECES el mismo documento: la medición
  // que vuelve al modelo tras editar (`medirParaElModelo`) y la de los ojos al
  // cerrar. +2,16 s en caliente, por nada. (⚰️ Esas dos se retiraron el
  // 2026-10-06, plans/crear-es-len; el memo lo comparten hoy las miradas que
  // pide Len, `view_page` y `use_page`.)
  //
  // ⚰️ Esto se dejó sin memoizar el 2026-09-05 con un motivo escrito —«miden
  // documentos distintos: los ojos inyectan el script y las fotos por su
  // cuenta, así que una caché por hash no acertaría nunca»— y ese motivo
  // CADUCÓ sin que nadie lo mirara:
  //
  //   · el injerto del script es un no-op desde `933acc9d`: el `<script>` vive
  //     dentro de `data.html`, `scriptDelDocumento` lo saca de ESE documento y
  //     `injectModelRuntime` devuelve el html intacto cuando ya está
  //     (`html.includes(code)` — ver su comentario, y el bug que lo obligó);
  //   · las fotos las inyectan LAS DOS con la misma `inlineOwnAssets`, sobre el
  //     mismo gemelo (`loop.ts` pasa `{...lastMutation}` a las dos), y esa
  //     función devuelve el html tal cual cuando no hay subidas propias, que es
  //     el caso normal en producción.
  //
  // La mecánica y sus guardas viven en `lib/ai/medir-una-vez.ts`: la clave es
  // el documento ENTERO, no un hash, así que es imposible que devuelva la
  // medida de otra página — que era justo el miedo que dejó esto sin hacer.
  //
  // LA CARPETA (pieza 9 de Len 2.5, carril B): `opts.carpeta` son los ficheros
  // que la página pide (`/js/app.js`), y entran en la clave del memo. Sin
  // carpeta, el navegador recibe el documento solo, como siempre.
  const medirDocumento = async (
    html: string,
    _internals?: Record<string, never>,
    opts?: VisualQualityRenderOptions,
  ): Promise<VisualQualityViewports | null> => {
    poolDelTurno ??= createVisualQualityRendererPool(1).catch((e: unknown) => {
      // FAIL-SOFT. Si el navegador no arranca, los ojos NO se quedan ciegos: se
      // mide como se medía antes, uno por llamada. Que falle por su motivo, no
      // por el pool.
      console.warn(
        `[agent] el navegador del turno no arrancó, se mide como antes: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    });
    const pool = await poolDelTurno;
    if (opts?.carpeta) return pool ? pool.render(html, opts) : renderVisualQualityViewports(html, {}, opts);
    return pool ? pool.render(html) : renderVisualQualityViewports(html);
  };
  const medidaDelTurno = medirUnaVezPorDocumento(medirDocumento);
  const medirDelTurno = medidaDelTurno.medir;
  const cerrarNavegadorDelTurno = async () => {
    const reusos = medidaDelTurno.reusos();
    if (reusos > 0) {
      // DECIRLO, no suponerlo. Un ahorro invisible es indistinguible de un
      // ahorro que no ocurre — ver el memoria de las features silenciosamente
      // apagadas.
      // eslint-disable-next-line no-console
      console.info(`[agent] ${reusos} render(s) ahorrado(s) por documento ya medido`);
    }
    medidaDelTurno.olvidar();
    const pendiente = poolDelTurno;
    poolDelTurno = null;
    const pool = await pendiente?.catch(() => null);
    await pool?.close().catch(() => {});
  };

  // N42 · LO QUE LAS HERRAMIENTAS COBRAN APARTE DEL MODELO (centicréditos):
  // buscar en la web, editar una imagen. Se cobra al momento, como siempre; aquí
  // además se cuenta, porque el cierre del turno tiene que decir lo que de
  // verdad se cobró — un turno con búsquedas decía «1,46 créditos» y costó 5,96.
  let chargedByTools = 0;
  const deps = {
    ...realDeps(async (uid, centicreditos) => {
      await debitCredits(uid, centicreditos);
      chargedByTools += centicreditos;
      if (miembro) await sumarGasto(projectId, quien, centicreditos);
    }),
    // Un miembro no ve `/.openlen/resultados` ni `/.openlen/bandeja`, ni las
    // herramientas de resultados: son datos de los visitantes, del dueño.
    ...(miembro ? { resultados: undefined } : {}),
    // `view_page` mide por el mismo navegador que los ojos: es la herramienta
    // que más veces lo abre en un turno.
    observarPagina: (input: Parameters<typeof observarPagina>[0]) =>
      observarPagina(input, { medir: medirDelTurno }),
    // `use_page` (H9) abre SU navegador por visita y no el del turno: cada
    // visita tiene que empezar limpia (sin lo guardado por la anterior) y lleva
    // su propio preludio.
    usarPagina,
  };
  // UNA APP NACE (H10): crear es el primer mensaje a Len en un proyecto en
  // blanco, y si ese mensaje pide una app, el proyecto recibe aquí el esqueleto
  // (`lib/projects/nacer-como-app.ts`) — antes de leerlo, para que el turno
  // entero sea ya de app. Sólo toca un proyecto en blanco, en una sentencia; si
  // no lo está, no pasa nada y el turno sigue con lo que hay. Va antes de la
  // puerta de créditos a propósito: el dueño eligió app, y sin créditos se
  // queda con el esqueleto, que arranca, en vez de con una página en blanco.
  if (body?.naceComo === "app" && !opts.round) {
    await nacerComoApp({
      projectId,
      userId,
      titulo: "App",
      ...(typeof body.idioma === "string" ? { idioma: body.idioma } : {}),
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[agent] la app no pudo nacer; el turno sigue con el proyecto como está", err);
    });
  }
  const project = await deps.loadProject(projectId, userId);
  if (!project) return errorJson(404, "project not found");
  const pageSlug =
    pageSlugRaw && project.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");
  // ⚰️ Aquí se armaba `vistaDelTurno` (`vistaParaMedir`), el contexto con el que
  // se horneaba lo que medían `medirParaElModelo` y los ojos al cerrar.
  // Retirados el 2026-10-06 (plans/crear-es-len).
  // UNA APP WEB (F3 de la spec local 2026-10-07-apps): su prompt, su manual y
  // sus herramientas son los suyos (`lib/agent/modo-app.ts`). Se decide UNA vez
  // por turno, con la fila del principio, como todo lo demás que lee el prompt.
  const appDelTurno = project.data?.app ?? null;
  // Todas cargadas: las diferidas y ToolSearch (H2) se retiraron en Len 2.1.
  const tools = buildFunctionDeclarations(process.env, {}, mode, appDelTurno);
  // History hardening — ver `lib/agent/historial-saneado.ts`. Del navegador
  // sólo se acepta un NOMBRE de herramienta que exista, sin argumentos, y un
  // resumen acotado. Vive fuera para que el arnés de evals reproduzca una
  // conversación con el MISMO saneado que aplica esta ruta.
  const turnosTotales = turnosTotalesDe(body?.historyTotal);
  // 🔴 H4 · EL HISTORIAL SALE DE LA BASE, como la transcripción de Claude Code
  // (`lib/agent/transcripcion.ts`): con los argumentos de cada llamada y sus
  // resultados, los viejos vaciados con su marca. Lo escribió el servidor; nada
  // del navegador entra. El del navegador queda sólo para las conversaciones sin
  // ninguna transcripción todavía (anteriores a H4), con su saneado de siempre.
  // Fail-soft: si la base no contesta, el turno sigue con el del navegador.
  // EL CHAT DEL EQUIPO (lib/agent/plegar-equipo.ts): en un proyecto con
  // miembros, los mensajes entre personas viajan en su sobre delante del turno
  // siguiente, y los del final delante de la petición de ahora. Sin miembros,
  // las filas de siempre y nada más (byte-idéntico).
  const genteDelProyecto = await personasDelProyecto(projectId).catch(() => []);
  const compartido = genteDelProyecto.length > 1;
  let equipoAhora = "";
  let filasDelHistorial: FilaDelHistorial[];
  if (compartido) {
    const crudas = await filasParaElHistorialConEquipo(projectId, TURNOS_DEL_HISTORIAL).catch(() => []);
    const plegado = plegarEquipo(crudas, genteDelProyecto, userId);
    filasDelHistorial = plegado.filas;
    equipoAhora = plegado.ahora;
  } else {
    filasDelHistorial = await turnosParaElHistorial(projectId, TURNOS_DEL_HISTORIAL).catch(() => []);
  }
  const pideAhora = compartido ? quienPide(genteDelProyecto.find((p) => p.userId === quien) ?? null) : "";
  // El historial se ARMA más abajo, después de conseguir las fotos de la
  // conversación (A): sin ellas, la foto de un turno anterior no tendría dónde ir.
  const dichoAntes = sanearDichoAntes(body?.dichoAntes);

  // PIEZA 8 · EL ENCARGO DEL TURNO, como el goal de DeepSeek: plegado de la
  // última fila con transcripción (`goalFromRows`) y armado o no según el
  // PROCESO (`goal-activation.ts`: tras un reinicio, nada lo está). Tres formas
  // de que este turno sea una RONDA: la puerta del dueño (crear: este turno es la
  // 1, como `/goal` + la primera ronda; reanudar: la siguiente) o el conductor
  // (`opts.round`). En las tres, el mensaje del turno es el de ronda de DeepSeek,
  // y queda en la conversación como allí. Armar espera a que el turno empiece de
  // verdad (pasada la puerta de créditos): una salida temprana no deja nada armado.
  // Lo plegado se guarda aparte: un turno que cae sin transcripción deja su foto
  // sólo si la cambió (`stateOnlyTranscript`, lote 7-8).
  const goalPlegado: GoalSnapshot | null = goalFromRows(filasDelHistorial);
  let goalActual: GoalSnapshot | null = goalPlegado;
  let goalArmado = goalActivation(projectId, goalActual?.id) === "armed";
  let rondaDelTurno: RondaDelEncargo | null = null;
  let ronda: GoalSnapshot | null = null;
  if (opts.round) {
    // La reserva del conductor sólo vale para la revisión EXACTA, activa y
    // armada (el `validReservation` de DeepSeek): si algo la movió entre medias,
    // no corre.
    const g = goalActual;
    if (!g || !goalArmado || g.phase !== "active" || g.id !== opts.round.goalId || g.revision !== opts.round.revision || g.roundsStarted + 1 !== opts.round.round) {
      return errorJson(409, "stale goal round", "goal_round_stale");
    }
    ronda = startRound(g);
  } else if (pedidoDelEncargo === "create" && (goalActual === null || goalActual.phase === "complete")) {
    // Con un encargo vivo, la puerta se ignora y el turno es uno normal (dos
    // pestañas): el modelo lo ve con `get_goal`.
    ronda = startRound(createGoal(goalActual, { objective: prompt }, `goal-${randomUUID()}`));
  } else if (pedidoDelEncargo === "resume") {
    try {
      if (!goalActual) throw new GoalError("no current goal", "GOAL_NOT_FOUND");
      ronda = startRound(resumeGoal(goalActual, goalActual, goalArmado ? "armed" : "disarmed"));
    } catch (err) {
      return errorJson(409, err instanceof Error ? err.message : "goal not resumable", "goal_not_resumable");
    }
  }
  if (ronda) {
    goalActual = ronda;
    goalArmado = true;
    rondaDelTurno = { goalId: ronda.id, revision: ronda.revision, round: ronda.roundsStarted };
    prompt = goalRoundPrompt(ronda, ronda.roundsStarted);
  }

  // Validate the scope payload (optional) — same shape/limits as ai-design.
  // The hint is a textual fallback; the path, when it resolves, becomes the
  // selected lines of the file (`seleccionDelLienzo`), not an id.
  let scopeHint: string | null = null;
  let scopePath: string | null = null;
  if (body?.scope && typeof body.scope === "object") {
    const raw = body.scope.outerHtml;
    if (typeof raw === "string" && raw.length > SCOPE_OUTER_MAX) {
      return errorJson(400, "scope.outerHtml too large", "scopeTooLarge");
    }
    if (typeof body.scope.hint === "string" && body.scope.hint.trim().length > 0) {
      scopeHint = body.scope.hint.trim().slice(0, 200);
    }
    if (typeof body.scope.path === "string" && body.scope.path.trim().length > 0) {
      scopePath = body.scope.path.trim().slice(0, 2000);
    }
  }

  // LAS FOTOS DEL MENSAJE: `attachedImages` (hasta 4, como Crear) y el
  // `attachedImage` de siempre, que sigue llegando del chat. Misma validación
  // de antes para cada una —same shape/limits/posture as ai-design: a valid
  // http(s) URL, root-relative resolved against req.url—; una inválida se
  // descarta en silencio en vez de un 400 (el mensaje sigue valiendo).
  const leerFoto = (raw: unknown): ChatPhoto | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as AttachedImageBody;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (url.length === 0 || url.length > ATTACHED_URL_MAX) return null;
    try {
      const parsed = new URL(url, req.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const alt = typeof r.alt === "string" ? r.alt.trim().slice(0, ATTACHED_ALT_MAX) : "";
      return alt ? { url: parsed.href, alt } : { url: parsed.href };
    } catch {
      return null;
    }
  };
  const attachedImages: ChatPhoto[] = [];
  for (const raw of [...(Array.isArray(body?.attachedImages) ? body.attachedImages : []), body?.attachedImage]) {
    const foto = leerFoto(raw);
    // La misma foto dos veces (el chat manda las dos claves) es una sola.
    if (foto && !attachedImages.some((f) => f.url === foto.url)) attachedImages.push(foto);
  }
  attachedImages.splice(MAX_PHOTOS_PER_MESSAGE);

  // La puerta valida la credencial del papel que de verdad razona este turno —
  // ver lib/ai/turn-credentials.ts. Aqui vivia tambien un `PROVIDER` de Gemini
  // que solo alimentaba a los ojos; los ojos van por Fireworks y se lo resuelven
  // solos desde la politica de modelos.
  const faltaKey = faltaCredencial(credencialDelTurno());
  if (faltaKey) return errorJson(500, faltaKey);

  // The ACTIVE document — home's data.html or the validated subpage's html —
  // es el fichero que el dueño tiene abierto en el editor. Len 2.0 NO lo recibe
  // en el contexto: lo lee con Read (plans/len-2/ficheros-plan.md, T8c).
  //
  // ⚰️ Aquí se etiquetaba con `data-op-id` para mandárselo al modelo, y una
  // página sin nada etiquetable se rechazaba con un 400 (`noTaggableElements`).
  // Con ficheros no hay nada que rechazar: una página vacía es un fichero vacío,
  // Read lo dice («This file exists and is empty») y Write lo llena,
  // como en Claude Code.
  const activeHtml = pageSlug ? project.data.pages?.[pageSlug]?.html ?? "" : project.data.html ?? "";

  // LO QUE EL DUEÑO SEÑALÓ EN EL LIENZO, como fichero y líneas — como Claude
  // Code cuenta lo que el usuario selecciona en su IDE. Ver
  // `lib/agent/seleccion-del-lienzo.ts`.
  const seleccion = seleccionDelLienzo({ html: activeHtml, page: pageSlug, path: scopePath, hint: scopeHint });

  // 🔴 LAS FOTOS DE LA CONVERSACIÓN (A, 2026-10-01), como en Claude Code: la de
  // este turno y la de cada turno que Len ve, conseguidas en paralelo y pegadas
  // a TU mensaje (`Message.images`), así viajan en todas las vueltas y en los
  // turnos siguientes. Antes (F5) la de este turno iba sólo en la primera
  // vuelta y la de los anteriores no iba nunca: «la nueva no me llegó».
  //
  // Las subidas propias en disco (dev) se leen del disco; las demás, con la
  // defensa SSRF de siempre (`validateUrl` + sin redirecciones + 4 MB). El
  // `signal` no es decorativo: esto corre ANTES de abrir el SSE, y una URL que
  // no responde dejaría el turno colgado. Una foto que no llega es `null`: la
  // nota lo dice y el turno sigue. Ver `lib/agent/fotos-de-la-conversacion.ts`.
  // De la más nueva a la más vieja: la del turno primero. Si no caben juntas en
  // la petición, las más viejas van sin píxeles y con su dirección, como DeepSeek
  // (`fotosQueCaben`); el turno sigue.
  const masNuevaPrimero = [
    ...attachedImages.map((f) => f.url),
    ...[...filasDelHistorial].reverse().flatMap((f) => photosOf(f.attachedImage).map((p) => p.url)),
  ];
  const fotos = fotosQueCaben(masNuevaPrimero, await conseguirFotos(masNuevaPrimero, { origen: req.url, signal: req.signal }));
  const pixelesDe = (url: string): InlineImage | null => {
    const f = fotos.get(url);
    return f && f !== NO_CABE ? f : null;
  };
  const attachedInlines: InlineImage[] = attachedImages
    .map((f) => pixelesDe(f.url))
    .filter((p): p is InlineImage => p !== null);
  if (fotos.size > 0) {
    const valores = [...fotos.values()];
    const vistas = valores.filter((f) => f && f !== NO_CABE).length;
    const noCaben = valores.filter((f) => f === NO_CABE).length;
    console.log(`[agent] fotos de la conversación — ${vistas} de ${fotos.size} a la vista${noCaben ? `, ${noCaben} sin píxeles por no caber` : ""}`);
  }
  const historialDeLaBase = filasDelHistorial.some((f) => f.transcript)
    ? historialDesdeLaBase(filasDelHistorial, undefined, fotos)
    : null;
  const history: MensajeDelHistorial[] =
    historialDeLaBase ?? sanearHistorial(body?.history, new Set(tools.map((d) => String(d.name))));
  const ventanaVisible = ventanaVisibleDe(history);

  const state = summarizeProjectState(
    {
      data: project.data,
      title: project.title,
      subdomain: project.subdomain,
      publishedAt: project.publishedAt,
      // LA DERIVA, en una lectura aparte: `loadProject` trae el borrador, y
      // las huellas de lo publicado están en otras columnas de la misma fila.
      // Es una consulta por turno, la misma que ya hacen `toggle_module` y la
      // franja de la Bandeja. Sin ella el ESTADO dice «publicado» de una
      // release que puede ser la de anteayer, y el Agente contesta «ya
      // contesta la IA» sin llamar a una sola herramienta.
      cambiosSinPublicar: await deps.cambiosSinPublicar(projectId, userId),
      // El backend del proyecto (plans/pages-backend/design.md). Si la base no
      // contesta, el turno sigue sin el campo: `supabase status` lo dirá.
      supabase: await (deps.supabaseProject?.(projectId) ?? Promise.resolve(null)).catch((err: unknown) => {
        console.warn("[agent] no se pudo leer el backend del proyecto", err);
        return null;
      }),
      // En una app, las rutas de su carpeta: su código. Si no se puede leer, el
      // turno sigue sin la lista (Len la saca con la terminal).
      ...(appDelTurno
        ? { ficherosDeLaCarpeta: Object.keys((await deps.projectFiles?.(projectId).catch(() => null)) ?? {}) }
        : {}),
    },
    // La pagina ACTIVA: los rasgos del documento (tokens, modo, fuentes)
    // describen el que se va a editar, no siempre la Home.
    pageSlug,
  );
  // ⚰️ …y el perfil de negocio entraba al ESTADO como `negocio`. Se fue con
  // él el 2026-08-31.
  // ⚰️ Aquí se leía el catálogo del usuario de la base, porque la banda de la
  // colección llegaba VACÍA en el documento —los items se horneaban al
  // publicar— y sin esto el Agente fabricaba tarjetas inventadas.
  //
  // Dejó de hacer falta cuando cada almacén fue el fichero /datos/<almacén>.json
  // (H3), y los almacenes se retiraron a su vez el 2026-10-04: los datos de una
  // página viven hoy en su backend de Supabase.

  // 🔴 LAS TRES LECTURAS DE PERFIL SALEN JUNTAS, no en fila.
  //
  // Eran tres `await` en serie antes del primer byte: la memoria de la persona
  // y el historial de versiones aquí mismo, y la postura de esfuerzo ~170
  // líneas más abajo, dentro de `createAgentBrain`. Con la base sana no se
  // notaba; con la base degradada cada una aporta su plazo entero al TTFB, y
  // las dos acotadas tienen plazo propio (1,5 s cada una) — o sea que el peor
  // caso era la SUMA de los tres, ~3 s antes de que el usuario viera nada, en
  // vez del más lento de los tres.
  //
  // Se pueden paralelizar porque no dependen unas de otras y porque entre el
  // primer uso y el último NO hay ninguna salida temprana (comprobado: cero
  // `return Response` en ese tramo), así que ninguna de las tres se dispara
  // para un turno que iba a abortar de todas formas.
  //
  // `listVersions` entra con ellas por la misma razón, aunque el minor sólo
  // nombrara dos: estaba en serie en este mismo literal y dejarla fuera habría
  // arreglado media fila. Cada una conserva su propia degradación —las dos
  // acotadas caen a `null`, el historial a `[]`—, así que una base caída sigue
  // dando un turno, que es lo que ya hacían por separado.
  //
  // Las versiones se leen UNA vez y alimentan dos cosas: el registro de cambios
  // y lo que el dueño cambió a mano desde el último turno de Len (H07).
  const versionesDelProyecto = listVersions({ projectId, userId: userId }).catch(() => []);
  const [userMemory, esfuerzoDelUsuario, cambios, cambiosDelDueno] = await Promise.all([
    getUserMemoryBounded(userId),
    getEsfuerzoGuardado(userId),
    versionesDelProyecto.then(cambiosParaElAgente),
    // 🔴 H07 · ENTRE TURNOS, LEN SE ENTERA DE LO QUE EL DUEÑO TOCÓ. Una lectura
    // más, sólo cuando Len escribió alguna vez en esta página. Fail-soft: es
    // contexto, y no poder calcularlo deja el turno como estaba.
    versionesDelProyecto.then((versiones) =>
      loQueCambioElDueno({
        versiones,
        page: pageSlug,
        actual: stripOpIds(activeHtml),
        leerHtml: async (versionId) => {
          const html = await getVersionHtml({ projectId, userId, versionId });
          return html === null ? null : stripOpIds(html);
        },
      }),
    ),
  ]);

  // LA ZONA DEL TURNO, resuelta UNA vez y antes del contexto: el HOY que lee
  // Len y el «hoy» que cuentan sus herramientas tienen que ser el mismo día.
  // Con el HOY en UTC, a las 19:25 de México Len llamó «ayer» a un mensaje de
  // ese día (plans/len-2/corridas/2026-10-01-resultados-humo). Leer la
  // guardada tampoco tumba el turno: si la base falla, UTC, y la herramienta lo dice.
  const zonaDelTurno = zonaDelCuerpo ?? (await leerZona(userId).catch(() => null)) ?? ZONA_SIN_DATO;
  const argsDelTurno = {
    mode,
    app: appDelTurno,
    zona: zonaDelTurno,
    state,
    userBrief: project.userBrief,
    // Lo que el Agente sabe de ESTA PERSONA. Se lee por turno, no se cachea:
    // el usuario puede haber guardado algo en OTRA pestaña, en otro proyecto,
    // hace un minuto — que es justo el caso que esto existe para servir.
    userMemory,
    // LO QUE YA SE HIZO. `projectVersions` guarda cada edición con su etiqueta
    // ya escrita en español y nadie se la enseñaba al modelo. Sobrevive a la
    // ventana de la conversación, a recargar y a volver un mes después — que es
    // por qué esto vale más que ampliar la ventana.
    cambios,
    // Lo que el dueño cambió a mano desde el último turno de Len en esta página.
    cambiosDelDueno,
    // Lo que la ingestión ya sabe que se perdió en esta página. El Chat lo
    // recibe desde hace tiempo (`KNOWN ISSUES ON THIS PAGE`); el Agente no lo
    // veía por ningún lado, así que empezaba a ciegas una conversación sobre
    // un fallo que el sistema tenía diagnosticado por escrito.
    degradaciones: project.data?.degradations ?? [],
    // Qué parte de la conversación NO ve — para que pueda decir «no me
    // acuerdo» en vez de nombrar el turno más viejo que tenga a mano.
    conversacionRecortada:
      turnosTotales > 0 ? { visibles: ventanaVisible, totales: turnosTotales } : null,
    // Y lo que el dueño dijo en los turnos que ya no se ven (H08-a).
    dichoAntes,
    // Desde un hilo del código, el modelo lee también dónde y lo dicho antes;
    // la fila (y el chat) guardan sólo lo que se escribió.
    // En un proyecto con miembros, delante: lo que el equipo se dijo desde el
    // último turno y quién pide éste (lib/agent/equipo.ts).
    // (`equipoAhora` ya acaba en salto de línea: `plegarEquipo`).
    prompt: `${equipoAhora}${pideAhora ? `${pideAhora}\n` : ""}${hiloDelTurno ? `${hiloDelTurno.contexto}\n\n${prompt}` : prompt}`,
    equipo: compartido,
    history,
    // ¿El turno anterior fue MUDO? Se deriva del historial que acaba de
    // sanearse: el último mensaje del asistente sin `functionCalls` significa
    // que no tocó nada. Es un hecho estructural, no una lectura de su prosa.
    // Un historial vacío (primer turno) no dispara nada.
    turnoAnteriorMudo: turnoAnteriorMudoDe(history),
    attachedImages: attachedImages.map((f) => (pixelesDe(f.url) ? { ...f, visible: true } : f)),
    // LA REFERENCIA POR URL (plans/crear-es-len): el mismo bloque que Crear
    // ponía delante del brief, en el contexto de ESTE turno. Sólo para el
    // modelo: la fila guarda lo que el dueño escribió (`prompt`), no el bloque.
    styleDirection: parseStyleDirection(body),
    seleccion,
    maxPromptTokens: MAX_PROMPT_TOKENS,
  };
  const built = buildAgentMessages(argsDelTurno);

  // ⚰️ EL PLANO B —mandar sólo el índice de secciones cuando la página no
  // cabía— se fue con el documento (Len 2.0, T8c): el contexto ya no lleva
  // ninguna página, así que el tamaño de una no puede tumbar el turno. Una
  // página enorme se lee por trozos con Read (offset/limit), como en Claude
  // Code. El 413 queda para un historial que no quepa.
  if (!built.ok) return errorJson(413, "Page too large for an agent turn", "pageTooLarge");

  // LA FORMA DEL TURNO, en una línea y SIEMPRE. Ver lib/agent/forma-del-turno.ts
  // para el porqué largo; el corto es que de un turno del Agente sólo quedaban
  // dos líneas de consola y las dos eran de dinero, así que «¿qué vio el
  // modelo?» no tenía respuesta.
  //
  // NO lleva contenido: tamaños, qué bloques había, cómo viajó el documento y
  // su hash. Eso es lo que permite que vaya siempre encendida en vez de tras
  // una palanca — y la palanca es justo lo que no sirve aquí, porque hay que
  // encenderla ANTES de que pase lo que quieres ver, y los turnos que salen mal
  // no avisan. Para el contenido está el GRABADOR, que es opt-in.
  //
  // Va AQUÍ, antes de abrir el stream: un turno que muera contra el proveedor
  // —503, timeout, cancelado— deja igualmente dicho con qué salió.
  //
  // Y VA EN try/catch, que no es paranoia: la suite de esta ruta lo destapó al
  // primer intento. Diagnosticar NO puede costarle el turno a nadie — es la
  // misma regla que ya seguía el grabador, y aquí faltaba. Un campo que llegue
  // vacío por un refactor de mañana tiene que perder la línea de log, no la
  // página del usuario.
  try {
    console.log(
      lineaDeForma(
        formaDelTurno({
          projectId,
          systemPrompt: built.systemPrompt,
          contextBlock: built.contextBlock,
          history,
          turnosTotales,
          prompt,
          userBrief: project.userBrief,
          userMemory: argsDelTurno.userMemory,
          cambios: argsDelTurno.cambios,
          degradaciones: argsDelTurno.degradaciones,
          turnoAnteriorMudo: argsDelTurno.turnoAnteriorMudo,
          conPin: seleccion !== null,
          conImagen: attachedImages.length > 0,
          activePage: pageSlug,
        }),
      ),
    );
  } catch (err) {
    console.warn("[agent] no se pudo medir la forma del turno", err);
  }

  const messages = built.messages;
  // LA FOTO DE ESTE TURNO, PEGADA A TU MENSAJE (A): viaja en todas las vueltas
  // y en el cierre, como una imagen pegada en Claude Code. Antes se anclaba a
  // la primera vuelta y en la segunda Len ya no la tenía delante.
  if (attachedInlines.length > 0) messages[messages.length - 1] = { ...messages[messages.length - 1]!, images: attachedInlines };

  // PIEZA 7 · EL MODO PLAN DEL TURNO, como el de DeepSeek: plegado de la última
  // fila con transcripción y, si el dueño eligió otra cosa al mandar, gana él y
  // el modelo lo lee con la narración de DeepSeek, justo antes de su petición
  // (allí es un mensaje de usuario inyectado entre turnos). Sólo lo cambian
  // `enter_plan_mode` y `exit_plan_mode` (`deps.planMode`, más abajo); la
  // sección entra o sale del prompt en CADA petición (`withPlanSection`).
  const planPlegado = planModeFromRows(filasDelHistorial);
  const planDelTurno = resolveTurnPlanMode({ folded: planPlegado, selected: planElegido });
  let planActivo = planDelTurno.active;
  /** ALINEAR CON DEEPSEEK · ¿cambió este turno el estado de la charla (modo plan o
   *  encargo)? Allí es un evento duradero en el momento, haya o no más en el
   *  turno; aquí decide que la fila se guarde aunque no haya texto ni tarjetas, y
   *  que cuente como duradero para marcarla cortada (`corteDelTurno`, H05). */
  const estadoCambiado = () => planActivo !== planPlegado || goalActual !== goalPlegado;
  if (planDelTurno.notice) messages.splice(messages.length - 1, 0, { role: "user", content: planDelTurno.notice });

  // LA DIRECCION A LA QUE SE LE PUEDE CORREGIR EL RUMBO. El SSE es de una sola
  // via, asi que la correccion del usuario entra por otra peticion
  // (POST /api/agent/dirigir) y necesita saber a que turno va.
  const turnoId = randomUUID();
  const upstreamAbort = new AbortController();
  /** El cliente cerró la conexión a media faena. Desde 2.1 eso NO para el
   *  turno (ver `cancel()` abajo): sólo se apunta, para el registro y para
   *  avisar al usuario cuando termine sin nadie mirando. */
  let clienteSeFue = false;
  /** Lo paró alguien a propósito (■, o el plazo de Len-Bench): entonces no se
   *  avisa de que terminó, porque quien lo paró ya lo sabe. */
  let canceladoAProposito = false;
  // Desde la app del teléfono no hay sesión que traiga el correo: se lee de la base.
  const ownerEmail = await correoDelUsuario(userId).catch(() => null);
  const agentSession: AgentSession = {
    projectId,
    userId,
    mode,
    app: appDelTurno,
    // H3 — la memoria que va en el contexto cuenta como LEÍDA, como el CLAUDE.md
    // que Claude Code siembra al empezar: se le añade una línea sin un Read.
    leidos: new Map([
      // H4 · y lo que el turno anterior dejó leído, si no cambió y sigue a la
      // vista (lo leído, como lo apunta Claude Code). Las páginas, con el mismo
      // texto que les daría Read; /memoria va aparte.
      ...(historialDeLaBase
        ? leidosSembrados(
            filasDelHistorial.at(-1)?.transcript?.leidos ?? [],
            historialDeLaBase,
            (ruta) => {
              const html = leerFichero(project.data, ruta);
              return html === null ? null : sinOpIds(html);
            },
          )
        : []),
      ...memoriaSembrada(userMemory, project.userBrief ?? null),
    ]),
    // Lo que el usuario acaba de escribir. Sin esto ninguna herramienta puede
    // contrastar lo que el modelo hace con lo que se le pidió — ver `userPrompt`.
    userPrompt: prompt,
    page: pageSlug,
    // Alimenta la etapa de imágenes de `preparePage`, que sin él se saltaba en
    // TODA edición del Agente. El sembrado de marca que viajaba a su lado se
    // fue con el perfil el 2026-08-31.
    brief: project.brief ?? null,
    ownerEmail,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
    // Lo que el usuario escribió ESTE turno. Lo usa `publicar` para no
    // reclamar un subdominio que el dueño nunca dijo — ver su comentario.
    mensajeDelUsuario: prompt,
    zonaHoraria: zonaDelTurno,
  };
  // Se guarda para las rutinas, que corren sin navegador. Nunca tumba el turno.
  if (zonaDelCuerpo) {
    void guardarZona(userId, zonaDelCuerpo).catch((e) => console.error("[agent] zona", e));
  }
  // Quién razona vive en `lib/agent/brain` — el MISMO sitio del que tiran los
  // evals. Tenerlo aquí dentro ya dejó a la batería midiendo Gemini después de
  // que el Agente pasara a DeepSeek, sin que nada fallara.
  // El razonamiento no llega al loop, pero es vida: lo que el modelo piensa
  // rearma el reloj de silencio, que se crea más abajo con el stream.
  const pensando = { vivo: (): void => {} };
  const brain = createAgentBrain({
    alPensar: () => pensando.vivo(),
    tools,
    requestId: projectId,
    signal: upstreamAbort.signal,
    // Las DOS capas de esfuerzo, en el orden que resuelve `esfuerzoEfectivo`:
    // el pin de ESTE turno gana sobre la preferencia guardada de la PERSONA, y
    // `null` en las dos significa que nunca eligió, que resuelve a "auto".
    esfuerzoDelTurno,
    esfuerzoDelUsuario,
    mode,
  });

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = sseChannel(controller, { latidoMs: LATIDO_MS });
      const reloj = relojDeSilencio(SILENCIO_MS, () => upstreamAbort.abort());
      pensando.vivo = reloj.vivo;
      // Lo que se le manda al dueño es señal de vida; los latidos del canal no
      // pasan por aquí (ver `relojDeSilencio`).
      const emit: typeof channel.emit = (evento, datos) => {
        reloj.vivo();
        channel.emit(evento, datos);
      };
      const close = () => channel.close();
      // LO QUE YA ES IRREVERSIBLE. Vive FUERA del try a propósito: si el bucle
      // revienta, `result` no existe y ésta es la única memoria de que el turno
      // ya escribió en la base. Misma idea que `cambioDurable` en el Chat
      // clásico (ai-design), que es la superficie hermana.
      let mutoDurable = false;
      /** Si el turno se CORTÓ a medias habiendo cambiado algo, con qué código.
       *  Vive fuera del try por lo mismo que `mutoDurable`: lo lee el `finally`
       *  al escribir la fila. Ver `corteDelTurno`. */
      let corte: AgentErrorCode | null = null;
      /** Lo paró el dueño con ■ (no el perro del silencio): va en la
       *  transcripción y el historial siguiente lo dice (`MARCA_DE_TURNO_DETENIDO`). */
      let detenido = false;
      // EL REGISTRO DEL TURNO, del lado del SERVIDOR. Los tres viven fuera del
      // try por el mismo motivo que `mutoDurable`: quien los vuelca es el
      // `finally`, y el turno que hay que poder leer después es el que revienta.
      //
      // Hasta hoy la transcripción la escribía SÓLO el navegador al terminar de
      // leer el stream (`persistTurn` en chat-panel.tsx). Si el socket moría
      // fuera de banda —pestaña cerrada, panel desmontado al cambiar de
      // pestaña, reinicio del box— no se escribía nada, aunque el cambio ya
      // viviera en la base: el usuario pulsaba «Reintentar» y se aplicaba dos
      // veces. Y de un turno que falló no quedaba el MOTIVO, sólo la tarjeta.
      const diario = crearDiarioDelTurno();
      // El texto, las tarjetas y si cambió el documento: la fila que se guarda
      // al final. Vive en `lib/agent/registro-del-turno.ts` para que el arnés
      // de evals componga la MISMA fila al juzgar un turno cortado.
      const registro = crearRegistroDelTurno();
      /** H4 · lo que vio el modelo en este turno (`AgentLoopResult.transcripcion`). */
      let transcripcionDelTurno: Message[] | null = null;
      // ⚰️ Aquí se recogía `suiteDelTurno`, CÓMO QUEDABA LA SUITE DE LA PÁGINA
      // al cerrar el turno. Lo llenaba el veredicto de los ojos (`verifyTurn`),
      // retirado el 2026-10-06 con las promesas rotas (plans/crear-es-len,
      // tarea 10); sin él no lo llenaba nadie y la escritura del final era
      // código muerto. `lib/agent/pruebas-de-la-pagina.ts` sigue.
      // LO QUE COBRÓ EL TURNO (centicréditos) y CUÁNDO EMPEZÓ: el cierre del chat
      // los enseña (plans/new-chat/, decisión de Jesús del 03/10), en el `done` y
      // en la fila para que no desaparezcan al recargar. `null` = aún no se cobró.
      let cobrado: number | null = null;
      /** Pieza 8 · la ronda del encargo que este turno dejó en marcha: el aviso
       *  del final (push) no sale, sale al final de la cadena. */
      let siguienteFila: string | null = null;
      const empezo = Date.now();
      // LEN 2.1 · LA FILA DEL TURNO, ABIERTA MIENTRAS TRABAJA (diagnóstico
      // §4.4 punto 2). El turno ya no muere con el cliente, así que quien
      // vuelva a mirarlo —otra pestaña, el móvil, la misma tras perder la red—
      // lo encuentra en su fila: se abre `en_curso` pasada la puerta de
      // créditos, se va llenando (`avance`, como mucho cada 2 s) y se cierra
      // ANTES del `done` (`cerrarFila`), para que la fila ya esté completa
      // cuando el cliente se entera de que acabó.
      const filaId = turnIdDelCliente ?? turnoId;
      /** Lo que el usuario escribió a media faena, con la misma forma que el
       *  panel (`↳`): si no está el panel, la fila la escribe el servidor. */
      const correcciones: string[] = [];
      const textoDelUsuario = () => [prompt, ...correcciones.map((c) => `↳ ${c}`)].join("\n");
      let filaAbierta = false;
      let filaCerrada = false;
      const avance = crearAvance(async () => {
        try {
          await avanceDelTurno(projectId, filaId, {
            userText: textoDelUsuario(),
            assistantReasoning: registro.texto,
            actions: registro.tarjetas,
          });
        } catch (err) {
          console.warn("[agent] no se pudo guardar el avance del turno", err);
        }
      });
      /**
       * 🔴 LA FILA DEL TURNO, PASE LO QUE PASE, y UNA vez: la llaman el final
       * bueno y el malo antes de avisar al cliente, y el `finally` por si
       * ninguno llegó.
       *
       * Se escribe SIEMPRE que el turno haya hecho algo — texto, tarjeta o
       * escritura durable. Un turno que no produjo nada (un rechazo temprano)
       * no merece fila, y la que se abrió al empezar se quita.
       *
       * FAIL-SOFT y del todo: registrar el turno no puede costarle el turno a
       * nadie. La verdad de lo que falló va en el diario (`toolResults`); ver
       * el comentario de `registrarTurnoDelServidor`.
       */
      const cerrarFila = async (): Promise<void> => {
        if (filaCerrada) return;
        filaCerrada = true;
        await avance.parar();
        // Alinear con DeepSeek: también si el turno EMPEZÓ (la fila se abrió, pasada
        // la puerta de créditos) y cambió el estado, aunque no haya hecho nada más.
        if (registro.hayAlgo(mutoDurable) || (filaAbierta && estadoCambiado())) {
          try {
            await registrarTurnoDelServidor(projectId, {
              ...registro.fila({
                id: filaId,
                userText: textoDelUsuario(),
                page: pageSlug,
                toolResults: diario.entradas(),
                corte,
              }),
              // `undefined` y no `null`: el tipo de la fila (`StoredChatTurn`) no
              // admite `null` y cruzado con el de la función gana él. Se guarda
              // igual: `enteroONulo` los deja los dos en NULL.
              // Si el turno no llegó a su cierre (el bucle reventó), lo que ya
              // cobraron las herramientas sigue cobrado y se dice (N42).
              centicredits: cobrado ?? (chargedByTools > 0 ? chargedByTools : undefined),
              durationMs: Date.now() - empezo,
              // H4 · lo que vio el modelo; de aquí sale el historial del turno siguiente.
              // Pieza 7: y si cerró en modo plan, que es de donde se pliega el
              // estado del turno siguiente.
              transcript: transcripcionDelTurno
                ? {
                    ...transcripcionParaGuardar(transcripcionDelTurno, agentSession.leidos ?? new Map()),
                    ...(planActivo ? { planMode: true as const } : {}),
                    // Pieza 8: y el encargo como queda, que es de donde lo pliega el siguiente.
                    ...(goalActual ? { goal: goalActual } : {}),
                    // El ■ del dueño, para que el turno siguiente lo sepa.
                    ...(detenido ? { detenido: true as const } : {}),
                    // Los avisos con los que razonó este turno, para que su
                    // razonamiento (que vuelve en el historial) tenga su aviso al
                    // lado y no se lea como de AHORA. Como DeepSeek.
                    ...(built.ok && built.avisos ? { avisos: built.avisos } : {}),
                  }
                : // LOTE 7-8: sin transcripción (el bucle reventó), la foto del
                  // estado si el turno lo cambió —lo plegado es de ANTES de la
                  // puerta del dueño—; si no, NULL como siempre. `goalActual`
                  // sólo se reasigna en una transición (ronda o `commit`).
                  stateOnlyTranscript({
                    folded: { planMode: planPlegado, goal: goalPlegado },
                    now: { planMode: planActivo, goal: goalActual },
                  }),
            });
          } catch (err) {
            console.warn("[agent] no se pudo registrar el turno", err);
          }
          // Pedido desde un hilo del código: Len contesta EN EL HILO con lo que
          // dijo al cerrar (y el hilo enlaza al turno del chat).
          if (hiloDelTurno) {
            await respuestaDeLen({ projectId, hiloId: hiloDelTurno.hiloId, texto: registro.texto, filaId }).catch((err: unknown) =>
              console.warn("[agent] no se pudo contestar en el hilo", err),
            );
          }
        } else if (filaAbierta) {
          try {
            await quitarFilaDelTurno(projectId, filaId);
          } catch (err) {
            console.warn("[agent] no se pudo quitar la fila vacía del turno", err);
          }
        }
      };
      // EL GRABADOR DE TURNOS. Apagado salvo que `OPENLEN_AGENT_RECORD_DIR`
      // diga dónde escribir — OPT-IN de verdad, porque el fixture lleva dentro
      // el HTML de la página y el mensaje del usuario. Sin la variable no se
      // construye nada y el turno sale byte a byte como antes.
      //
      // PARA QUÉ. De un turno roto en producción hoy quedan DOS líneas de
      // consola con el recuento de tokens: ni lo que se envió, ni lo que
      // contestó el modelo. El reproductor ya existía —`scripted` en
      // loop.test.ts ejecuta el `runAgentLoop` REAL sin llamar a nadie—; lo que
      // faltaba era capturar un turno de VERDAD para dárselo.
      //
      // Vive FUERA del try porque quien lo vuelca es el `finally`: el turno que
      // revienta es precisamente el que hay que poder volver a correr.
      // PRIMERO DE TODO, antes incluso de comprobar creditos: si el turno se
      // muere por cualquier motivo, el taller ya sabe a que id iba y puede
      // cerrar su caja de texto sin quedarse esperando.
      // `abortar` es la única forma de parar el turno desde fuera: la usa
      // `POST /api/agent/cancelar` (el ■ del panel y el plazo de Len-Bench).
      // A nombre de QUIEN lo pidió: el ■, las respuestas y la reconexión son suyas.
      abrirTurno(turnoId, quien, Date.now(), {
        abortar: () => {
          canceladoAProposito = true;
          upstreamAbort.abort();
        },
        filaId,
        // Pieza 8: quitar el encargo espera a que no corra ningún turno aquí.
        projectId,
      });
      emit("turno", { turnoId });

      const dirGrabacion = directorioDeGrabacion();
      const grabadora = dirGrabacion ? creaGrabadora(messages) : null;
      // El aviso de lo que cambió en el turno; se arma con la foto del principio, abajo.
      let emitirCambios = async (): Promise<void> => {};

      try {
        const creditState = await getCreditState(userId);
        if (creditState.balance < 1) {
          const code: AgentErrorCode = "no_credits";
          emit("error", {
            message: noCreditsMessage(creditState, "existing"),
            code,
            refillsAt: creditState.refillsAt?.toISOString() ?? null,
          });
          close();
          return;
        }
        // LEN 2.1 · EL TECHO DE DINERO DEL TURNO: el del plan o el saldo, lo que
        // sea menos (`techoDelTurno`). El bucle lo pregunta antes de cada
        // llamada al modelo; al pasarlo, cierra contando lo hecho.
        let techo = techoDelTurno(creditState);
        // Un miembro, además, con lo que le queda al proyecto este mes.
        if (miembro) {
          const margen = await margenDeMiembros(projectId);
          if (margen != null) techo = Math.min(techo, margen);
        }
        // LOS CAMBIOS DEL TURNO, la foto del principio (`cambios-del-turno.ts`,
        // la forma de DeepSeek): los ficheros del proyecto ANTES de que Len
        // escriba nada. Se saca a la vez que la fila y la primera llamada al
        // modelo, y las herramientas la esperan (`runTool`, abajo): así no
        // retrasa el turno y nunca llega tarde. Si falla, no hay tarjeta.
        const fotoAntes = cargarFicherosDeLaTerminal(agentSession, deps).catch((err: unknown) => {
          console.warn("[agent] no se pudo sacar la foto de los ficheros al empezar", err);
          return null;
        });
        // Y la de AHORA, comparada con aquélla: el evento `cambios` va antes del
        // `done`, sólo con lo que cambió. Nunca tumba el cierre del turno.
        emitirCambios = async () => {
          try {
            const antes = await fotoAntes;
            if (!antes) return;
            const despues = await cargarFicherosDeLaTerminal(agentSession, deps);
            const ficheros = cambiosEntreFotos(antes, despues);
            if (ficheros.length > 0) emit("cambios", { ficheros });
            // F2 DE LAS APPS WEB · DESHACER EL TURNO ENTERO (spec local
            // 2026-10-07-apps, H7): las MISMAS dos fotos, guardadas con su
            // contenido, para que «Deshacer» devuelva páginas y ficheros de una
            // vez y se niegue si el dueño tocó después lo mismo
            // (`lib/projects/deshacer-turno.ts`). Fail-soft: sin esto no hay
            // Deshacer de servidor, y el chat usa el de siempre.
            try {
              // Con LA FORMA (`RUTA_FORMA`): `data.app` y los títulos de las
              // páginas, para que deshacer una conversión en app la deshaga
              // entera. La de antes, de la fila con la que empezó el turno.
              const alAcabar = await deps.loadProject(projectId, userId).catch(() => null);
              const [fotoA, fotoD] = alAcabar ? [conForma(antes, project.data), conForma(despues, alAcabar.data)] : [antes, despues];
              if (await guardarCambiosDelTurno(projectId, filaId, cambiosDelTurnoParaDeshacer(fotoA, fotoD))) {
                emit("deshacible", { turnId: filaId });
              }
            } catch (err) {
              console.warn("[agent] no se pudieron guardar los cambios del turno para deshacerlo", err);
            }
          } catch (err) {
            console.warn("[agent] no se pudieron calcular los cambios del turno", err);
          }
        };
        // La fila, abierta: desde aquí el turno se puede volver a mirar.
        try {
          await abrirFilaDelTurno(projectId, {
            id: filaId,
            userText: prompt,
            page: pageSlug,
            attachedImage: photosForRow(attachedImages),
            autorId: miembro ? quien : null,
            ...(hiloDelTurno ? { origen: { hiloId: hiloDelTurno.hiloId, ruta: hiloDelTurno.ruta, linea: hiloDelTurno.linea } } : {}),
          });
          filaAbierta = true;
          // EL CHAT DEL EQUIPO: «@Len y @Eli …» es un turno que además avisa a
          // Eli y le deja la mención sin ver. Fail-soft: el turno sigue.
          if (compartido) {
            const mencionados = mencionesValidas(mencionesDe(prompt, genteDelProyecto).personas, genteDelProyecto, quien);
            if (mencionados.length > 0) {
              await apuntarMencionesDelTurno({ projectId, filaId, mencionados }).catch((err) =>
                console.warn("[agent] no se pudieron apuntar las menciones", err),
              );
              const nombre = genteDelProyecto.find((p) => p.userId === quien)?.nombre ?? "";
              void import("@/lib/notifications/dispatch")
                .then(({ scheduleNotification }) =>
                  Promise.all(
                    mencionados.map((recipientUserId) =>
                      scheduleNotification({ type: "mencion", donde: "chat", projectId, recipientUserId, quien: nombre, preview: prompt.slice(0, 200), idioma: null }),
                    ),
                  ),
                )
                .catch((err) => console.warn("[agent] no se pudo avisar de la mención", err));
            }
          }
        } catch (err) {
          console.warn("[agent] no se pudo abrir la fila del turno", err);
        }
        // PIEZA 3 DE LEN 2.5 · QUIEN CONTESTA LAS PREGUNTAS DENTRO DEL TURNO.
        // Sólo si el cliente lo pidió (el chat): la pregunta sale al chat con
        // sus opciones (`question`) y `ask_user_question` espera la respuesta
        // en el almacén del turno (`POST /api/agent/responder`). El evento
        // re-arma el reloj de silencio, y la espera (120 s) queda por debajo de
        // él (180 s). El ■ la suelta.
        // PIEZA 7 · el modo plan, para las dos herramientas que lo cambian. Cada
        // cambio se le dice al chat (`plan`), que mueve su ficha.
        const planMode = {
          active: () => planActivo,
          set: (activo: boolean) => {
            if (activo === planActivo) return;
            planActivo = activo;
            emit("plan", { active: activo });
          },
        };
        // El modo con el que empieza el turno (y `plan` otra vez a cada cambio):
        // la ficha del chat sigue al servidor, no a su copia. Aquí y no junto a
        // `turno`: un turno que la puerta de créditos para no llega a empezar.
        emit("plan", { active: planActivo });
        // PIEZA 8 · EL ENCARGO, ahora que el turno empieza de verdad: se arma lo
        // que la puerta del dueño o el conductor dejaron listo, y se le dice al
        // chat con qué encargo empieza (sólo si hay uno: sin él, nada cambia).
        if (goalActual && goalArmado) armGoal(projectId, goalActual.id);
        if (goalActual) emit("goal", { goal: goalActual, activation: goalArmado ? "armed" : "disarmed" });
        const goal: NonNullable<AgentDeps["goal"]> = {
          get: () => goalActual,
          activation: () => (goalArmado ? "armed" : "disarmed"),
          commit: (next, activation) => {
            goalActual = next;
            goalArmado = next !== null && activation === "armed";
            if (goalArmado && next) armGoal(projectId, next.id);
            else disarmGoal(projectId);
            emit("goal", { goal: next, activation: goalArmado ? "armed" : "disarmed" });
          },
          // De quién es el turno, como `authority.ts` de DeepSeek: una corrección
          // del dueño a media ronda es entrada humana directa (un `steer`).
          authority: () =>
            rondaDelTurno && correcciones.length === 0 ? { kind: "goal-round", ...rondaDelTurno } : { kind: "direct-human" },
          newId: () => `goal-${randomUUID()}`,
        };
        const depsDelTurno = answersQuestions
          ? {
              ...deps,
              planMode,
              goal,
              askUser: async (questions: UserQuestion[]) => {
                emit("question", { questions });
                return esperarRespuesta(turnoId, { timeoutMs: ASK_USER_TIMEOUT_MS, signal: upstreamAbort.signal, preguntas: questions });
              },
            }
          : { ...deps, planMode, goal };
        const result = await runAgentLoop({
          messages,
          tools,
          // Pieza 7: en modo plan el bucle no empuja a editar.
          planModeActive: () => planActivo,
          // La página a medias de un `Write` que aún no dijo su ruta se pinta
          // en la que el turno tiene abierta (`lib/agent/write-preview.ts`).
          activePage: () => agentSession.page,
          // El ■ también corta la espera entre reintentos del proveedor
          // (`lib/agent/retry-policy.ts`).
          signal: upstreamAbort.signal,
          // LA COMPACTACIÓN DENTRO DEL TURNO, como DeepSeek (`lib/agent/compaction/`).
          compaction: {
            policy: COMPACTION_POLICY,
            // `buildAgentMessages` arma [sistema, manual (/AGENTS.md), …historial,
            // petición]: lo resumible empieza en el historial.
            firstIndex: 2,
            // El resultado entero de lo que se poda, en un fichero de /tmp que
            // Len lee con `cat` (`spill-policy` de DeepSeek). Sólo en una terminal
            // viva: arrancarla para esto sería cargar el sitio entero por un aviso.
            saveRecovery: async (path, text) => {
              const terminal = agentSession.terminal;
              if (!terminal?.arrancada) return false;
              await terminal.poner({ [path]: text });
              return true;
            },
          },
          // LA RETENCIÓN DE RESULTADOS GRANDES, como la `spill-policy` de DeepSeek
          // (`lib/agent/compaction/spill.ts`): lo que pase de 12.500 tokens llega
          // recortado y el texto entero queda en /tmp de la terminal. Aquí SÍ se
          // arranca si no lo estaba —un resultado así es justo cuando hace falta
          // poder leer el resto—, y por el camino de `bash` (un comando que no
          // hace nada), que es quien sabe montarla. Sin terminal, entero.
          spill: {
            maxInlineTokens: SPILL_MAX_INLINE_TOKENS,
            save: async (path, text) => {
              if (!terminalEncendida()) return false;
              if (!agentSession.terminal?.arrancada) await runAgentTool(agentSession, deps, NOMBRE_BASH, { command: "true" });
              const terminal = agentSession.terminal;
              if (!terminal?.arrancada) return false;
              await terminal.poner({ [path]: text });
              return true;
            },
          },
          // Con la MISMA cuenta que el cobro de abajo. Sin gasto todavía no se
          // pregunta: `creditsForUsage` tiene un suelo de 1 y un saldo mínimo
          // cerraría el turno antes de empezar.
          excedePresupuesto: (g) =>
            g.inputTokens + g.outputTokens > 0 &&
            creditsForUsage(g.inputTokens, g.outputTokens, brain.creditRate(), g.cachedTokens) >= techo,
          // SIN `maxTurns` NI `maxToolCalls` (H1, 2026-09-25): como el bucle
          // principal de Claude Code, el turno no topa pasos. El dinero se topa
          // por MES (`CREDITS_BY_PLAN`); un cuelgue, el reloj de silencio.
          // EL RUMBO SE PUEDE CORREGIR SIN PARAR. El bucle mira esto entre
          // vueltas; lo que el usuario haya escrito entra como mensaje suyo y
          // el turno gana margen para actuar sobre ello.
          leerDireccion: () => {
            const direccion = leerDireccion(turnoId);
            // 🔴 Y EL OBJETIVO DEL TURNO SE MUEVE CON ELLA.
            //
            // `userPrompt` se fijaba una vez, con lo que venía en el cuerpo de
            // la petición, así que todo lo que pregunta «¿qué pidió el dueño?»
            // seguía leyendo la instrucción que el dueño acababa de RETIRAR.
            // Medido en vivo el 2026-09-03: corrección «brutalista no, deja el
            // diseño», el Agente obedeció, y los ojos suspendieron la página
            // por «no corresponde al estilo brutalista pedido». Se salvó
            // discutiendo con el revisor — con criterio, cuando lo que tocaba
            // aquí era el mecanismo.
            //
            // Se AÑADE, no se sustituye: la corrección casi nunca es el pedido
            // entero («cambia sólo el botón» no dice de qué página habla), y
            // los ojos necesitan las dos mitades para juzgar. El marbete dice
            // cuál manda, que es lo único que el texto suelto no puede decir.
            if (direccion) {
              correcciones.push(direccion);
              avance.tocar();
              const corregido = `${agentSession.userPrompt ?? ""}\n\n[Corrección posterior del usuario — manda sobre lo anterior] ${direccion}`;
              agentSession.userPrompt = corregido;
              // La misma corrección, para quien lee el OTRO campo: `publicar`
              // mira `mensajeDelUsuario` para no reclamar un subdominio que
              // nadie pidió, y un «publícala como X» dicho a media faena
              // llegaba a esa guarda como si no se hubiera dicho.
              agentSession.mensajeDelUsuario = corregido;
            }
            return direccion;
          },
          // `streamWithRetry` es de la época de Gemini: reabre el stream sólo si
          // `brain.openStream` LANZA antes del primer evento. El cliente de
          // Fireworks no lanza —un 429, un 5xx, una red caída o un corte a
          // medias llegan como un `done` de error con su código—, así que los
          // reintentos de verdad, también a mitad de stream, los hace el BUCLE
          // (`lib/agent/retry-policy.ts`, como DeepSeek). Cada evento del modelo
          // rearma el reloj de silencio.
          openStream: (msgs) => {
            // Pieza 7: la sección del modo plan, con el estado de AHORA.
            const conModo = withPlanSection(msgs, planActivo);
            const s = conSenales(streamWithRetry(() => brain.openStream(conModo), { signal: upstreamAbort.signal }), reloj.vivo);
            // `envuelve` deja pasar cada evento tal cual y se queda una copia:
            // no cambia el orden, ni el contenido, ni el momento en que llega.
            return grabadora ? grabadora.envuelve(s) : s;
          },
          // Graceful termination: a tools-OFF stream the loop uses only to
          // compose a closing summary when a step-budget cap is hit, so the turn
          // ends with "here's what I did / what's pending" instead of a red error.
          closeOut: (msgs) => {
            const conModo = withPlanSection(msgs, planActivo);
            const s = conSenales(streamWithRetry(() => brain.closeOut(conModo), { signal: upstreamAbort.signal }), reloj.vivo);
            return grabadora ? grabadora.envuelveCierre(s) : s;
          },
          // EL DIARIO SE ESCRIBE AQUÍ, y no dentro de `runAgentTool`, porque
          // aquí está el único sitio que ve la respuesta ENTERA —y el argumento
          // ENTERO— antes de que el bucle se quede sólo con lo que va al
          // modelo. Es la forma de Claude Code: guardar la llamada y su
          // `toolUseResult` juntos, y pintar el resumen aparte. Fail-soft por
          // construcción — `anotar` no lanza.
          //
          // `args` entra desde el 2026-09-18: sin él, «`editar_texto` falló»
          // no se puede leer, porque falta a qué selector apuntaba. Lo poda el
          // propio diario por tamaño, así que un documento de 42 KB entra como
          // `[43008 bytes]` y no como 42 KB en la fila.
          runTool: async (name, args) => {
            // Nada se escribe antes de la foto del principio.
            await fotoAntes;
            const outcome = await runAgentTool(agentSession, depsDelTurno, name, args);
            diario.anotar(name, outcome.response, args);
            // LA CARPETA (pieza 9 de Len 2.5, carril B): los ficheros que cambió
            // esta herramienta, cada uno con la versión de su «antes», para
            // que «Deshacer» los devuelva con la página o no se ofrezca.
            if (outcome.ficherosTocados?.length) emit("ficheros", { ficherosTocados: outcome.ficherosTocados });
            return outcome;
          },
          // ⚰️ Aquí se enchufaban `medirParaElModelo` (la medición con navegador
          // que volvía al MODELO tras cada tanda) y `verifyTurn` (los ojos al
          // cerrar, con su tarjeta `verificar_diseno`), los dos tras la palanca
          // `OPENLEN_AGENT_VISION`. Retirados el 2026-10-06 (plans/crear-es-len):
          // DeepSeek no mide nada por su cuenta, y la regla es DeepSeek. Lo que
          // queda del navegador del turno es lo que pide Len: `view_page` y
          // `use_page`, por `medirDelTurno` (arriba).
          // Deja pasar el evento TAL CUAL y se queda una copia de lo que hace
          // falta para registrar el turno: no cambia el orden, ni el contenido,
          // ni el momento en que llega al cliente.
          emit: (ev) => {
            registro.observar(ev);
            // Un reintento cambia la fila: `registro.texto` acaba de soltar lo
            // descartado, y `avance` la escribe ya, como tras un `text`. (El
            // reloj de silencio no va por aquí: lo rearma el `emit` de arriba
            // con cualquier evento.)
            if (ev.type === "text" || ev.type === "action" || ev.type === "retry") avance.tocar();
            emit(ev.type, ev);
          },
          onMutacion: () => {
            mutoDurable = true;
          },
          // H12-c · LO QUE LAS GUARDAS RECHAZARON también va al diario: nunca
          // pasa por `runTool`, y sin esto un turno que se estrelló contra la
          // guarda quedaba escrito como uno con tres llamadas y un tope.
          onRechazo: (tool, args, motivo) => {
            diario.anotar(tool, { ok: false, rechazada: true, error: motivo }, args);
          },
        });
        mutoDurable = mutoDurable || result.mutoDurable;
        transcripcionDelTurno = result.transcripcion ?? null;
        corte = corteDelTurno({ ...result, mutoDurable: mutoDurable || estadoCambiado() });
        detenido = canceladoAProposito && result.errorCode === "cancelled";

        // ⚰️ Aquí se guardaba la suite de la página (`marcarRegresiones` →
        // `actualizarSuite`). Ver arriba, donde se recogía: se fue con los ojos.
        // F2-T9 billing ruling (Jesús 2026-07-07): a turn that ended on a
        // terminal error (stopReason error/cancelled/max_tokens, or the
        // maxTurns/maxToolCalls caps) debits 0 credits — the user got no
        // usable output. ⚠️ Dos excepciones, las dos «hasta el techo»: el tope
        // de gasto (30/09) y el ■ del dueño (03/10, «como DeepSeek»). A clean end_turn finish charges normally, even
        // when a tool inside it returned {ok:false} as data or the turn
        // ended waiting on a confirm card.
        // El importe se calcula SIEMPRE, se cobre o no. Hasta el 25/08 vivía
        // dentro de la rama que cobra, así que el diario del cargo perdido
        // registraba el hecho y no el dinero: se podían contar los casos pero no
        // sumarlos, que es justo la pregunta que hay que responder.
        const { inputTokens, outputTokens, cachedTokens, thinkingTokens } = result.usage;
        const credits = Math.max(
          1,
          creditsForUsage(inputTokens, outputTokens, brain.creditRate(), cachedTokens),
        );
        if (!result.terminalError && !result.sinCobro) {
          // La entrada cacheada SÍ se cobra más barata desde el 2026-08-28:
          // `creditsForUsage` recibe `cachedTokens` y les aplica la tarifa
          // `cached` de `lib/credits.ts`. Este comentario decía lo contrario
          // —«visibility only»— porque describía la factura de Google, y era
          // cierto cuando el turno corría en Gemini. Hoy corre en Fireworks,
          // donde la caché es por réplica y el descuento es NUESTRO de aplicar.
          const cachedPct = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0;
          console.log(
            `[agent] ${brain.modelId} — in ${inputTokens} (cached ${cachedTokens}, ${cachedPct}%) / out ${outputTokens}` +
              // QUÉ PARTE DE LA SALIDA LA PUSO EL DIAL DE ESFUERZO. Los tokens
              // de razonamiento viajan DENTRO de `outputTokens` — lo afirma el
              // validador de `fireworks-client.ts`, que descarta la respuesta
              // si `thinkingTokens > outputTokens` —, así que `creditsForUsage`
              // ya los cobra a tarifa de salida sin decir cuántos son. Sin esta
              // cifra, calibrar la escalera de esfuerzo es mirar el recibo total
              // y adivinar. Sólo se imprime cuando el modelo pensó, para que un
              // turno sin razonamiento deje la línea igual que antes.
              (thinkingTokens > 0 ? ` / pensados ${thinkingTokens}` : "") +
              // CUANTO SE ACERCO AL TOPE, que es lo que no se podia saber.
              //
              // El tope AGOTADO ya se registra: `finishOnCap` cierra con
              // `terminalError: true` en sus dos salidas —tambien con el cierre
              // elegante, que solo se salta el evento `error`— asi que todo tope
              // cae en la rama de abajo y sale como `motivo=turn_limit`.
              //
              // Lo que no existia en ninguna parte es el turno que NO lo toco.
              // Y esa es la mitad que hace interpretable la otra: contar los
              // topes dice cuantas veces apreto, no si esta a punto de apretar.
              // Un turno de 5 vueltas contra un tope de 6 no dejaba rastro, y
              // decidir si subir el tope mirando solo los ceros es cambiar un
              // numero a ciegas. Con la distribucion, `grep -o 'vueltas=[0-9]*'`
              // sobre el diario la contesta sin gastar una corrida pagada.
              //
              // Va al FINAL y con `=`: al final para que la linea de antes siga
              // siendo un prefijo exacto y los greps que ya existen no se
              // enteren; con `=` porque esto nace para contarse a maquina, igual
              // que el `motivo=` de la rama de abajo.
              ` / vueltas=${result.turns} llamadas=${result.toolCalls}`,
          );
          await debitCredits(userId, credits);
          if (miembro) await sumarGasto(projectId, quien, credits);
          cobrado = credits;
        } else if (result.topeAlcanzado === "budget_limit") {
          // 🔴 AL TECHO SE COBRA LO GASTADO, HASTA EL TECHO (Jesús, 2026-09-30).
          //
          // Los demás topes cobran 0 (la regla del 07/07: «el usuario no recibió
          // nada utilizable»). Éste no: lo hecho hasta el techo queda guardado y
          // el cierre lo cuenta. Cobrar 0 convertiría el techo en un pase gratis
          // de hasta 30 créditos cada vez. Lo que pase del techo —la última
          // llamada y el cierre— lo paga la casa: el techo es la promesa.
          const alTecho = Math.min(credits, techo);
          console.log(
            `[agent] tope de gasto — ${alTecho} credits (gastado ${credits}, techo ${techo})` +
              ` / vueltas=${result.turns} llamadas=${result.toolCalls} motivo=budget_limit`,
          );
          await debitCredits(userId, alTecho);
          if (miembro) await sumarGasto(projectId, quien, alTecho);
          cobrado = alTecho;
        } else if (canceladoAProposito && result.errorCode === "cancelled") {
          // 🔴 EL ■ COBRA LO QUE SE USÓ, HASTA EL TECHO (Jesús, 03/10: «como
          // DeepSeek lo hace»).
          //
          // En el arnés de DeepSeek el usuario paga cada token que el modelo
          // llegó a gastar, también en un turno cancelado: su contador cierra
          // cada intento termine como termine. Aquí el ■ cobraba 0 por la regla
          // del 07/07, que es de cuando el ■ deshacía lo hecho; desde 2.1 lo hecho
          // se queda, y cobrar 0 era un pase gratis igual que el del techo (30/09).
          //
          // Sólo el ■ de verdad: `canceladoAProposito` lo pone el `abortar` de
          // `POST /api/agent/cancelar`. El perro del silencio también aborta, y
          // eso es nuestro: sigue por la rama de abajo, en 0. Sin tokens gastados
          // —el ■ llegó antes de la primera respuesta— no hay nada que cobrar: el
          // suelo de 1 de `credits` es para un turno que sí trabajó.
          const usado = inputTokens + outputTokens > 0 ? Math.min(credits, techo) : 0;
          console.log(
            `[agent] ■ del dueño — ${usado} credits (gastado ${credits}, techo ${techo})` +
              ` / vueltas=${result.turns} llamadas=${result.toolCalls} motivo=cancelled`,
          );
          if (usado > 0) await debitCredits(userId, usado);
          if (miembro) await sumarGasto(projectId, quien, usado);
          cobrado = usado;
        } else if (!result.terminalError && result.sinCobro) {
          // 🔴 CERRADO CON ELEGANCIA, SIN COBRO (revisión pre-deploy del
          // 2026-09-22). El bucle redacta el cierre de dos turnos que antes
          // morían en el tope —el modelo que insiste en lo rechazado y el
          // guardado que choca dos veces—, y el tope no se cobra. Cerrarlos mejor
          // no puede cambiar quién paga. Mismo `cargo perdido` que el tope, para
          // que `grep` los sume con él.
          //
          // El choque va por `console.error`: dos choques seguidos tras los
          // reintentos internos casi nunca son un cruce inocente, y el único caso
          // de producción (15/09) fue un fallo nuestro. Tiene que verse.
          const linea = `[agent] turno sin cobro — 0 credits${
            mutoDurable ? ` (MUTÓ: cargo perdido de ${credits})` : ""
          } motivo=${result.sinCobro}`;
          if (result.sinCobro === "conflicto") console.error(`${linea} proyecto=${projectId}`);
          else console.log(linea);
        } else {
          // 🔴 EL CARGO PERDIDO, dicho en voz alta. La regla de facturación
          // (Jesús, 2026-07-07) es 0 créditos en terminal — pero cuando el
          // turno YA mutó, «no hubo salida utilizable» deja de ser cierto: la
          // página del usuario cambió. Se registra para poder decidirlo con
          // datos; NO se cobra por decisión propia.
          // DECISIÓN de Jesús (2026-08-25): medir antes de cambiar la regla. Por
          // eso el importe va en la línea — `grep "cargo perdido"` sobre el diario
          // suma lo que se regala, en vez de contar cuántas veces se regala algo.
          // 🔴 Y POR QUÉ TERMINÓ MAL, que es lo que faltaba. La línea era la
          // misma para «el dueño pulsó ■», «Fireworks se cayó» y «se acabaron
          // las vueltas» — tres cosas que piden tres reacciones distintas, y
          // sólo una es una avería. El 2026-09-03 costó una investigación
          // entera: un turno abortado al remontarse el panel se persiguió como
          // un fallo del proveedor, con re-corrida de un documento de 206 KB
          // para descartar el tamaño.
          //
          // `motivo=` va SUELTO al final y el prefijo no se toca: los greps que
          // ya existen sobre `terminal-error` y `cargo perdido` siguen valiendo.
          const motivo = result.errorCode ?? result.topeAlcanzado ?? "desconocido";
          console.log(
            `[agent] terminal-error turn — 0 credits${
              mutoDurable ? ` (MUTÓ: cargo perdido de ${credits})` : ""
            } motivo=${motivo}`,
          );
        }
        // `mutoDurable` viaja en el terminal: el cliente lo necesita para NO
        // pintar en rojo un turno cuyo cambio ya vive en la base. Sin esto el
        // usuario pulsaba «Reintentar» y aplicaba el mismo cambio dos veces.
        // 🔴 Y EL TOPE VIAJA EN EL TERMINAL. `topeAlcanzado` existía en
        // `AgentLoopResult` desde el 30/08 con un comentario explicando por qué
        // hacía falta —«el caso del tope suele ser el MENOS visible: cuando
        // `closeOut` redacta el cierre elegante no se emite ningún evento
        // `error`»— y no salía de la ruta: lo leían las evals y nadie más. El
        // usuario veía un turno verde y limpio sobre una faena a medias.
        // LA FILA, CERRADA ANTES DE AVISAR: quien lea la conversación al recibir
        // el `done` —el panel, Len-Bench— tiene que encontrarla ya completa.
        // Las ramas que no cobran dejan `cobrado` en null: el modelo costó 0. Lo
        // que cobraron las herramientas se suma siempre: ya está cobrado, acabe
        // como acabe el turno (N42).
        cobrado = (cobrado ?? 0) + chargedByTools;
        // 🔴 PIEZA 8 · EL CONDUCTOR DE RONDAS (`goal-round-driver` de DeepSeek),
        // ANTES de cerrar la fila: lo que decida es parte de la foto que se
        // guarda. Las paradas son las suyas: el ■ en una ronda la deja en pausa
        // (sólo el dueño la reanuda) y en otro turno desarma; un turno que
        // revienta desarma; una pregunta sin contestar espera al dueño (su
        // respuesta es un turno, y al cerrarlo se sigue); al tope de rondas,
        // atascado. El techo de un turno NO para (cada ronda trae el suyo, y
        // Jesús lo dijo: sin tope propio de créditos); lo que para es el saldo.
        let siguiente: GoalSnapshot | null = null;
        let rondaParada: "credits" | null = null;
        if (goalActual) {
          const cancelado = canceladoAProposito && result.errorCode === "cancelled";
          const revento = result.terminalError && !cancelado && result.topeAlcanzado === null;
          // El conductor de DeepSeek no mira preguntas: reserva la ronda siguiente
          // al quedar libre. Aquí una pregunta CIERRA el turno (pieza 3), y sólo
          // entonces se espera al dueño; si el turno siguió (lo escrito por el
          // dueño, lote 7-8), encadena como allí. Lo dice el bucle, no las tarjetas.
          const preguntaSinContestar = result.endedOnQuestion === true;
          if (cancelado) {
            if (rondaDelTurno && goalActual.phase === "active") goal.commit(pauseGoal(goalActual, goalActual), "disarmed");
            else if (goalArmado) goal.commit(goalActual, "disarmed");
          } else if (revento) {
            if (goalArmado) goal.commit(goalActual, "disarmed");
          } else if (!preguntaSinContestar && goalActual.phase === "active" && goalArmado) {
            if (goalActual.roundsStarted >= goalActual.maxGoalRounds) {
              goal.commit(
                blockGoal(goalActual, goalActual, {
                  code: "round-limit",
                  message: `Goal reached its configured limit of ${goalActual.maxGoalRounds} rounds.`,
                }),
                "disarmed",
              );
            } else {
              const saldo = await getCreditState(userId).catch(() => null);
              if (!saldo || saldo.balance < 1) {
                goal.commit(goalActual, "disarmed");
                rondaParada = "credits";
              } else {
                siguiente = goalActual;
              }
            }
          }
        }
        await cerrarFila();
        // LA RONDA SIGUIENTE, con la fila de ésta ya escrita (su historial la
        // ve entera) y ANTES del `done`, que la anuncia: el chat la sigue como
        // sigue un turno que llega en curso del servidor (Len 2.1). Nadie lee su
        // stream —su cuerpo se cancela—, así que corre como un turno sin cliente.
        if (siguiente) {
          const fila = randomUUID();
          try {
            const res = await correrTurno(
              userId,
              {
                projectId,
                prompt: "",
                turnId: fila,
                ...(pageSlug ? { page: pageSlug } : {}),
                ...(esfuerzoDelTurno ? { esfuerzo: esfuerzoDelTurno } : {}),
                ...(body?.mode !== undefined ? { mode: body.mode } : {}),
                ...(body?.zonaHoraria !== undefined ? { zonaHoraria: body.zonaHoraria } : {}),
              },
              { url: req.url, signal: new AbortController().signal },
              { round: { goalId: siguiente.id, revision: siguiente.revision, round: siguiente.roundsStarted + 1 } },
            );
            if (res.ok && res.headers.get("content-type")?.startsWith("text/event-stream")) {
              void res.body?.cancel().catch(() => undefined);
              rondaSiguiente(filaId, fila);
              siguienteFila = fila;
            } else {
              console.warn(`[agent] la ronda siguiente no arrancó (${res.status})`);
              disarmGoal(projectId);
            }
          } catch (err) {
            console.warn("[agent] la ronda siguiente no arrancó", err);
            disarmGoal(projectId);
          }
        }
        // Lo que cambió, antes del `done`: el cliente lo engancha a este turno.
        // Sin llamadas a herramientas no pudo cambiar nada y no se mira.
        if (result.toolCalls > 0) await emitirCambios();
        emit("done", {
          turns: result.turns,
          toolCalls: result.toolCalls,
          // Pieza 8: el encargo como queda, y la ronda que sigue (o por qué no).
          ...(goalActual ? { goal: goalActual, goalActivation: goalArmado ? "armed" : "disarmed" } : {}),
          ...(siguienteFila ? { round: { next: siguienteFila } } : rondaParada ? { round: { stopped: rondaParada } } : {}),
          ...(mutoDurable ? { mutoDurable: true } : {}),
          ...(result.topeAlcanzado ? { topeAlcanzado: result.topeAlcanzado } : {}),
          // LO QUE COBRÓ Y TARDÓ, en números (centicréditos y ms): la frase la
          // compone el cliente en su idioma, como el tope (plans/new-chat/).
          centicredits: cobrado,
          durationMs: Date.now() - empezo,
          // 🔴 EL CORTE DE LA VENTANA, TAMBIÉN AL USUARIO.
          //
          // Al MODELO ya se le decía (`conversacionRecortada` → la nota de
          // `buildAgentContext`), para que pueda contestar «de eso ya no me
          // acuerdo» en vez de nombrar el turno más viejo que tenga a mano. Al
          // usuario no se le decía nada: veía a Len olvidar y no tenía forma de
          // saber por qué, ni de saber que hablar más largo empeora la memoria.
          //
          // Van los DOS números, no un booleano: «ve 12 de 20» es un hecho que
          // el usuario puede usar —resumirle lo importante, o abrir otra
          // conversación—; «memoria recortada» es una disculpa.
          //
          // Números, no prosa: la frase la compone el cliente en el idioma del
          // usuario, como el aviso de tope. Ver [[error-del-servidor-como-dato-no-prosa]].
          ...(turnosTotales > ventanaVisible
            ? { ventana: { visibles: ventanaVisible, totales: turnosTotales } }
            : {}),
        });
        close();
      } catch (err) {
        console.error("[agent] stream failed", err);
        // Pieza 8: el bucle reventó: el encargo se desarma y no se encadena (DeepSeek, `agent/error`).
        if (goalArmado) {
          goalArmado = false;
          disarmGoal(projectId);
        }
        const code: AgentErrorCode = "upstream";
        corte = corteDelTurno({ terminalError: true, topeAlcanzado: null, errorCode: code, mutoDurable: mutoDurable || estadoCambiado() });
        // La fila, cerrada antes de avisar, como en el final bueno.
        await cerrarFila();
        emit("error", { message: err instanceof Error ? err.message : "Unknown error", code });
        // Y aquí también: el bucle reventó, pero si ya había escrito, el cambio
        // es igual de durable. El `done` cierra el turno con el aviso en vez de
        // dejar un rojo sobre una página que sí cambió.
        if (mutoDurable) {
          await emitirCambios();
          emit("done", { turns: 0, toolCalls: 0, mutoDurable: true });
        }
        close();
      } finally {
        reloj.parar();
        // La terminal del turno (F1, plans/len-agente-2026), si se usó: su hilo
        // muere con el turno. Nunca tumba el cierre, y no se ESPERA: con el
        // `await` el cierre del navegador de abajo llegaba tarde (lo cazó
        // route.test.ts, «el navegador del turno se cierra al acabar»).
        void cerrarTerminalDeLaSesion(agentSession).catch(() => undefined);
        // 🔴 LA FILA DEL TURNO, TAMBIÉN AQUÍ, por si ningún final llegó a
        // cerrarla (`cerrarFila` es idempotente). ANTES de sacar el turno del
        // mapa: mientras el mapa lo tiene, una fila `en_curso` se lee como viva
        // (`turnoDeLaFila`); fuera de él, como huérfana y cortada.
        await cerrarFila();
        // EL TURNO SE CIERRA PASE LO QUE PASE. Si no, su fila se queda con la
        // correccion que nadie leera y ocupando sitio en el mapa.
        cerrarTurno(turnoId);
        // CUÁNTOS TURNOS TERMINAN SIN NADIE MIRANDO, contado desde el día uno.
        if (clienteSeFue) console.log(`[agent] turno terminado sin cliente turno=${turnoId}`);
        // 🔴 LEN 2.1 · Y SE LE AVISA (diagnóstico §4.4 punto 5). Es la otra mitad
        // de «cierra, Len sigue, te aviso». Sólo si el turno hizo algo y nadie
        // lo paró a propósito: quien pulsó ■ ya sabe que acabó. Por push (el
        // correo lo salta), con la clave de la fila para no repetir. El módulo
        // se carga sólo aquí: la inmensa mayoría de turnos no lo necesita.
        // FAIL-SOFT: un aviso que no sale no le cuesta el turno a nadie.
        if (clienteSeFue && !canceladoAProposito && registro.hayAlgo(mutoDurable) && siguienteFila === null) {
          try {
            const { scheduleNotification } = await import("@/lib/notifications/dispatch");
            await scheduleNotification(
              avisoDelTurno({ projectId, userId, texto: registro.texto, tarjetas: registro.tarjetas }),
              `len-turno:${filaId}`,
            );
          } catch (err) {
            console.warn("[agent] no se pudo avisar del turno terminado", err);
          }
        }
        // Y EL NAVEGADOR TAMBIÉN. Un Chromium por turno que nadie cierra es una
        // fuga con nombre y apellidos en una caja de 4 GB. Va aquí, con el
        // cierre del turno, por el mismo motivo: el turno que revienta es
        // justamente el que se lo dejaría abierto.
        await cerrarNavegadorDelTurno();
        // FAIL-SOFT y del todo: una grabación es una herramienta de
        // diagnóstico, y no puede costarle el turno a nadie ni ensuciar la
        // respuesta. Si el directorio no existe, si el disco está lleno o si el
        // JSON no serializa, se dice por consola y se sigue.
        if (grabadora && !grabadora.vacia) {
          try {
            const grabado = {
              ...grabadora.resultado({
                modelId: brain.modelId,
                requestId: projectId,
                ...(mode === "dynamis" ? { mode } : {}),
              }),
            };
            const { writeFile, mkdir } = await import("node:fs/promises");
            const { join } = await import("node:path");
            await mkdir(dirGrabacion!, { recursive: true });
            const destino = join(dirGrabacion!, nombreDeFichero(grabado));
            await writeFile(destino, JSON.stringify(grabado, null, 2), "utf8");
            console.log(`[agent] turno grabado en ${destino}`);
          } catch (err) {
            console.warn("[agent] no se pudo grabar el turno", err);
          }
        }
      }
    },
    // 🔴 EL TURNO NO MUERE CON EL CLIENTE (Len 2.1).
    //
    // Hasta aquí esto abortaba el modelo, así que cerrar la pestaña, perder la
    // red o que el móvil se durmiera mataba el turno a media faena
    // (diagnóstico de 2.1, §3.1). La vara es Claude Code: el trabajo pertenece a
    // la sesión, no a la vista; al desconectarse, «if the session still exists
    // it keeps running». El canal ya descarta en silencio lo que no puede
    // escribir (`lib/ai/sse.ts`), así que el bucle sigue y la fila se escribe
    // igual en el `finally`.
    //
    // Parar es una petición aparte: `POST /api/agent/cancelar`. Y lo que acota
    // un turno sin nadie delante es el reloj de silencio (un cuelgue) y el
    // techo de dinero del turno, no la conexión.
    cancel() {
      clienteSeFue = true;
      console.log(`[agent] el cliente se fue; el turno sigue turno=${turnoId}`);
    },
  });

  return new Response(sse, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** El cuerpo vive en lib/ai/sse; el nombre local se queda porque lo usan
 *  decenas de sitios y renombrarlos no aclara nada. */
/**
 * `code` es para los fallos que un USUARIO puede provocar; `message` para los
 * que sólo alcanza un cliente roto o nosotros.
 *
 * POR QUÉ LA DISTINCIÓN. El panel pinta `error` TAL CUAL cuando es una cadena
 * (chat-panel.tsx), así que cada `errorJson(413, "Page too large…")` llegaba a
 * un usuario japonés en inglés. La regla ya estaba escrita en este repo —código
 * y campos, que el cliente componga— y aquí no se aplicaba.
 *
 * No se convierten los diez: `projectId is required` sólo lo ve un `curl`, y
 * traducir un fallo sin lector es trabajo perdido. Se convierten los que un
 * usuario SÍ toca. ⚠️ `unauthorized` y los 404 SÍ los alcanza la interfaz (una
 * sesión que caduca, un proyecto o una página borrados en otra pestaña; visto en
 * el taller el 03/10, N44 de plans/new-chat/): el chat los compone por el ESTADO
 * HTTP, sin código (`components/workspace-v2/chat/http-error.ts`).
 */
function errorJson(status: number, message: string, code?: string): Response {
  return jsonResponse(code ? { error: message, code } : { error: message }, status);
}

// `@Len` desde un hilo del código: el servidor llama al turno sin la puerta
// HTTP, como la ronda de un encargo (lib/agent/turnos-desde-el-servidor.ts).
registrarCorredorDeTurnos((userId, body, req, opts) =>
  conAutor(userId, () => correrTurno(userId, body as CuerpoDelTurno, req, opts)),
);

export const OPTIONS = respuestaPrevia;
