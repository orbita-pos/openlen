import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { correoDelUsuario } from "@/lib/movil/llaves";
import type { InlineImage } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { componerMedicion } from "@/lib/agent/aviso-medido";
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
import { inlineOwnAssets } from "@/lib/projects/inline-own-assets";
import { documentoMedible, vistaParaMedir } from "@/lib/lienzo/documento";
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
  transcripcionParaGuardar,
  type FilaDelHistorial,
  type MensajeDelHistorial,
} from "@/lib/agent/transcripcion";
import { conseguirFotos, fotosQueCaben } from "@/lib/agent/fotos-de-la-conversacion";
import { turnosParaElHistorial } from "@/lib/projects/chat";
import type { Message } from "@/lib/ai-gateway";
import { ESFUERZOS } from "@/lib/agent/esfuerzo";
import { modeOfTurn } from "@/lib/agent/dynamis";
import { getEsfuerzoGuardado } from "@/lib/agent/esfuerzo-guardado";
import { ZONA_SIN_DATO, zonaValida } from "@/lib/resultados/zona";
import { guardarZona, leerZona } from "@/lib/resultados/zona-guardada";
import { getVersionHtml, listVersions } from "@/lib/projects/versions";
import { loQueCambioElDueno } from "@/lib/agent/cambios-del-dueno";
import { cambiosParaElAgente } from "@/lib/projects/cambios-para-el-agente";
import { runAgentLoop, type AgentErrorCode, type AgentLoopResult, type VerifyOutcome } from "@/lib/agent/loop";
import { randomUUID } from "node:crypto";

