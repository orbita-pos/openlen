import { auth } from "@/auth";
import type { InlineImage } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { resolveAIProvider } from "@/lib/ai-provider";
import { credencialDelTurno, faltaCredencial } from "@/lib/ai/turn-credentials";
import {
  getCreditState,
  noCreditsMessage,
  debitCredits,
  creditsForUsage,
} from "@/lib/credits";
import { resolveOpIdByPath, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildAgentMessages } from "@/lib/agent/context";
import { getUserMemory } from "@/lib/agent/user-memory";
import { listVersions } from "@/lib/projects/versions";
import { collectionCatalogBlock } from "@/lib/collections/catalog-block";
import { listPublishedItems } from "@/lib/collections/store";
import { modelJsEnabled } from "@/lib/ai-stream/model-runtime";
import { verifyCapsule } from "@/lib/projects/model-runtime";
import { runAgentLoop, type AgentErrorCode } from "@/lib/agent/loop";
import { streamWithRetry } from "@/lib/agent/retry";
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";
import { summarizeBusinessForAgent } from "@/lib/agent/business";
import { verifyEditedPage } from "@/lib/agent/verify";
import { jsonResponse, sseChannel } from "@/lib/ai/sse";

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
// Provider: Gemini Flash only — the agent's tool calls (leer_estado /
// editar_pagina / activar_modulo) do the heavy lifting; the model itself
// only needs to reason + dispatch, so there's no Pro tier here (unlike
// ai-design, which lets the user pick).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
const ENCODER = new TextEncoder();
// Same ceiling as ai-design — a real agent turn can chain several tool
// calls (leer_estado → editar_pagina → activar_modulo), so give it the
// same generous budget rather than a tighter one.
const STREAM_TIMEOUT_MS = 360_000;
const MAX_PROMPT_TOKENS = 240_000;

// F2 Task 8 — attached image + scope, validated with the SAME limits/posture
// as app/api/templates/ai-design/route.ts (read that file first if editing
// this block): outerHtml is only size-capped (unused otherwise, kept for
// parity/defense-in-depth), hint/path are trimmed+capped, and a bad
// attachment is silently dropped rather than 400ing the whole turn.
interface ScopeBody {
  outerHtml?: string;
  hint?: string;
  /** CSS-selector breadcrumb from the iframe's section-select script. When
   *  set and it resolves against the tagged document, the request becomes a
   *  hard-pin (the model must anchor on that op-id) instead of a soft hint. */
  path?: string;
}

interface AttachedImageBody {
  url?: string;
  alt?: string;
}

const SCOPE_OUTER_MAX = 50_000;
const ATTACHED_URL_MAX = 2_000;
const ATTACHED_ALT_MAX = 300;

