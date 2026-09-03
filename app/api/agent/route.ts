import { auth } from "@/auth";
import type { InlineImage } from "@/lib/ai-gateway";
import { createAgentBrain } from "@/lib/agent/brain";
import { credencialDelTurno, faltaCredencial } from "@/lib/ai/turn-credentials";
import {
  getCreditState,
  noCreditsMessage,
  debitCredits,
  creditsForUsage,
} from "@/lib/credits";
import {
  buildOutline,
  buildScopedView,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
} from "@/lib/html-ops";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { scriptDelDocumento } from "@/lib/page-engine/conservar-scripts";
import { persistPage } from "@/lib/page-engine/persist";
import { inlineOwnAssets } from "@/lib/projects/inline-own-assets";
import { buildAgentMessages } from "@/lib/agent/context";
import { formaDelTurno, lineaDeForma } from "@/lib/agent/forma-del-turno";
import {
  creaGrabadora,
  directorioDeGrabacion,
  nombreDeFichero,
} from "@/lib/agent/grabacion";
import { getUserMemoryBounded } from "@/lib/agent/user-memory";
import { listVersions } from "@/lib/projects/versions";
import { runAgentLoop, type AgentErrorCode } from "@/lib/agent/loop";
import { randomUUID } from "node:crypto";