import { abrirTurno, cerrarTurno, leerDireccion } from "@/lib/agent/direcciones";
import { crearDiarioDelTurno } from "@/lib/agent/diario-del-turno";
import { corteDelTurno, crearRegistroDelTurno } from "@/lib/agent/registro-del-turno";
import { actualizarSuite, marcarRegresiones, migrarSuite, vivas } from "@/lib/agent/pruebas-de-la-pagina";
import type { FalloSpec } from "@/lib/agent/prueba-js";
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
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";
import { cerrarTerminalDeLaSesion } from "@/lib/agent/terminal/herramienta";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { cambiosEntreFotos } from "@/lib/agent/cambios-del-turno";
import { observarPagina, verifyEditedPage } from "@/lib/agent/verify";
import { usarPagina } from "@/lib/agent/usar-pagina";
import {
  createVisualQualityRendererPool,
  renderVisualQualityViewports,
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
// Body: { projectId, prompt, history?, attachedImage?, scope? }
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
const MAX_PROMPT_TOKENS = 240_000;

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

  const body = (await req.json().catch(() => null)) as {
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
    /** EL ESFUERZO DE ESTE TURNO, fijado por el cliente al ENVIAR. Ver
     *  `esfuerzoDelTurno` más abajo: se manda por turno, no se lee en vivo. */
    esfuerzo?: unknown;
    /** EL MODO DE ESTE TURNO: `"dynamis"` o nada (Len). Viaja como el esfuerzo;
     *  se sanea con `modeOfTurn` (`lib/agent/dynamis.ts`). */
    mode?: unknown;
    /** La zona IANA del navegador (plans/len-resultados/diseno.md §7). Se
     *  sanea con `zonaValida`: entra de fuera. */
    zonaHoraria?: unknown;
  } | null;

  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
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
  if (prompt.length === 0 || prompt.length > MAX_PROMPT) return errorJson(400, `prompt must be 1–${MAX_PROMPT} chars`, "promptLength");
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
  // turno y cada `mirar_pagina` que pida el modelo. En una página de 8,8 KB la
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
  // cerrar. +2,16 s en caliente, por nada.
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
  const medirDocumento = async (html: string): Promise<VisualQualityViewports | null> => {
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
    // EL SUBDOMINIO DEL PROYECTO, para el sustituto de `/api/d`: con él juzga
    // `/api/d/<sub>/<almacén>` como lo haría la página publicada. Se lee al
    // medir, no al construir esto: el proyecto se carga unas líneas más abajo.
    // Mientras no se haya cargado, AUSENTE — no se juzga ese tramo.
    const opciones = subDelProyecto === undefined ? {} : { sub: subDelProyecto };
    return pool ? pool.render(html, opciones) : renderVisualQualityViewports(html, {}, opciones);
  };
  let subDelProyecto: string | null | undefined;
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
    }),
    // `mirar_pagina` mide por el mismo navegador que los ojos: es la herramienta
    // que más veces lo abre en un turno.
    observarPagina: (input: Parameters<typeof observarPagina>[0]) =>
      observarPagina(input, { medir: medirDelTurno }),
    // `usar_pagina` (H9) abre SU navegador por visita y no el del turno: cada
    // visita tiene que empezar limpia (sin lo guardado por la anterior) y lleva
    // su propio preludio. El subdominio, para que el sustituto de `/api/d` juzgue
    // las rutas como la publicada.
    usarPagina: (input: Omit<Parameters<typeof usarPagina>[0], "sub">) =>
      usarPagina(subDelProyecto === undefined ? input : { ...input, sub: subDelProyecto }),
  };
  const project = await deps.loadProject(projectId, userId);
  if (!project) return errorJson(404, "project not found");
  subDelProyecto = project.subdomain ?? null;
  const pageSlug =
    pageSlugRaw && project.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");
  // LA VISTA DEL TURNO — el contexto con el que se hornea todo lo que se mide,
  // para que sea el mismo documento que el taller le está enseñando al usuario.
  // Ver D5 de la spec 2026-09-15.
  const vistaDelTurno = vistaParaMedir(projectId, project, pageSlug);
  // Todas cargadas: las diferidas y ToolSearch (H2) se retiraron en Len 2.1.
  const tools = buildFunctionDeclarations(process.env, {}, mode);
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
  const filasDelHistorial: FilaDelHistorial[] = await turnosParaElHistorial(projectId, TURNOS_DEL_HISTORIAL).catch(
    () => [],
  );
  // El historial se ARMA más abajo, después de conseguir las fotos de la
  // conversación (A): sin ellas, la foto de un turno anterior no tendría dónde ir.
  const dichoAntes = sanearDichoAntes(body?.dichoAntes);

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

  // Validate the attached image (optional) — same shape/limits/posture as
  // ai-design: must be a valid http(s) URL (root-relative resolved against
  // req.url), invalid attachments are silently dropped rather than a 400
  // (the prompt itself still has value).
  let attachedImage: { url: string; alt?: string } | null = null;
  if (body?.attachedImage && typeof body.attachedImage === "object") {
    const url =
      typeof body.attachedImage.url === "string" ? body.attachedImage.url.trim() : "";
    if (url.length > 0 && url.length <= ATTACHED_URL_MAX) {
      try {
        const parsed = new URL(url, req.url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const alt =
            typeof body.attachedImage.alt === "string"
              ? body.attachedImage.alt.trim().slice(0, ATTACHED_ALT_MAX)
              : "";
          attachedImage = alt ? { url: parsed.href, alt } : { url: parsed.href };
        }
      } catch {
        /* leave attachedImage null */
      }
    }
  }

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
  const masNuevaPrimero = [attachedImage?.url, ...[...filasDelHistorial].reverse().map((f) => f.attachedImage?.url)].filter(
    (u): u is string => !!u,
  );
  const fotos = fotosQueCaben(masNuevaPrimero, await conseguirFotos(masNuevaPrimero, { origen: req.url, signal: req.signal }));
  const pixelesDe = (url: string): InlineImage | null => {
    const f = fotos.get(url);
    return f && f !== NO_CABE ? f : null;
  };
  const attachedInline: InlineImage | null = attachedImage ? pixelesDe(attachedImage.url) : null;
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
      // Es una consulta por turno, la misma que ya hacen `activar_modulo` y la
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
  // Ya no hace falta: cada almacén es el fichero /datos/<almacén>.json (H3) y
  // Read le da las filas, las de `lectura` y las de `propio`/`añadir`. El
  // problema que esto resolvía —el modelo sin ver lo que la página guarda— lo
  // resuelve el fichero, no un bloque cosido al prompt.

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
    prompt,
    history,
    // ¿El turno anterior fue MUDO? Se deriva del historial que acaba de
    // sanearse: el último mensaje del asistente sin `functionCalls` significa
    // que no tocó nada. Es un hecho estructural, no una lectura de su prosa.
    // Un historial vacío (primer turno) no dispara nada.
    turnoAnteriorMudo: turnoAnteriorMudoDe(history),
    attachedImage: attachedImage
      ? { ...attachedImage, ...(attachedInline ? { visible: true } : {}) }
      : null,
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
          conImagen: attachedImage !== null,
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
  if (attachedInline) messages[messages.length - 1] = { ...messages[messages.length - 1]!, images: [attachedInline] };

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
    // H3 — la memoria que va en el contexto cuenta como LEÍDA, como el CLAUDE.md
    // que Claude Code siembra al empezar: se le añade una línea sin un Read.
    leidos: new Map([
      // H4 · y lo que el turno anterior dejó leído, si no cambió y sigue a la
      // vista (lo leído, como lo apunta Claude Code). Las páginas, con el mismo
      // texto que les daría Read; /memoria va aparte, y /datos se relee.
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
      // CÓMO QUEDA LA SUITE DE LA PÁGINA al cerrar el turno. Se recoge aquí
      // —como el registro o `mutoDurable`— porque quien lo sabe es el veredicto
      // de los ojos, que ocurre dentro del bucle, y quien lo guarda es la
      // escritura del final. Ver PROMPT-la-suite-de-la-pagina.md.
      type SuiteDelTurno = {
        turno?: { codigo: string; fallos: readonly FalloSpec[]; pagina: string | null };
        retirar: string[];
        /** Ids de las promesas que este turno llegó a correr, y de las que
         *  fallaron. Las necesita el contador: sin «cuáles se comprobaron», un
         *  turno en la home daría por arregladas las del menú. */
        comprobadas: string[];
        rotas: string[];
      };
      let suiteDelTurno: SuiteDelTurno | null = null;
      // LO QUE COBRÓ EL TURNO (centicréditos) y CUÁNDO EMPEZÓ: el cierre del chat
      // los enseña (plans/new-chat/, decisión de Jesús del 03/10), en el `done` y
      // en la fila para que no desaparezcan al recargar. `null` = aún no se cobró.
      let cobrado: number | null = null;
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
        if (registro.hayAlgo(mutoDurable)) {
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
              transcript: transcripcionDelTurno
                ? transcripcionParaGuardar(transcripcionDelTurno, agentSession.leidos ?? new Map())
                : null,
            });
          } catch (err) {
            console.warn("[agent] no se pudo registrar el turno", err);
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
      abrirTurno(turnoId, userId, Date.now(), {
        abortar: () => {
          canceladoAProposito = true;
          upstreamAbort.abort();
        },
        filaId,
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
        const techo = techoDelTurno(creditState);
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
            const ficheros = cambiosEntreFotos(antes, await cargarFicherosDeLaTerminal(agentSession, deps));
            if (ficheros.length > 0) emit("cambios", { ficheros });
          } catch (err) {
            console.warn("[agent] no se pudieron calcular los cambios del turno", err);
          }
        };
        // La fila, abierta: desde aquí el turno se puede volver a mirar.
        try {
          await abrirFilaDelTurno(projectId, { id: filaId, userText: prompt, page: pageSlug, attachedImage });
          filaAbierta = true;
        } catch (err) {
          console.warn("[agent] no se pudo abrir la fila del turno", err);
        }
        const result = await runAgentLoop({
          messages,
          tools,
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
          // streamWithRetry rides out transient Gemini 503 spikes: it re-opens
          // the stream on a retryable error thrown BEFORE any event (safe — the
          // model produced nothing yet), and honors upstreamAbort so a retry
          // never outlives the silence clock. A mid-stream failure still
          // propagates (no double-applied tool calls). Cada evento del modelo
          // rearma el reloj de silencio.
          openStream: (msgs) => {
            const s = conSenales(streamWithRetry(() => brain.openStream(msgs), { signal: upstreamAbort.signal }), reloj.vivo);
            // `envuelve` deja pasar cada evento tal cual y se queda una copia:
            // no cambia el orden, ni el contenido, ni el momento en que llega.
            return grabadora ? grabadora.envuelve(s) : s;
          },
          // Graceful termination: a tools-OFF stream the loop uses only to
          // compose a closing summary when a step-budget cap is hit, so the turn
          // ends with "here's what I did / what's pending" instead of a red error.
          closeOut: (msgs) => {
            const s = conSenales(streamWithRetry(() => brain.closeOut(msgs), { signal: upstreamAbort.signal }), reloj.vivo);
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
            const outcome = await runAgentTool(agentSession, deps, name, args);
            diario.anotar(name, outcome.response, args);
            return outcome;
          },
          // 🔴 EL MOMENTO `tsc`: lo medido vuelve AL MODELO, no sólo al usuario.
          //
          // Los ojos de abajo miden al CERRAR el turno, y para entonces el
          // modelo ya no puede hacer nada: la crítica sale por la tarjeta y el
          // usuario se queda con «tu página se sale» y sin nadie a quien
          // pedírselo hasta el turno siguiente. Esto mide en cuanto una tanda
          // toca el documento, y el hecho viaja en el mismo mensaje que las
          // respuestas de esa tanda — el modelo lo lee en su paso siguiente y
          // arregla con una op.
          //
          // CERO llamadas nuevas al modelo. El coste es un render, y va por el
          // MISMO navegador del turno (`medirDelTurno`), así que no paga
          // arranque: 2,16 s en caliente contra 4,80 s en frío, medido.
          //
          // Se apaga con el mismo interruptor que los ojos: son la misma
          // decisión de producto —mirar la página que se acaba de escribir— y
          // dos palancas para una decisión es como se queda una encendida sin
          // que nadie sepa por qué.
          medirParaElModelo:
            process.env.OPENLEN_AGENT_VISION === "0"
              ? undefined
              : async (gemelo: string) => {
                  // Las fotos del dueño, incrustadas: medir sin ellas da
                  // lecturas de contraste sobre fondos que en la página real no
                  // están vacíos. Es lo mismo que hacen los ojos aquí abajo.
                  const paraMedir = documentoMedible(await inlineOwnAssets(gemelo), vistaDelTurno);
                  return componerMedicion(await medirDelTurno(paraMedir), gemelo);
                },
          // ⚰️ Aquí iba `lineaBase`, el documento del arranque etiquetado con los
          // ids del motor. Len 2.0 (T9): la base la trae cada escritura
          // (`htmlPrevio`) y el bucle hace el gemelo con posiciones.
          // F5 — los ojos: tras un turno que mutó el documento, renderiza y
          // MIDE (JavaScript que grita, desborde a 390 px, contraste del píxel,
          // la suite de la página). Lo que encuentra SE LE DICE al usuario al
          // cerrar el turno; ya no abre ciclo de arreglo ni revierte nada
          // (`12f6a11e`) — corrige él, pidiéndoselo a Len por el chat. Desde
          // Len 2.1 SIN la llamada de visión (ver `sinVision` abajo). El render
          // corre por la casa. `OPENLEN_AGENT_VISION=0` apaga la comprobación
          // ENTERA, medida incluida: el nombre es de cuando los ojos eran eso.
          verifyTurn:
            process.env.OPENLEN_AGENT_VISION === "0"
              ? undefined
              : async ({ html, page, taggedHtml: gemelo, otrasPaginas }) => {
                  // EL JAVASCRIPT DEL MODELO, para que los ojos lo VEAN correr.
                  // `html` viene saneado —así se persiste—, así que sin esto la
                  // verificación mira una página sin scripts.
                  //
                  // SE RE-LEE AQUÍ, no se usa un código leído ANTES del turno (el
                  // `runtimeCode` que hubo aquí), así que en el turno donde el modelo
                  // ESCRIBE el JavaScript los ojos miraban una página con el
                  // código viejo — o sin ninguno. Es decir: escribía la ruleta
                  // y se verificaba una página sin ruleta, justo en el único
                  // turno donde eso importa.
                  //
                  // Releer cuesta una fila; la verificación ya paga segundos de
                  // Chrome y una llamada de visión. Y es lo correcto por otra
                  // razón: comprueba lo que se GUARDÓ, no lo que creemos que se
                  // guardó.
                  //
                  // Y SI LA RE-LECTURA FALLA, NO SE ADIVINA. Caer al código
                  // de antes del turno reintroduce exactamente el fallo que
                  // esta re-lectura vino a arreglar: aprobar el script NUEVO
                  // mirando el viejo. Cuando no se puede saber qué se guardó,
                  // el turno queda SIN verificar — que es la verdad — en vez de
                  // verificado contra otra página.
                  const fresco = await (async () => {
                                        const row = await deps
                      .loadProject(projectId, userId)
                      .catch(() => deps.loadProject(projectId, userId).catch(() => null));
                    if (!row) return { kind: "desconocido" as const };
                    // DEL DOCUMENTO QUE ESTE TURNO GUARDÓ. Se relee de la base
                    // en vez de fiarse de lo que creemos haber guardado — ése
                    // era el motivo original y sigue en pie.
                    const guardado =
                      (page ? row.data?.pages?.[page]?.html : row.data?.html) ?? "";
                    return {
                      kind: "codigo" as const,
                      code: scriptDelDocumento(guardado) || null,
                      // De la fila que se acaba de releer: si el turno cambió
                      // los ajustes (activar el chat, por ejemplo), los ojos
                      // miran la página CON su burbuja, que es la que se guardó.
                      vista: vistaParaMedir(projectId, row, page ?? null),
                    };
                  })();
                  if (fresco.kind === "desconocido") {
                    console.warn(
                      "[agent] no se pudo releer lo guardado — turno SIN verificar",
                    );
                    // El comentario ya decía «SIN verificar» y la línea de abajo
                    // devolvía el visto bueno. Ahora dice lo que hace.
                    return {
                      estado: "no_mirado",
                      motivo: "no se pudo releer el documento guardado",
                    };
                  }
                  // LAS FOTOS DEL DUEÑO, DENTRO DEL DOCUMENTO QUE SE MIRA.
                  //
                  // El render de verificación instala un guardia SSRF que corta
                  // loopback — y hace bien. Pero en desarrollo nuestro propio
                  // subidor devuelve URLs de `localhost`, así que las fotos que
                  // el dueño sube quedaban FUERA de la captura: un hueco que los
                  // ojos no pueden distinguir de una imagen rota. El 2026-08-27
                  // eso acabó con el Agente borrándole a Jesús su propia foto.
                  //
                  // Se traen los bytes del almacenamiento y viajan dentro del
                  // documento: no hay petición que cortar, no hay hueco, y los
                  // ojos juzgan la página que el dueño ve. Fail-soft — si algo
                  // no se puede leer, se mira como se miraba antes.
                  const paraLosOjos = await inlineOwnAssets(html);
                  // EL GEMELO PASA POR LO MISMO. Es el documento que se MIDE, y
                  // medirlo sin las fotos del dueño daría lecturas de contraste
                  // sobre fondos que en la página real no están vacíos. Nombre
                  // distinto para no confundirlo con el gemelo de la línea base,
                  // que es OTRO documento: el del principio del turno.
                  const gemeloParaLosOjos = gemelo ? await inlineOwnAssets(gemelo) : undefined;
                  // Las promesas de ESTA página que siguen teniendo sentido.
                  // Se saca a una constante porque hacen falta dos veces: para
                  // los ojos, y para que el contador sepa cuáles se comprobaron.
                  // MIGRADAS AL LEER: las que se guardaron en DSL pasan a JS. La
                  // que no se pueda convertir se conserva y no corre — y se dice.
                  const migrada = migrarSuite(project.data.pruebas ?? []);
                  if (migrada.sinMigrar.length > 0) {
                    // eslint-disable-next-line no-console
                    console.warn(`[agent] suite de la pagina: ${migrada.sinMigrar.length} promesa(s) en formato viejo sin convertir`);
                  }
                  const promesasDeLaPagina = vivas(migrada.suite, paraLosOjos, pageSlug);
                  // LAS OTRAS PÁGINAS QUE TOCÓ EL TURNO, por el mismo camino que
                  // la principal: con las fotos del dueño dentro, o sus huecos
                  // se leerían como imágenes rotas — que es exactamente lo que
                  // el 2026-08-27 acabó con el Agente borrando una foto buena.
                  //
                  // `page` viaja con cada una porque es lo que ROTULA su captura
                  // y prefija sus frases. Fail-soft igual: si una no se puede
                  // preparar, se cae ella sola y el recuento de la tarjeta ya
                  // dice cuántas se miraron.
                  const otrasParaLosOjos = await Promise.all(
                    (otrasPaginas ?? []).map(async (p) => ({
                      html: await inlineOwnAssets(p.html),
                      page: p.page,
                      ...(p.taggedHtml
                        ? { taggedHtml: await inlineOwnAssets(p.taggedHtml) }
                        : {}),
                    })),
                  );
                  const verdict = await verifyEditedPage({
                    html: paraLosOjos,
                    // QUÉ página es ésta — sólo para rotular. Sin esto, con dos
                    // páginas en juego las frases de la principal salen sin
                    // dirección y el usuario no sabe de cuál hablan.
                    page: pageSlug,
                    ...(otrasParaLosOjos.length > 0
                      ? { otrasPaginas: otrasParaLosOjos }
                      : {}),
                    ...(gemeloParaLosOjos ? { taggedHtml: gemeloParaLosOjos } : {}),
                    runtime: fresco.code,
                    // LAS PROMESAS QUE ESTA PÁGINA YA CUMPLIÓ. Van con la del
                    // turno en el mismo programa del navegador: sin esto, una
                    // edición que se lleva por delante el carrito construido
                    // hace seis turnos pasa limpia — la foto sale igual y la
                    // consola no grita. `vivas` deja fuera las que ya no
                    // señalan a nada en el documento que se acaba de guardar.
                    guardadas: promesasDeLaPagina,
                    vista: fresco.vista,
                    // DE LA SESIÓN, no del cuerpo de la petición: aquí se leía
                    // `prompt`, que es el objetivo CONGELADO en el instante en
                    // que empezó el turno. Una corrección a media faena lo
                    // cambia — ver el envoltorio de `leerDireccion`.
                    userPrompt: agentSession.userPrompt ?? prompt,
                    // 🔴 SIN LA LLAMADA DE VISIÓN (Len 2.1, 2026-09-30). La
                    // lectura de producción de ese día
                    // (`plans/len-2/corridas/2026-09-30-m5-lectura-produccion`):
                    // desde el 06/09 la visión no dio un solo «roto» que no
                    // diera ya la medida, y sus tres afirmaciones concretas
                    // —un dibujo mal atribuido, un teléfono mal leído, el
                    // contenido `.reveal` que la captura no baja a ver— fueron
                    // falsas y le llegaron al usuario en la tarjeta. Su único
                    // acierto comprobado (31/08) lo causaba una pieza de la
                    // plataforma ya retirada (`db2109f3`). La medida se queda
                    // entera: es gratis y es la que caza.
                    sinVision: true,
                  },
                  // EL NAVEGADOR DEL TURNO. Sin esto cada pasada abría el suyo:
                  // ~2,6 s de arranque por mirada, medido. Ver `medirDelTurno`.
                  {
                    medir: medirDelTurno,
                  });
                  // LA CUENTA, antes de decidir. La ruta sólo miraba
                  // `verdict.broken` y tiraba `verdict.fallback`, así que nada
                  // DENTRO del producto distinguía «miré y está bien» de «no
                  // pude mirar» — y los ojos fallan ABIERTOS por diseño. Con
                  // Chrome caído en el box la verificación aprobaría todo en
                  // silencio, y sólo el journal lo sabría. Crear ya contaba los
                  // suyos (`recordCriticRun`); el Agente no contaba nada.
                  recordAgentEyes({ fallback: verdict.fallback, broken: verdict.broken });
                  // LO QUE LA SUITE SE LLEVA DE ESTE TURNO. Aquí es donde se
                  // sabe: los ojos acaban de correr la promesa del turno y las
                  // guardadas, y traen los dos resultados por separado.
                  //
                  // 🔴 NACE EN VERDE: la promesa sólo se guarda si NO falló,
                  // o sea con `fallosDelTurno` vacío. La decisión la toma
                  // `actualizarSuite`; aquí sólo se recoge el hecho.
                  // ⚰️ La promesa del turno (`prueba_js`, en `agentSession.behaviorJs`)
                  // entraba aquí en la suite si nacía en verde. Len 2.0 no la
                  // tiene: la suite sólo recomprueba y retira las guardadas.
                  // Las que NO corrieron no se cuentan como comprobadas: si no,
                  // una rota que no se miró saldría «arreglada».
                  const sinCorrer = new Set(verdict.guardadasSinCorrer ?? []);
                  suiteDelTurno = {
                    retirar: [...(verdict.retirarPruebas ?? [])],
                    comprobadas: promesasDeLaPagina.filter((p) => !sinCorrer.has(p.id)).map((p) => p.id),
                    rotas: (verdict.regresiones ?? []).map((r) => r.id),
                  };
                  // LOS LÍMITES DE LA MEDIDA, AL REGISTRO Y A NINGÚN OTRO SITIO.
                  //
                  // No van a `notas` ni a `critique`: esas dos SE LE EMITEN al
                  // usuario verbatim y esto es castellano fijo del servidor con
                  // jerga de instrumento (medido el 2026-09-16: le llegaba
                  // «prompt devuelve null, confirm false» a quien pidió cambiar
                  // un titular). Al modelo le llegan a mitad de turno por
                  // `<limites-de-la-medida>`; al usuario, por el aviso del
                  // lienzo, traducido. Aquí se apuntan para que un hecho que el
                  // medidor devolvió no desaparezca sin dejar rastro.
                  if (verdict.limites.length > 0) {
                    // eslint-disable-next-line no-console
                    console.log(`[agent-verify] límites de la medida: ${verdict.limites.join(" · ")}`);
                  }
                  // 🔴 Y AHORA EL FALLBACK SALE POR SU PROPIA PUERTA. La cuenta
                  // de arriba ya distinguía «miré» de «no pude mirar», pero el
                  // valor que devolvía esta función no: los dos salían como
                  // `ok: true`, así que aguas abajo —la tarjeta, el bucle, el
                  // cierre del modelo— el visto bueno de una verificación real
                  // era indistinguible del de una que nunca corrió.
                  // LAS REGRESIONES VIAJAN CON CUALQUIER VEREDICTO, y por eso
                  // se cuelgan aquí en vez de dentro de una rama: un turno puede
                  // salir «bien» y haberse llevado por delante una promesa de
                  // hace seis turnos. Son dos cosas distintas.
                  // CUÁNTAS PÁGINAS SE MIRARON DE VERDAD, por el mismo
                  // envoltorio que las regresiones. Va aquí y no en cada rama
                  // porque es de la MEDIDA, no del desenlace — y sin él la
                  // tarjeta contaría las que se pidieron, que es distinto de
                  // las que llegaron a tener captura.
                  const conRegresiones = <T extends VerifyOutcome>(salida: T): T => {
                    const base = verdict.regresiones?.length
                      ? { ...salida, regresiones: verdict.regresiones }
                      : salida;
                    return typeof verdict.paginasMiradas === "number"
                      ? { ...base, paginasMiradas: verdict.paginasMiradas }
                      : base;
                  };
                  // LO ROTO VA ANTES QUE EL FALLBACK. `conHechos` deja
                  // `broken: true` también en un veredicto de fallback cuando
                  // el navegador vio algo (una excepción gritada antes de que
                  // la captura se cayera), y preguntar primero por `fallback`
                  // tiraba ese hecho al suelo como «no mirado».
                  if (verdict.broken) {
                    return conRegresiones({
                      estado: "roto",
                      // Una línea por problema, en el idioma del usuario: es lo
                      // que el bucle le emite al usuario al cerrar el turno.
                      //
                      // ⚰️ Aquí iba también `problemas: verdict.issues.length`,
                      // la cuenta para comparar con la segunda pasada. No hay
                      // segunda pasada desde el 2026-09-04.
                      critique: verdict.issues.map((i) => `- ${i}`).join("\n"),
                    });
                  }
                  if (verdict.fallback) {
                    return conRegresiones({ estado: "no_mirado", motivo: "la verificación visual no pudo correr" });
                  }
                  // 🔴 OBSERVADO — lo que se ve y no se puede llamar defecto
                  // desde la captura. Va DESPUÉS de `broken` a propósito: los
                  // hechos del navegador mandan y no los toca esta rama.
                  //
                  // Es la paridad con Crear, donde el crítico informa y no
                  // gasta desde que se midió que pedía regenerar por las FOTOS
                  // sin arreglar nada. Aquí, un marcador intencional leído como
                  // imagen rota abría un ciclo de reparación que no podía salir
                  // bien — el catálogo no tiene ese rubro, así que buscar más no
                  // podía cambiar la queja.
                  if (verdict.observaciones.length > 0) {
                    return conRegresiones({ estado: "observado", notas: verdict.observaciones });
                  }
                  // `conMedida` viaja para que la tarjeta pueda decir QUÉ
                  // comprobó sin afirmar un eje que nadie midió: si el render
                  // del medidor se cayó, el desborde y el contraste no se han
                  // mirado aunque el veredicto salga limpio.
                  return conRegresiones({ estado: "bien", conMedida: verdict.conMedida });
                },
          // Deja pasar el evento TAL CUAL y se queda una copia de lo que hace
          // falta para registrar el turno: no cambia el orden, ni el contenido,
          // ni el momento en que llega al cliente.
          emit: (ev) => {
            registro.observar(ev);
            if (ev.type === "text" || ev.type === "action") avance.tocar();
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
        corte = corteDelTurno({ ...result, mutoDurable });

        // LA SUITE DE LA PÁGINA, guardada. Dos cosas a la vez y en este orden:
        // se retiran las promesas que el navegador declaró sin sentido —su
        // selector ya no señala a nada— y entra la del turno SI nació en verde.
        // La decisión vive en `actualizarSuite`, no aquí.
        //
        // Fail-soft como el borrado del objetivo: el trabajo del turno ya está
        // hecho y cobrado, y perderlo por no poder guardar una comprobación
        // sería cambiar un problema pequeño por uno grande.
        // El `as` rompe el estrechamiento, y hace falta: lo asigna un callback
        // que TypeScript no sigue, así que aquí lo lee como `null` —y dentro
        // del `if`, como `never`— por mucho que se anote el tipo.
        const cambios = suiteDelTurno as SuiteDelTurno | null;
        if (cambios && (cambios.turno || cambios.retirar.length > 0)) {
          try {
            await deps.saveProjectData(projectId, userId, (actual) => {
              // CONTRA EL DOCUMENTO QUE DE VERDAD QUEDÓ. Se lee de `actual` —lo
              // que hay en la base ahora— y no del html del turno: entre medias
              // pudo entrar otra escritura, y limpiar la suite contra un
              // documento viejo mataría promesas que siguen en pie.
              //
              // Vacío ⇒ no se limpia. Una página que no se puede leer no puede
              // servir de excusa para vaciar nada.
              const documento = pageSlug
                ? actual.pages?.[pageSlug]?.html ?? ""
                : actual.html ?? "";
              // EL CONTADOR, antes de tocar nada más: marca las que se han
              // roto, desmarca las que han vuelto, y cuenta las tres cosas. De
              // este número sale la decisión que el plan dejó abierta — si una
              // regresión puede llegar a declarar rota la página.
              // Migrada también aquí: lo que se escribe de vuelta ya va en JS,
              // y así la migración queda guardada sin un paso aparte.
              const { suite: marcadas, cuenta } = marcarRegresiones(migrarSuite(actual.pruebas ?? []).suite, {
                comprobadas: cambios.comprobadas,
                rotas: cambios.rotas,
              });
              if (cuenta.nuevas || cuenta.siguenRotas || cuenta.arregladas) {
                // Dentro del actualizador: si la escritura se reintentara, esta
                // línea saldría dos veces. Es barato y se lee igual; sacarla
                // fuera costaría otro `as` para esquivar el estrechamiento.
                // eslint-disable-next-line no-console
                console.log(
                  `[agent] suite de la pagina: nuevas=${cuenta.nuevas} siguen=${cuenta.siguenRotas} arregladas=${cuenta.arregladas}`,
                );
              }
              const suite = actualizarSuite(marcadas, {
                ...cambios,
                ...(documento ? { documento, pagina: pageSlug } : {}),
              });
              return suite.length > 0
                ? { ...actual, pruebas: suite }
                : (({ pruebas: _sin, ...resto }) => resto)(actual);
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[agent] no se pudo guardar la suite de la pagina: %o", err);
          }
        }
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
        await cerrarFila();
        // Lo que cambió, antes del `done`: el cliente lo engancha a este turno.
        // Sin llamadas a herramientas no pudo cambiar nada y no se mira.
        if (result.toolCalls > 0) await emitirCambios();
        emit("done", {
          turns: result.turns,
          toolCalls: result.toolCalls,
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
        const code: AgentErrorCode = "upstream";
        corte = corteDelTurno({ terminalError: true, topeAlcanzado: null, errorCode: code, mutoDurable });
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
        if (clienteSeFue && !canceladoAProposito && registro.hayAlgo(mutoDurable)) {
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
});

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

export const OPTIONS = respuestaPrevia;
