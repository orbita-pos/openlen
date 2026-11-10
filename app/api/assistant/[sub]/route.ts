import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSubdomainOwner } from "@/lib/projects";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { fireworksStreamProvider, type StreamProviderLike } from "@/lib/ai/fireworks-as-stream-provider";
import {
  buildMessages,
  sanitizeUserMessage,
  MAX_HISTORY_TURNS,
  type AssistantIntent,
  type AssistantTurn,
} from "@/lib/site-assistant/prompt";
import { siteToText, detectPageLang } from "@/lib/site-assistant/extract-text";
import { consumeAssistantMessage } from "@/lib/site-assistant/quota";
import { creditsForUsage, recordUncharged } from "@/lib/credits";
import { creditRateForRole, modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import { assistantsEnabled } from "@/lib/assistants/enabled";
import type { AssistantTone } from "@/lib/assistants/names";
import { answersVisitors } from "@/lib/assistants/visitor/on-page";
import { assistantOnPage } from "@/lib/assistants/visitor/store";
import { runVisitorTurn } from "@/lib/assistants/visitor/turn";
import type { ProjectData } from "@/lib/projects/types";

/** The visitor's anonymous id, from their browser (spec local 2026-11-06-asistente-propio, §6.6). */
const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** THE PERSON'S OWN ASSISTANT on this page (phase 2A), or null: with the switch off, never looked up. */
async function herOnThePage(projectId: string): Promise<Awaited<ReturnType<typeof assistantOnPage>>> {
  if (!assistantsEnabled()) return null;
  return assistantOnPage(projectId).catch((err: unknown) => {
    console.warn("[assistant] couldn't tell whether the page's own assistant is on", err);
    return null;
  });
}

/** The page's chat can take the visitor: the same rule as the GET's `traspaso`. */
function handoffOf(data: ProjectData): boolean {
  const chat = data.settings?.chat;
  return chat?.enabled === true && chat.selfServeJoin !== false && chat.identityMode !== "account";
}

// ─────────────────────────────────────────────────────────────────────────────
// Public site-assistant endpoint. The chat widget on a published page POSTs
// {message, history} here. No auth — visitors chat. Defense layers (OWASP
// LLM01/LLM10): per-IP rate limits, input caps + control-token strip, no tools
// and no secrets reachable from the prompt, output schema + token cap, and the
// provider-side monthly budget as the final backstop. Same CORS posture as the
// public forms endpoint (/api/f/[sub]).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// JSON answers are 1-3 sentences; 1024 leaves room for the model's internal
// thinking budget (see lib/ai-gateway.ts header) at negligible worst-case cost.
const MAX_OUTPUT_TOKENS = 1024;

const CORS_HEADERS = {
  "content-type": "application/json",
  // The widget lives on <sub>.openlen.com / a custom domain — different origin
  // than this endpoint — so the fetch needs CORS to read the reply.
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

interface AssistantReply {
  respuesta: string;
  intent: AssistantIntent;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** EL ESTADO QUE MIRA LA BURBUJA, para poder esconderse sola.
 *
 *  El widget va HORNEADO en la release: apagar el asistente en el taller no
 *  toca el disco, así que la burbuja seguía en la página publicada y, al
 *  preguntarle, devolvía «Hubo un problema. Intenta de nuevo en un momento.»
 *  — un 403 `disabled` disfrazado de avería pasajera. Con esto el widget lo
 *  pregunta al cargar y se retira si ya no hay nadie al otro lado.
 *
 *  Lo que devuelve es ESPEJO EXACTO de lo que hacen cumplir las rutas de
 *  verdad, no de lo que el dueño ve en el taller: `asistente` repite la
 *  decisión del POST de aquí abajo (habilitado Y con texto del que responder)
 *  y `chat` repite la de `/api/chat/<sub>/*`. Un espejo despegado esconde una
 *  burbuja que funciona, o deja una que no.
 *
 *  Tres booleanos y nada más: esto lo puede pedir cualquiera sin autenticarse.
 *  Caché de 60 s — una visita es una petición, y ése es también el tiempo
 *  máximo que tarda en esconderse. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  // UN TOPE, aunque esto no devuelva nada que valga robar: es público, sin
  // autenticar, y cuesta dos consultas más un `siteToText` del sitio entero.
  // Holgado a propósito —una visita normal pide esto UNA vez y la respuesta se
  // cachea 60 s—, y el widget trata cualquier respuesta que no sea 200 como
  // «no sé»: un 429 deja la burbuja donde está, nunca la retira.
  const limit = await checkAndConsume(ipLimitKey(getClientIp(req), "assistant-estado"), [
    { windowMs: MINUTE, max: 60, label: "burst" },
    { windowMs: HOUR, max: 600, label: "hourly" },
  ]);
  if (!limit.ok) return reply(429, { error: "rate_limited" });

  const owner = await getSubdomainOwner(sub);
  if (!owner) return reply(404, { error: "not_found" });

  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, owner.projectId))
    .limit(1);
  const project = rows[0];
  if (!project?.data) return reply(404, { error: "not_found" });

  const settings = project.data.settings;
  const chat = settings?.chat;
  // Her too (phase 2A): on the page and published with her — the same rule as her POST.
  const ella = await herOnThePage(owner.projectId);
  return new Response(
    JSON.stringify({
      // ESPEJO EXACTO, y las dos formas distintas de mirar `enabled` son parte
      // del espejo: el POST de aquí abajo usa `!assistant?.enabled` (verdadero
      // o falso a secas) y `loadChatSite` usa `=== true`. Copiar cada uno como
      // es evita el peor resultado —retirar una burbuja que sí atiende— si un
      // día alguien escribe un 1 o un "true" en el JSONB.
      asistente: answersVisitors(ella) || (Boolean(settings?.assistant?.enabled) && siteToText(project.data) !== ""),
      chat: chat?.enabled === true,
      // EL TRASPASO NO ES EL CHAT. El botón «Hablar con una persona» llama a
      // /api/chat/<sub>/handoff, que además de un chat encendido exige que sea
      // un espacio de invitado y de entrada libre (ahí se acuña un invitado).
      // Con `chat` a secas, el dueño que pasa su chat a modo cuenta dejaba el
      // botón puesto dando 403 `not_allowed` — el mismo error disfrazado de
      // avería que todo esto viene a quitar, en el botón de al lado.
      traspaso:
        chat?.enabled === true && chat.selfServeJoin !== false && chat.identityMode !== "account",
    }),
    { status: 200, headers: { ...CORS_HEADERS, "cache-control": "public, max-age=60" } },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;

  const owner = await getSubdomainOwner(sub);
  if (!owner) return reply(404, { error: "not_found" });

  // Burst + sustained per-IP windows. Sized for a chatty real visitor
  // (research: legit sessions run 3-15 messages) while making scripted abuse
  // uneconomical.
  //
  // El tope mensual POR SITIO ya no «layers on later»: está 30 líneas más
  // abajo (consumeAssistantMessage). Esa frase en futuro sobrevivió a su
  // propia implementación y el 2026-08-28 costó una auditoría entera —
  // leyéndola se concluyó que esta ruta no tenía techo y se estimó una
  // exposición de 6 dólares al mes por IP. El techo real es 5 centavos.
  // Los dos límites son distintos y los dos hacen falta: éste corta la ráfaga
  // de UNA IP, el de abajo corta el gasto del SITIO venga de donde venga.
  const ip = getClientIp(req);
  const limit = await checkAndConsume(ipLimitKey(ip, "assistant-chat"), [
    { windowMs: MINUTE, max: 8, label: "burst" },
    { windowMs: HOUR, max: 40, label: "hourly" },
    { windowMs: DAY, max: 120, label: "daily" },
  ]);
  if (!limit.ok) return reply(429, { error: "rate_limited" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_request" });
  }

  // THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.2, §4.7): with her on the page AND published
  // with her (what she knows is saved by that publish), the message wakes her turn on Len's engine. Until that publish
  // the page's bubble is still today's, and goes on below exactly as before.
  const ella = await herOnThePage(owner.projectId);
  if (answersVisitors(ella)) return herTurn(req, sub, owner, body, ella!);

  const parsed = parseBody(body);
  if (!parsed) return reply(400, { error: "bad_request" });

  const rows = await db
    .select({ title: schema.projects.title, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, owner.projectId))
    .limit(1);
  const project = rows[0];
  if (!project?.data) return reply(404, { error: "not_found" });

  const assistant = project.data.settings?.assistant;
  if (!assistant?.enabled) return reply(403, { error: "disabled" });

  const pageText = siteToText(project.data);
  if (!pageText) return reply(403, { error: "disabled" });

  // Per-site monthly cap (plan metering). Over cap, degrade gracefully to a
  // lead capture instead of erroring — the owner still gets the contact, and
  // la petición no llega al modelo (techo de coste). Corre por Fireworks desde
  // el 2026-08-21, no por Gemini.
  const quota = await consumeAssistantMessage(owner.userId);
  if (!quota.ok) {
    return reply(200, {
      respuesta:
        "¡Gracias por escribir! En este momento no puedo responder por aquí, pero déjame tu nombre y correo y el equipo te contactará pronto.",
      intent: "lead",
    } satisfies AssistantReply);
  }

  const messages = buildMessages(
    {
      businessName: project.title || sub,
      pageText,
      brain: {
        facts: (assistant.facts ?? "").slice(0, 4000),
        tone: assistant.tone,
      },
      defaultLocale: detectPageLang(project.data.html) ?? "es",
    },
    parsed.history,
    parsed.message,
  );

  // El asistente del sitio responde TEXTO: lo escribe DeepSeek, por el mismo
  // transporte que el resto. Aqui vivia `OPENLEN_ASSISTANT_PROVIDER=gemini`,
  // retirado el 2026-08-28 con el proveedor: ya no hay a donde volver.

  try {
    const provider: StreamProviderLike = fireworksStreamProvider({
          requestId: "site-assistant",
          operation: "copy",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          jsonObject: true,
        });
    const events = provider.stream(
      {
        messages,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
      { signal: req.signal },
    );

    let raw = "";
    let usage: { inputTokens: number; cachedTokens: number; outputTokens: number } | null = null;
    for await (const event of events) {
      if (event.type === "text_delta") raw += event.text;
      else if (event.type === "usage") {
        usage = { inputTokens: event.inputTokens, cachedTokens: event.cachedTokens ?? 0, outputTokens: event.outputTokens };
      }
    }
    // EL LIBRO DE GASTO: lo paga OpenLen, a nombre del dueño de la página. No
    // se espera: anotar no puede retrasar ni tumbar la respuesta al visitante.
    if (usage) {
      void recordUncharged(owner.userId, {
        surface: "page_assistant",
        outcome: "ok",
        projectId: owner.projectId,
        // Lo que valía a la tarifa de cobro: lo que OpenLen regala al no cobrarlo.
        listCenticredits: creditsForUsage(
          usage.inputTokens,
          usage.outputTokens,
          creditRateForRole(roleForOperation("copy")),
          usage.cachedTokens,
        ),
        uses: [
          {
            provider: "fireworks",
            model: modelIdForRole(roleForOperation("copy")),
            ...usage,
            at: new Date(),
          },
        ],
      }).catch(() => undefined);
    }

    const out = parseReply(raw);
    if (!out) {
      // eslint-disable-next-line no-console
      console.error("[assistant] unparseable model reply", raw.slice(0, 200));
      return reply(502, { error: "model_error" });
    }
    return reply(200, out);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[assistant] gateway failed", err);
    return reply(502, { error: "model_error" });
  }
}

/** Her turn: `{message, vid}` in; the reply, `asleep` (never a word about billing) or `busy` out. The client's history
 *  is never read: the visit keeps what she saw (lib/assistants/visitor/turn.ts). */
async function herTurn(
  req: Request,
  sub: string,
  owner: { userId: string; projectId: string },
  body: unknown,
  ella: NonNullable<Awaited<ReturnType<typeof assistantOnPage>>>,
): Promise<Response> {
  const b = (typeof body === "object" && body !== null ? body : {}) as { message?: unknown; vid?: unknown };
  const message = typeof b.message === "string" ? sanitizeUserMessage(b.message) : "";
  // No vid at all = today's bubble, still open from before the publish that brought hers: it gets her answer, each
  // message on its own (no continuity), instead of an error until the visitor reloads. A malformed one is refused.
  const vid = b.vid === undefined ? randomBytes(16).toString("base64url") : typeof b.vid === "string" && VISITOR_ID.test(b.vid) ? b.vid : null;
  if (!message || !vid) return reply(400, { error: "bad_request" });
  // On the page, but the page was never published with her: she knows nothing yet.
  // On the page, but nothing for her to know yet (never published with her, or no text and no public data).
  if (!answersVisitors(ella)) return reply(403, { error: "disabled" });
  const knowledge = ella.knowledge?.trim() ?? "";

  const rows = await db
    .select({ title: schema.projects.title, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, owner.projectId))
    .limit(1);
  const project = rows[0];
  if (!project?.data) return reply(404, { error: "not_found" });

  try {
    const r = await runVisitorTurn({
      projectId: owner.projectId,
      ownerId: owner.userId,
      assistant: { id: ella.assistant.id, name: ella.assistant.name, slug: ella.assistant.slug, tone: ella.assistant.tone as AssistantTone, memory: ella.assistant.memory },
      businessName: project.title || sub,
      knowledge,
      siteLocale: detectPageLang(project.data.html) ?? "es",
      visitorId: vid,
      message,
      handoffAvailable: handoffOf(project.data),
      publicData: ella.publicData ?? [],
      signal: req.signal,
    });
    if (r.kind === "busy") return reply(429, { error: "busy" });
    if (r.kind === "asleep") return reply(200, { asleep: true, intent: "lead" });
    return reply(200, { respuesta: r.text, intent: r.intent, ...(r.visuals.length ? { visuals: r.visuals } : {}) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[assistant] her turn failed", err);
    return reply(502, { error: "model_error" });
  }
}

function reply(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: CORS_HEADERS,
  });
}

/** Validates the widget body: {message: string, history?: {role, content}[]}.
 *  History is advisory client state — capped, role-whitelisted, re-sanitized;
 *  the server never trusts it beyond that. */
function parseBody(
  body: unknown,
): { message: string; history: AssistantTurn[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { message?: unknown; history?: unknown };
  if (typeof b.message !== "string") return null;
  const message = sanitizeUserMessage(b.message);
  if (message.length === 0) return null;

  const history: AssistantTurn[] = [];
  if (Array.isArray(b.history)) {
    for (const item of b.history.slice(-MAX_HISTORY_TURNS)) {
      if (typeof item !== "object" || item === null) continue;
      const t = item as { role?: unknown; content?: unknown };
      if (t.role !== "user" && t.role !== "assistant") continue;
      if (typeof t.content !== "string") continue;
      const content = sanitizeUserMessage(t.content);
      if (content.length === 0) continue;
      history.push({ role: t.role, content });
    }
  }
  return { message, history };
}

const INTENTS: readonly AssistantIntent[] = [
  "answer",
  "lead",
  "handoff",
  "refusal",
];

function parseReply(raw: string): AssistantReply | null {
  try {
    const json = JSON.parse(raw) as {
      respuesta?: unknown;
      intent?: unknown;
    };
    if (typeof json.respuesta !== "string" || json.respuesta.length === 0) {
      return null;
    }
    const intent = INTENTS.includes(json.intent as AssistantIntent)
      ? (json.intent as AssistantIntent)
      : "answer";
    return { respuesta: json.respuesta.slice(0, 1200), intent };
  } catch {
    return null;
  }
}