import { abrirTurno, cerrarTurno, leerDireccion } from "@/lib/agent/direcciones";
import { streamWithRetry } from "@/lib/agent/retry";
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";
import { observarPagina, verifyEditedPage } from "@/lib/agent/verify";
import { recordAgentEyes } from "@/lib/ai/quality-metrics";
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
  // La página se resuelve ANTES de construir cualquier catálogo. Así un
  // slug inválido no se convierte en Home ni siquiera durante el saneamiento
  // del historial, y las declaraciones se construyen una sola vez con la
  // misma capacidad que recibirán prompt y sesión.
  const userId = session.user.id;
  // `observarPagina` se enchufa AQUÍ y no dentro de `realDeps()` a propósito:
  // vive en verify.ts, que arrastra el render de Chromium, y `lib/agent/tools`
  // lo importan muchas pruebas que no quieren ese grafo detrás.
  const deps = { ...realDeps(), observarPagina };
  const project = await deps.loadProject(projectId, userId);
  if (!project) return errorJson(404, "project not found");
  const pageSlug =
    pageSlugRaw && project.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");
  const tools = buildFunctionDeclarations(process.env);
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
  const nombresValidos = new Set(tools.map((d) => String(d.name)));
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
            (r): r is { name: string; response?: { ok?: unknown; resumen?: unknown } } =>
              !!r && typeof (r as { name?: unknown }).name === "string" &&
              nombresValidos.has((r as { name: string }).name),
          )
          .slice(0, 8)
          .map((r) => ({
            name: r.name,
            // 🔴 EL `ok` VIENE DEL CLIENTE, no de aquí. Esto escribía `true` a
            // mano sobre TODA respuesta del historial, así que un turno pasado
            // que falló se le reenviaba al modelo como si hubiera salido bien —
            // y el modelo vuelve a intentar lo que ya no funcionó, o cierra
            // afirmando un arreglo que no ocurrió.
            //
            // Es dato del cliente, así que se COERCE, no se cree: sólo el
            // booleano `false` exacto marca fallo. Un `ok` inventado no puede
            // hacer más daño que el `true` que se escribía siempre, y decir la
            // verdad cuando la hay vale más que negarla siempre.
            response: {
              ok: (r.response as { ok?: unknown } | undefined)?.ok !== false,
              resumen: String(r.response?.resumen ?? "").slice(0, 400),
            },
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

  /**
   * CUÁNTOS TURNOS DE LA CHARLA VIAJAN DE VERDAD.
   *
   * Se calcula UNA vez porque lo leen DOS sitios que tienen que decir lo mismo:
   * la nota que va al modelo (`conversacionRecortada`) y el aviso que va al
   * usuario (en el evento `done`). Estaba escrito sólo en el primero, y cuando
   * el segundo llegó, copiarlo habría sido plantar la segunda mitad de una
   * verdad duplicada — la forma exacta del defecto que este barrido persigue.
   *
   * Los mensajes de respuestas de herramienta TAMBIÉN son role "user" (con
   * contenido vacío): contarlos infla la cuenta y diría que se ven más turnos
   * de los que se ven.
   */
  const ventanaVisible = history.filter(
    (h) => h.role === "user" && h.content.length > 0,
  ).length;

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

  // La puerta valida la credencial del papel que de verdad razona este turno —
  // ver lib/ai/turn-credentials.ts. Aqui vivia tambien un `PROVIDER` de Gemini
  // que solo alimentaba a los ojos; los ojos van por Fireworks y se lo resuelven
  // solos desde la politica de modelos.
  const faltaKey = faltaCredencial(credencialDelTurno());
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
  if (taggedCount === 0) return errorJson(400, "project html has no taggable elements", "noTaggableElements");

  // EL JAVASCRIPT QUE LA PÁGINA YA TIENE viaja DENTRO del documento que el
  // modelo recibe, así que no hay que ir a buscarlo a ninguna parte. Este
  // bloque leía la cápsula de la columna y se la enseñaba aparte; era la
  // única forma de que Len viera un código que le habíamos sacado del HTML.
  const runtimeCode = scriptDelDocumento(activeHtml) || null;

  // Hard-pin: only when the client sent BOTH a path and a hint (mirrors
  // ai-design) AND the path resolves against the freshly tagged document.
  // Any failure degrades silently to the soft hint.
  let scopePin: { opId: string; hint: string } | null = null;
  if (scopePath && scopeHint) {
    const opId = resolveOpIdByPath(taggedHtml, scopePath);
    if (opId) scopePin = { opId, hint: scopeHint };
  }

  // LA VISTA RECORTADA — hallazgo 14.
  //
  // `buildScopedView` llevaba meses construido, probado y en soak, y su ÚNICO
  // llamador de producción era `ai-design` — el Chat, que es la ruta OPT-OUT.
  // Len, que es la superficie por defecto, calculaba el `scopePin` y lo gastaba
  // sólo como PISTA DE TEXTO: después mandaba el documento ENTERO igual, en
  // cada vuelta. Con el mismo techo de 240k que el Chat sortea recortando, Len
  // se estrellaba con un 413 y sin degradación.
  //
  // Cita de su propio comentario en ai-design: «a 200KB doc would blow the
  // context, but the same request scoped to one section ships in <5KB».
  //
  // 🔴 SÓLO VIAJA AL CONTEXTO DEL MODELO. La sesión del turno (más abajo)
  // sigue llevando el `taggedHtml` COMPLETO, que es contra lo que se aplican
  // las ops — incluidas las dirigidas a op-ids que sólo salen en el índice.
  // Confundir esas dos cosas sería recortar el documento de verdad.
  //
  // `null` cuando no hay pin o cuando el contenedor no se puede construir:
  // entonces va el documento entero, exactamente como hasta hoy.
  const scopedView = scopePin ? buildScopedView(taggedHtml, scopePin.opId) : null;

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

  const state = summarizeProjectState(
    {
      data: project.data,
      title: project.title,
      subdomain: project.subdomain,
      publishedAt: project.publishedAt,
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
  // Ya no hace falta: con un almacén de `lectura`, `leer_estado` le da las filas
  // directamente, y las de `propio`/`añadir` también. El problema que esto
  // resolvía —el modelo sin ver lo que la página guarda— lo resuelve ahora la
  // herramienta, no un bloque cosido al prompt.
  const catalogo = "";
  const argsDelTurno = {
    state,
    taggedHtml,
    scopedView,
    catalogo,
    runtime: runtimeCode,
    userBrief: project.userBrief,
    // Lo que el Agente sabe de ESTA PERSONA. Se lee por turno, no se cachea:
    // el usuario puede haber guardado algo en OTRA pestaña, en otro proyecto,
    // hace un minuto — que es justo el caso que esto existe para servir.
    userMemory: await getUserMemoryBounded(session.user.id),
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
      turnosTotales > 0 ? { visibles: ventanaVisible, totales: turnosTotales } : null,
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
  };
  let built = buildAgentMessages(argsDelTurno);

  // EL PLANO B: EL ÍNDICE. Antes de rendirse con un 413.
  //
  // El recorte por pin de más arriba sólo entra cuando el usuario SEÑALÓ algo.
  // Quien escribe «pon los botones en azul» sobre una página enorme no ha
  // señalado nada, y hasta hoy se llevaba un 413: Len sencillamente no existía
  // en esa página, sin explicación y sin alternativa. Es el único sitio del
  // Agente donde el tamaño no degradaba, sólo cerraba la puerta.
  //
  // 🔴 SÓLO SE ENTRA AQUÍ CUANDO EL CAMINO NORMAL YA FALLÓ. Un turno que hoy
  // funciona sale byte a byte idéntico: se mide primero con el documento
  // completo y esto ni se calcula. Lo que se degrada es un error, no un éxito.
  //
  // Medido el 2026-09-01 sobre las 239 páginas del repo: la mayor son 46k
  // tokens, el 19% del techo, y NINGUNA lo pasa. Esto no es para las páginas
  // que existen — es para la que alguien haga mañana metiéndolo todo en una.
  let enPlanoB = false;
  if (!built.ok && !scopePin) {
    const indice = buildOutline(taggedHtml);
    if (indice) {
      built = buildAgentMessages({ ...argsDelTurno, soloIndice: indice });
      // Sólo cuenta como plano B si el índice DE VERDAD hizo que cupiera. Si aun
      // así no cabe, esto es un 413 y no hay turno que proteger.
      enPlanoB = built.ok;
    }
  }
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
          taggedHtml,
          vista: enPlanoB ? "indice" : scopedView ? "recortada" : "completa",
          history,
          turnosTotales,
          prompt,
          userBrief: project.userBrief,
          userMemory: argsDelTurno.userMemory,
          cambios: argsDelTurno.cambios,
          degradaciones: argsDelTurno.degradaciones,
          turnoAnteriorMudo: argsDelTurno.turnoAnteriorMudo,
          conPin: scopePin !== null,
          conImagen: attachedImage !== null,
          activePage: pageSlug,
        }),
      ),
    );
  } catch (err) {
    console.warn("[agent] no se pudo medir la forma del turno", err);
  }

  const messages = built.messages;
  // El mensaje del prompt del usuario — la referencia exacta contra la que
  // openStream decide adjuntar los píxeles (el gateway ancla images al ÚLTIMO
  // mensaje user, y solo el primer turno termina en el prompt; los turnos
  // posteriores terminan en functionResponses y el closeOut en su instrucción).
  const promptMessage = messages[messages.length - 1];

  // LA DIRECCION A LA QUE SE LE PUEDE CORREGIR EL RUMBO. El SSE es de una sola
  // via, asi que la correccion del usuario entra por otra peticion
  // (POST /api/agent/dirigir) y necesita saber a que turno va.
  const turnoId = randomUUID();
  const upstreamAbort = new AbortController();
  const agentSession: AgentSession = {
    projectId,
    userId,
    taggedHtml,
    // LA BASE EN DISCO contra la que se detecta que otro escritor tocó esta
    // página mientras el turno pensaba. Sin etiquetar, y con `stripOpIds` por
    // el mismo motivo que la línea de arriba: un proyecto anterior al
    // 2026-08-23 puede traer ids horneados, y compararlos crudos daría un falso
    // positivo en su primer guardado.
    baseHtml: stripOpIds(activeHtml),
    // Lo que el usuario acaba de escribir. Sin esto ninguna herramienta puede
    // contrastar lo que el modelo hace con lo que se le pidió — ver `userPrompt`.
    userPrompt: prompt,
    page: pageSlug,
    // Alimenta la etapa de imágenes de `preparePage`, que sin él se saltaba en
    // TODA edición del Agente. El sembrado de marca que viajaba a su lado se
    // fue con el perfil el 2026-08-31.
    brief: project.brief ?? null,
    ownerEmail: session.user.email ?? null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
    // EL TURNO ARRANCÓ SIN VER EL HTML, sólo el índice. Mientras esto esté
    // puesto, `editar_pagina` no deja borrar ni reemplazar una sección que el
    // modelo no haya abierto — ver `rejectBlindOps`. Es un booleano: el índice
    // NO entra en la sesión, que sigue llevando el documento completo.
    entroACiegas: enPlanoB,
    // Lo que el usuario escribió ESTE turno. Lo usa `publicar` para no
    // reclamar un subdominio que el dueño nunca dijo — ver su comentario.
    mensajeDelUsuario: prompt,
  };
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
      // LO QUE YA ES IRREVERSIBLE. Vive FUERA del try a propósito: si el bucle
      // revienta, `result` no existe y ésta es la única memoria de que el turno
      // ya escribió en la base. Misma idea que `cambioDurable` en el Chat
      // clásico (ai-design), que es la superficie hermana.
      let mutoDurable = false;
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
      abrirTurno(turnoId, userId);
      emit("turno", { turnoId });

      const dirGrabacion = directorioDeGrabacion();
      const grabadora = dirGrabacion ? creaGrabadora(messages) : null;

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
          // model produced nothing yet), and honors upstreamAbort so retries can
          // never outlive the STREAM_TIMEOUT_MS ceiling. A mid-stream failure
          // still propagates (no double-applied tool calls).
          openStream: (msgs) => {
            const s = streamWithRetry(() => brain.openStream(msgs), { signal: upstreamAbort.signal });
            // `envuelve` deja pasar cada evento tal cual y se queda una copia:
            // no cambia el orden, ni el contenido, ni el momento en que llega.
            return grabadora ? grabadora.envuelve(s) : s;
          },
          // Graceful termination: a tools-OFF stream the loop uses only to
          // compose a closing summary when a step-budget cap is hit, so the turn
          // ends with "here's what I did / what's pending" instead of a red error.
          closeOut: (msgs) => {
            const s = streamWithRetry(() => brain.closeOut(msgs), { signal: upstreamAbort.signal });
            return grabadora ? grabadora.envuelveCierre(s) : s;
          },
          runTool: (name, args) => runAgentTool(agentSession, deps, name, args),
          // KEEP-BEST — deshacer un ciclo de arreglo que no arregló.
          //
          // Va por `persistPage`, el MISMO embudo que usa `editar_pagina`, no
          // por un UPDATE a mano: así el revert deja su fila en Versiones y el
          // usuario puede ver —y rehacer— lo que se deshizo.
          //
          // NO se vuelve a pasar por `preparePage` a propósito: este documento
          // ya pasó por él cuando se guardó hace dos vueltas, y re-prepararlo
          // podría devolver algo distinto de lo que fotografiamos, que es justo
          // lo que un revert no puede hacer.
          restaurarHtml: async ({ html, page }) => {
            await persistPage(
              {
                projectId,
                userId,
                page,
                html,
                label: "Deshecho: la revisión automática no mejoró la página",
              },
              deps,
            );
          },
          // F5 — los ojos: tras un turno que mutó el documento, renderiza y
          // verifica rotura visual objetiva; si la hay, el loop inyecta la
          // crítica y el modelo recibe UN ciclo de arreglo. El costo del
          // render+visión corre por la casa (no entra en result.usage — el
          // usuario no paga la QA). Kill-switch: OPENLEN_AGENT_VISION=0.
          verifyTurn:
            process.env.OPENLEN_AGENT_VISION === "0"
              ? undefined
              : async ({ html, page, soloDeterminista }) => {
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
                  const verdict = await verifyEditedPage({
                    html: paraLosOjos,
                    runtime: fresco.code,
                    // LO QUE EL MODELO PROMETIÓ que su código haría. La declara
                    // en el mismo edit que escribe el JavaScript y vive en la
                    // sesión; sin ella, los ojos pulsan a ciegas y sólo ven lo
                    // que EXPLOTA — nunca lo que simplemente no cumple.
                    spec: agentSession.behaviorSpec ?? null,
                    // DE LA SESIÓN, no del cuerpo de la petición: aquí se leía
                    // `prompt`, que es el objetivo CONGELADO en el instante en
                    // que empezó el turno. Una corrección a media faena lo
                    // cambia — ver el envoltorio de `leerDireccion`.
                    userPrompt: agentSession.userPrompt ?? prompt,
                    // LA SEGUNDA PASADA NO LLAMA AL MODELO CON VISIÓN. Es la
                    // que comprueba si el arreglo arregló, y se queda con lo
                    // MEDIBLE —errores de JavaScript, la prueba declarada,
                    // desbordamiento en móvil, contraste—, que además es
                    // exactamente lo que el ojo del crítico no sabe juzgar.
                    // Cuesta un arranque de Chrome, cero créditos de IA.
                    ...(soloDeterminista ? { soloDeterminista: true } : {}),
                    // Aqui se fijaba a mano "gemini-2.5-flash" —con su propio
                    // interruptor, OPENLEN_AGENT_VISION_MODEL— para esquivar la
                    // latencia de 3.5. Hoy quien mira lo elige
                    // `operation: "agent_visual_verify"` en la politica de
                    // modelos, que es una sola fuente en vez de tres.
                  });
                  // LA CUENTA, antes de decidir. La ruta sólo miraba
                  // `verdict.broken` y tiraba `verdict.fallback`, así que nada
                  // DENTRO del producto distinguía «miré y está bien» de «no
                  // pude mirar» — y los ojos fallan ABIERTOS por diseño. Con
                  // Chrome caído en el box la verificación aprobaría todo en
                  // silencio, y sólo el journal lo sabría. Crear ya contaba los
                  // suyos (`recordCriticRun`); el Agente no contaba nada.
                  recordAgentEyes({ fallback: verdict.fallback, broken: verdict.broken });
                  // 🔴 Y AHORA EL FALLBACK SALE POR SU PROPIA PUERTA. La cuenta
                  // de arriba ya distinguía «miré» de «no pude mirar», pero el
                  // valor que devolvía esta función no: los dos salían como
                  // `ok: true`, así que aguas abajo —la tarjeta, el bucle, el
                  // cierre del modelo— el visto bueno de una verificación real
                  // era indistinguible del de una que nunca corrió.
                  if (verdict.fallback) {
                    return { estado: "no_mirado", motivo: "la verificación visual no pudo correr" };
                  }
                  if (verdict.broken) {
                    return {
                      estado: "roto",
                      critique: verdict.issues.map((i) => `- ${i}`).join("\n"),
                      // LA CUENTA, para que el bucle pueda decir si BAJÓ. Sin
                      // ella «lo arreglé» y «lo dejé igual» llegan idénticos, y
                      // el bucle tendría que concederle otra vuelta al modelo
                      // que oscila entre dos arreglos igual que al que avanza.
                      problemas: verdict.issues.length,
                    };
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
                    return { estado: "observado", notas: verdict.observaciones };
                  }
                  return { estado: "bien" };
                },
          emit: (ev) => emit(ev.type, ev),
          onMutacion: () => {
            mutoDurable = true;
          },
        });
        mutoDurable = mutoDurable || result.mutoDurable;
        // F2-T9 billing ruling (Jesús 2026-07-07): a turn that ended on a
        // terminal error (stopReason error/cancelled/max_tokens, or the
        // maxTurns/maxToolCalls caps) debits 0 credits — the user got no
        // usable output. A clean end_turn finish charges normally, even
        // when a tool inside it returned {ok:false} as data or the turn
        // ended waiting on a confirm card.
        // El importe se calcula SIEMPRE, se cobre o no. Hasta el 25/08 vivía
        // dentro de la rama que cobra, así que el diario del cargo perdido
        // registraba el hecho y no el dinero: se podían contar los casos pero no
        // sumarlos, que es justo la pregunta que hay que responder.
        const { inputTokens, outputTokens, cachedTokens } = result.usage;
        const credits = Math.max(
          1,
          creditsForUsage(inputTokens, outputTokens, brain.creditRate(), cachedTokens),
        );
        if (!result.terminalError) {
          // La entrada cacheada SÍ se cobra más barata desde el 2026-08-28:
          // `creditsForUsage` recibe `cachedTokens` y les aplica la tarifa
          // `cached` de `lib/credits.ts`. Este comentario decía lo contrario
          // —«visibility only»— porque describía la factura de Google, y era
          // cierto cuando el turno corría en Gemini. Hoy corre en Fireworks,
          // donde la caché es por réplica y el descuento es NUESTRO de aplicar.
          const cachedPct = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0;
          console.log(
            `[agent] ${brain.modelId} — in ${inputTokens} (cached ${cachedTokens}, ${cachedPct}%) / out ${outputTokens}` +
              // La poda es lo único que RETIRA bytes del turno y no dejaba
              // rastro: su contador se calculaba y se tiraba. Sólo se imprime
              // cuando podó algo, para que la línea normal quede igual que antes.
              (result.documentosPodados > 0 ? ` / podados ${result.documentosPodados}` : ""),
          );
          await debitCredits(userId, credits);
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
        emit("done", {
          turns: result.turns,
          toolCalls: result.toolCalls,
          ...(mutoDurable ? { mutoDurable: true } : {}),
          ...(result.topeAlcanzado ? { topeAlcanzado: result.topeAlcanzado } : {}),
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
        emit("error", { message: err instanceof Error ? err.message : "Unknown error", code });
        // Y aquí también: el bucle reventó, pero si ya había escrito, el cambio
        // es igual de durable. El `done` cierra el turno con el aviso en vez de
        // dejar un rojo sobre una página que sí cambió.
        if (mutoDurable) emit("done", { turns: 0, toolCalls: 0, mutoDurable: true });
        close();
      } finally {
        clearTimeout(timeout);
        // EL TURNO SE CIERRA PASE LO QUE PASE. Si no, su fila se queda con la
        // correccion que nadie leera y ocupando sitio en el mapa.
        cerrarTurno(turnoId);
        // FAIL-SOFT y del todo: una grabación es una herramienta de
        // diagnóstico, y no puede costarle el turno a nadie ni ensuciar la
        // respuesta. Si el directorio no existe, si el disco está lleno o si el
        // JSON no serializa, se dice por consola y se sigue.
        if (grabadora && !grabadora.vacia) {
          try {
            const grabado = grabadora.resultado({ modelId: brain.modelId, requestId: projectId });
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
/**
 * `code` es para los fallos que un USUARIO puede provocar; `message` para los
 * que sólo alcanza un cliente roto o nosotros.
 *
 * POR QUÉ LA DISTINCIÓN. El panel pinta `error` TAL CUAL cuando es una cadena
 * (chat-panel.tsx), así que cada `errorJson(413, "Page too large…")` llegaba a
 * un usuario japonés en inglés. La regla ya estaba escrita en este repo —código
 * y campos, que el cliente componga— y aquí no se aplicaba.
 *
 * No se convierten los diez: `unauthorized`, `projectId is required` o
 * `project not found` no los alcanza la interfaz, y traducir un fallo que sólo
 * ve un `curl` es trabajo sin lector. Se convierten los que un usuario SÍ toca.
 */
function errorJson(status: number, message: string, code?: string): Response {
  return jsonResponse(code ? { error: message, code } : { error: message }, status);
}