export async function POST(req: Request): Promise<Response> {
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

  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthorized");

  const body = (await req.json().catch(() => null)) as {
    projectId?: string;
    prompt?: string;
    page?: string;
    history?: {
      role: "user" | "assistant";
      content: string;
      functionCalls?: unknown;
      functionResponses?: unknown;
    }[];
    /** Cuántos turnos tiene la conversación entera (el cliente sólo manda los
     *  últimos). Sólo sirve para avisarle al modelo de que no lo ve todo. */
    historyTotal?: number;
    scope?: ScopeBody;
    attachedImage?: AttachedImageBody;
  } | null;

  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!projectId) return errorJson(400, "projectId is required");
  if (prompt.length === 0 || prompt.length > 2000) return errorJson(400, "prompt must be 1–2000 chars");
  // F4 Task 1 — multi-page base: page slug, validated CLONED from
  // app/api/templates/ai-design/route.ts (read that file first if editing
  // this block). Absent/empty ⇒ home; a non-empty slug MUST already exist in
  // data.pages or the turn 404s rather than silently falling back to home.
  const pageSlugRaw = typeof body?.page === "string" ? body.page.trim() : "";
  // History hardening. El principio no cambia — NADA de lo que manda el
  // navegador se pasa tal cual, porque una entrada esparcida entera sería un
  // vector de inyección de tool-calls. Lo que cambia es que ahora el historial
  // SÍ lleva la forma de herramienta, reconstruida aquí desde el catálogo real:
  // del cliente sólo se acepta un NOMBRE, y sólo si es una herramienta que
  // existe. Los argumentos se descartan siempre (van vacíos) y el resultado se
  // reduce a un resumen de texto acotado.
  //
  // Por qué: MEDIDO el 2026-08-22 — sin las llamadas en el historial el Agente
  // editó 1 de 12 veces y en los 11 fallos dijo «Listo ✅» sobre una página
  // intacta; con ellas, 10 de 12.
  // Cuántos turnos tiene la conversación DE VERDAD, no cuántos caben. Del
  // mismo `turnsRef` del cliente del que salieron los que sí viajan.
  const turnosTotales =
    typeof body?.historyTotal === "number" && Number.isFinite(body.historyTotal)
      ? Math.min(Math.max(Math.trunc(body.historyTotal), 0), 500)
      : 0;
  const nombresValidos = new Set(buildFunctionDeclarations().map((d) => String(d.name)));
  const limpiaLlamadas = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter(
            (c): c is { name: string } =>
              !!c && typeof (c as { name?: unknown }).name === "string" &&
              nombresValidos.has((c as { name: string }).name),
          )
          .slice(0, 8)
          .map((c) => ({ name: c.name, args: {} }))
      : [];
  const limpiaRespuestas = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter(
            (r): r is { name: string; response?: { resumen?: unknown } } =>
              !!r && typeof (r as { name?: unknown }).name === "string" &&
              nombresValidos.has((r as { name: string }).name),
          )
          .slice(0, 8)
          .map((r) => ({
            name: r.name,
            response: { ok: true, resumen: String(r.response?.resumen ?? "").slice(0, 400) },
          }))
      : [];

  const history = Array.isArray(body?.history)
    ? (() => {
        const limpio = body.history
          .filter(
            (h) =>
              h &&
              (h.role === "user" || h.role === "assistant") &&
              typeof h.content === "string",
          )
          .map((h) => {
            const llamadas = limpiaLlamadas((h as { functionCalls?: unknown }).functionCalls);
            const respuestas = limpiaRespuestas(
              (h as { functionResponses?: unknown }).functionResponses,
            );
            return {
              role: h.role,
              content: h.content.slice(0, 4000),
              ...(llamadas.length ? { functionCalls: llamadas } : {}),
              ...(respuestas.length ? { functionResponses: respuestas } : {}),
            };
          })
          // Una entrada sin contenido Y sin respuestas no aporta nada; el
          // mensaje de respuestas SÍ va con `content` vacío, por diseño.
          .filter((h) => h.content.length > 0 || h.functionResponses);
        // 36 mensajes = 12 TURNOS, y un turno con herramientas ocupa TRES
        // (usuario, asistente+llamadas, respuestas).
        //
        // El recorrido de este número cuenta la historia: eran 6 mensajes (3
        // turnos), luego 12 (6 turnos), y con las llamadas de vuelta un turno
        // pasó a ocupar tres. Doce turnos es una conversación de verdad y sigue
        // cabiendo de sobra al lado del documento etiquetado, que es lo que de
        // verdad pesa en este prompt.
        //
        // No se sube a los 50 que la base guarda: el prompt se paga en CADA
        // turno para siempre, y el caso que motivaba una ventana enorme —«¿qué
        // hemos hecho?»— lo cubre ahora el registro de cambios, que sobrevive a
        // cualquier tope.
        const cortado = limpio.slice(-36);
        // El corte puede dejar huérfano un mensaje de respuestas cuya llamada
        // quedó fuera. El serializador degrada eso a texto suelto; mejor
        // quitarlo: media pareja confunde más de lo que recuerda.
        while (cortado.length > 0 && cortado[0]!.functionResponses) cortado.shift();
        return cortado;
      })()
    : [];

  // Validate the scope payload (optional) — same shape/limits as ai-design.
  // The hint is a textual fallback; the path (when it resolves after
  // tagging) unlocks a hard-pin to a specific data-op-id.
  let scopeHint: string | null = null;
  let scopePath: string | null = null;
  if (body?.scope && typeof body.scope === "object") {
    const raw = body.scope.outerHtml;
    if (typeof raw === "string" && raw.length > SCOPE_OUTER_MAX) {
      return errorJson(400, "scope.outerHtml too large");
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

  const userId = session.user.id;
  const deps = realDeps();
  const project = await deps.loadProject(projectId, userId);
  if (!project) return errorJson(404, "project not found");

  // Same validation ai-design applies to body.page: a non-empty slug that
  // doesn't resolve against this project's data.pages is a 404, never a
  // silent fallback to home.
  const pageSlug =
    pageSlugRaw && project.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");

  // PROVIDER se queda sólo para los OJOS (más abajo, tras OPENLEN_AGENT_VISION),
  // que son auxiliares y degradan solos: `verifyEditedPage` nunca lanza y su
  // proveedor por defecto ya es Fireworks. La puerta valida la credencial del
  // papel que de verdad razona este turno — ver lib/ai/turn-credentials.ts.
  const PROVIDER = resolveAIProvider("gemini-flash");
  const faltaKey = faltaCredencial(credencialDelTurno("OPENLEN_AGENT_PROVIDER"));
  if (faltaKey) return errorJson(500, faltaKey);

  // The ACTIVE document — home's data.html or the validated subpage's html.
  // Same no-taggable-elements 400 as before, now checked against whichever
  // document is actually active this turn.
  const activeHtml = pageSlug ? project.data.pages?.[pageSlug]?.html ?? "" : project.data.html ?? "";
  // Se DESETIQUETA antes de etiquetar. `tag_with_op_ids` salta —sin contarlo—
  // el elemento que ya lleva `data-op-id` (`tagger.rs`), así que un documento
  // ya etiquetado devuelve `taggedCount = 0` y esta ruta lo rechazaba con un
  // 400 del que no se salía NUNCA: el proyecto quedaba inservible.
  //
  // El escape estaba tapado en `persistHtmlChange`, pero eso sólo protege lo
  // que se guarde de aquí en adelante. Los proyectos que YA tienen ids dentro
  // necesitan que la puerta sepa curarlos, y hacerla idempotente es más barato
  // que una migración. Un documento limpio pasa por aquí byte-idéntico.
  const { taggedHtml, taggedCount } = tagWithOpIds(stripOpIds(activeHtml));
  if (taggedCount === 0) return errorJson(400, "project html has no taggable elements");

  // El JavaScript que la página ya tiene. `activeHtml` viene saneado, así que
  // sin esto el Agente no ve la conducta que el usuario le pide arreglar: la
  // re-inventa, o escala a un rediseño entero por una línea. Sólo el documento
  // raíz — la cápsula ata `data.html`.
  const runtimeCode = (() => {
    if (!modelJsEnabled(process.env) || pageSlug) return null;
    const check = verifyCapsule(project.generatedRuntime, {
      projectId,
      html: project.data?.html ?? "",
    });
    return check.ok ? check.code : null;
  })();

  // Hard-pin: only when the client sent BOTH a path and a hint (mirrors
  // ai-design) AND the path resolves against the freshly tagged document.
  // Any failure degrades silently to the soft hint.
  let scopePin: { opId: string; hint: string } | null = null;
  if (scopePath && scopeHint) {
    const opId = resolveOpIdByPath(taggedHtml, scopePath);
    if (opId) scopePin = { opId, hint: scopeHint };
  }

  // F5 — los píxeles de la imagen adjunta. Hasta ahora el modelo recibía la
  // URL como TEXTO y colocaba la imagen a ciegas; aquí se fetchea y viaja como
  // inlineData en el primer turno, así el modelo la VE (colores, orientación,
  // contenido). SSRF: validateUrl bloquea loopback/RFC-1918/link-local ANTES
  // del fetch, y redirect:"error" impide que un host público rebote la
  // petición a uno interno después de validar. Best-effort: si falla, el turno
  // sigue texto-solo exactamente como antes.
  let attachedInline: InlineImage | null = null;
  if (attachedImage) {
    const valid = await validateUrl(attachedImage.url);
    if (valid.ok) {
      // El `signal` no es decorativo: esto corre ANTES de abrir el SSE, así
      // que sin plazo propio ni señal del request una URL que no responde deja
      // el turno colgado y al usuario mirando la nada. El tope de 4 MB vive
      // dentro y ahora corta el stream en vez de medir al final.
      attachedInline = await fetchImageAsInlineData(attachedImage.url, {
        redirect: "error",
        signal: req.signal,
      });
    }
  }

  const state = summarizeProjectState({
    data: project.data,
    title: project.title,
    subdomain: project.subdomain,
    publishedAt: project.publishedAt,
  });
  // P2 — el agente sabe quién es el dueño: el perfil efectivo del proyecto
  // (vinculado, si no el default del usuario) entra al ESTADO como `negocio`.
  // Sin perfil lleno, el ESTADO queda idéntico al de antes.
  const perfilNegocio = await deps.loadBusinessProfile(projectId, userId);
  const negocio = summarizeBusinessForAgent(perfilNegocio);
  if (negocio) state.negocio = negocio;
  // El catálogo del usuario. La banda de la colección llega VACÍA en el
  // documento —los ítems se hornean al publicar—, así que sin esto el Agente
  // fabricaba tarjetas inventadas que salían duplicadas junto a las reales.
  // Sólo se paga la consulta si la página trae la banda.
  const catalogo = /data-ol-collection-section/i.test(activeHtml)
    ? collectionCatalogBlock(
        await listPublishedItems(projectId).catch(() => []),
        activeHtml,
      )
    : "";
  const built = buildAgentMessages({
    state,
    taggedHtml,
    catalogo,
    runtime: runtimeCode,
    userBrief: project.userBrief,
    // Lo que el Agente sabe de ESTA PERSONA. Se lee por turno, no se cachea:
    // el usuario puede haber guardado algo en OTRA pestaña, en otro proyecto,
    // hace un minuto — que es justo el caso que esto existe para servir.
    userMemory: await getUserMemory(session.user.id).catch(() => null),
    // LO QUE YA SE HIZO. `projectVersions` guarda cada edición con su etiqueta
    // ya escrita en español y nadie se la enseñaba al modelo. Sobrevive a la
    // ventana de la conversación, a recargar y a volver un mes después — que es
    // por qué esto vale más que ampliar la ventana.
    cambios: await listVersions({ projectId, userId: session.user.id })
      .then((vs) =>
        vs
          // El «Before AI edit» es el respaldo que se guarda ANTES de cada
          // cambio; contarlo como cambio duplicaría el registro entero.
          .filter((v) => v.label && !/^Before AI edit/i.test(v.label))
          .map((v) => ({ label: v.label, page: v.page, createdAt: v.createdAt })),
      )
      .catch(() => []),
    // Lo que la ingestión ya sabe que se perdió en esta página. El Chat lo
    // recibe desde hace tiempo (`KNOWN ISSUES ON THIS PAGE`); el Agente no lo
    // veía por ningún lado, así que empezaba a ciegas una conversación sobre
    // un fallo que el sistema tenía diagnosticado por escrito.
    degradaciones: project.data?.degradations ?? [],
    // Qué parte de la conversación NO ve — para que pueda decir «no me
    // acuerdo» en vez de nombrar el turno más viejo que tenga a mano.
    conversacionRecortada:
      turnosTotales > 0
        ? {
            // Los mensajes de respuestas de herramienta TAMBIÉN son role
            // "user" (con contenido vacío): contarlos infla la cuenta y le
            // diría al modelo que ve más turnos de los que ve.
            visibles: history.filter((h) => h.role === "user" && h.content.length > 0).length,
            totales: turnosTotales,
          }
        : null,
    prompt,
    history,
    // ¿El turno anterior fue MUDO? Se deriva del historial que acaba de
    // sanearse: el último mensaje del asistente sin `functionCalls` significa
    // que no tocó nada. Es un hecho estructural, no una lectura de su prosa.
    // Un historial vacío (primer turno) no dispara nada.
    turnoAnteriorMudo: (() => {
      const ultimo = [...history].reverse().find((h) => h.role === "assistant");
      return ultimo ? !("functionCalls" in ultimo) : false;
    })(),
    attachedImage: attachedImage
      ? { ...attachedImage, ...(attachedInline ? { visible: true } : {}) }
      : null,
    scopePin,
    scopeHint,
    activePage: pageSlug,
    maxPromptTokens: MAX_PROMPT_TOKENS,
  });
  if (!built.ok) return errorJson(413, "Page too large for an agent turn");
  const messages = built.messages;
  // El mensaje del prompt del usuario — la referencia exacta contra la que
  // openStream decide adjuntar los píxeles (el gateway ancla images al ÚLTIMO
  // mensaje user, y solo el primer turno termina en el prompt; los turnos
  // posteriores terminan en functionResponses y el closeOut en su instrucción).
  const promptMessage = messages[messages.length - 1];

  const upstreamAbort = new AbortController();
  const agentSession: AgentSession = {
    projectId,
    userId,
    taggedHtml,
    page: pageSlug,
    // Alimentan la etapa de imágenes y el sembrado de marca de `preparePage`,
    // que sin ellos se saltaban en TODA edición del Agente.
    brief: project.brief ?? null,
    profile: perfilNegocio,
    ownerEmail: session.user.email ?? null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
  };
  const tools = buildFunctionDeclarations();
  // Quién razona vive en `lib/agent/brain` — el MISMO sitio del que tiran los
  // evals. Tenerlo aquí dentro ya dejó a la batería midiendo Gemini después de
  // que el Agente pasara a DeepSeek, sin que nada fallara.
  const brain = createAgentBrain({
    tools,
    requestId: projectId,
    signal: upstreamAbort.signal,
    ...(attachedInline ? { attachedImage: { image: attachedInline, anchorMessage: promptMessage } } : {}),
  });

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = sseChannel(controller);
      const emit = channel.emit;
      const close = () => channel.close();
      const timeout = setTimeout(() => upstreamAbort.abort(), STREAM_TIMEOUT_MS);
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
        const result = await runAgentLoop({
          messages,
          tools,
          // streamWithRetry rides out transient Gemini 503 spikes: it re-opens
          // the stream on a retryable error thrown BEFORE any event (safe — the
          // model produced nothing yet), and honors upstreamAbort so retries can
          // never outlive the STREAM_TIMEOUT_MS ceiling. A mid-stream failure
          // still propagates (no double-applied tool calls).
          openStream: (msgs) =>
            streamWithRetry(() => brain.openStream(msgs), { signal: upstreamAbort.signal }),
          // Graceful termination: a tools-OFF stream the loop uses only to
          // compose a closing summary when a step-budget cap is hit, so the turn
          // ends with "here's what I did / what's pending" instead of a red error.
          closeOut: (msgs) =>
            streamWithRetry(() => brain.closeOut(msgs), { signal: upstreamAbort.signal }),
          runTool: (name, args) => runAgentTool(agentSession, deps, name, args),
          // F5 — los ojos: tras un turno que mutó el documento, renderiza y
          // verifica rotura visual objetiva; si la hay, el loop inyecta la
          // crítica y el modelo recibe UN ciclo de arreglo. El costo del
          // render+visión corre por la casa (no entra en result.usage — el
          // usuario no paga la QA). Kill-switch: OPENLEN_AGENT_VISION=0.
          verifyTurn:
            process.env.OPENLEN_AGENT_VISION === "0"
              ? undefined
              : async ({ html, page }) => {
                  // EL JAVASCRIPT DEL MODELO, para que los ojos lo VEAN correr.
                  // `html` viene saneado —así se persiste—, así que sin esto la
                  // verificación mira una página sin scripts.
                  //
                  // SE RE-LEE AQUÍ, no se usa `runtimeCode`. Ése se calcula una
                  // vez ANTES del turno, así que en el turno donde el modelo
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
                  // Y SI LA RE-LECTURA FALLA, NO SE ADIVINA. Caer a
                  // `runtimeCode` aquí reintroduce exactamente el fallo que
                  // esta re-lectura vino a arreglar: aprobar el script NUEVO
                  // mirando el viejo. Cuando no se puede saber qué se guardó,
                  // el turno queda SIN verificar — que es la verdad — en vez de
                  // verificado contra otra página.
                  const fresco = await (async () => {
                    if (!modelJsEnabled(process.env) || page) {
                      return { kind: "codigo" as const, code: runtimeCode };
                    }
                    const row = await deps
                      .loadProject(projectId, userId)
                      .catch(() => deps.loadProject(projectId, userId).catch(() => null));
                    if (!row) return { kind: "desconocido" as const };
                    const check = verifyCapsule(row.generatedRuntime, {
                      projectId,
                      html: row.data?.html ?? "",
                    });
                    return { kind: "codigo" as const, code: check.ok ? check.code : null };
                  })();
                  if (fresco.kind === "desconocido") {
                    console.warn(
                      "[agent] no se pudo releer lo guardado — turno SIN verificar",
                    );
                    return { ok: true };
                  }
                  const verdict = await verifyEditedPage({
                    html,
                    runtime: fresco.code,
                    // LO QUE EL MODELO PROMETIÓ que su código haría. La declara
                    // en el mismo edit que escribe el JavaScript y vive en la
                    // sesión; sin ella, los ojos pulsan a ciegas y sólo ven lo
                    // que EXPLOTA — nunca lo que simplemente no cumple.
                    spec: agentSession.behaviorSpec ?? null,
                    userPrompt: prompt,
                    // 2.5-flash, NO el modelo del loop: el veredicto es una
                    // tarea auxiliar chica con schema, y 3.5-flash gasta
                    // thinking + sufre picos de latencia que aquí vencen el
                    // deadline UX-visible (medido en vivo: 3.5 timeout, 2.5
                    // responde). Mismo patrón que style-match/vision y
                    // pick-template, que ya fijan 2.5-flash.
                    model:
                      process.env.OPENLEN_AGENT_VISION_MODEL?.trim() ||
                      "gemini-2.5-flash",
                    apiKey: PROVIDER.key as string,
                  });
                  if (verdict.broken) {
                    return {
                      ok: false,
                      critique: verdict.issues.map((i) => `- ${i}`).join("\n"),
                    };
                  }
                  return { ok: true };
                },
          emit: (ev) => emit(ev.type, ev),
        });
        // F2-T9 billing ruling (Jesús 2026-07-07): a turn that ended on a
        // terminal error (stopReason error/cancelled/max_tokens, or the
        // maxTurns/maxToolCalls caps) debits 0 credits — the user got no
        // usable output. A clean end_turn finish charges normally, even
        // when a tool inside it returned {ok:false} as data or the turn
        // ended waiting on a confirm card.
        if (!result.terminalError) {
          const { inputTokens, outputTokens, cachedTokens } = result.usage;
          const credits = creditsForUsage(inputTokens, outputTokens, brain.creditRate());
          // F3: Gemini's implicit-cache discount (90% off cached input
          // tokens) is automatic on Google's own invoice — creditsForUsage
          // still prices off raw input/output, so OpenLen's product credits
          // are UNCHANGED by cachedTokens; this is visibility only.
          const cachedPct = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0;
          console.log(
            `[agent] ${brain.modelId} — in ${inputTokens} (cached ${cachedTokens}, ${cachedPct}%) / out ${outputTokens}`,
          );
          await debitCredits(userId, Math.max(1, credits));
        } else {
          console.log("[agent] terminal-error turn — 0 credits");
        }
        emit("done", { turns: result.turns, toolCalls: result.toolCalls });
        close();
      } catch (err) {
        console.error("[agent] stream failed", err);
        const code: AgentErrorCode = "upstream";
        emit("error", { message: err instanceof Error ? err.message : "Unknown error", code });
        close();
      } finally {
        clearTimeout(timeout);
      }
    },
    cancel() {
      upstreamAbort.abort();
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
function errorJson(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}
