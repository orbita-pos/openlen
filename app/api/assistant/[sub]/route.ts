import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSubdomainOwner } from "@/lib/projects";
import { checkAndConsume, getClientIp, ipLimitKey } from "@/lib/limits";
import { fireworksStreamProvider, type StreamProviderLike } from "@/lib/ai/fireworks-as-stream-provider";
import {
  buildMessages,
  sanitizeUserMessage,
  RESPONSE_SCHEMA,
  MAX_HISTORY_TURNS,
  type AssistantIntent,
  type AssistantTurn,
} from "@/lib/site-assistant/prompt";
import { siteToText, detectPageLang } from "@/lib/site-assistant/extract-text";
import { consumeAssistantMessage } from "@/lib/site-assistant/quota";

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
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

interface AssistantReply {
  respuesta: string;
  intent: AssistantIntent;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
  const quota = await consumeAssistantMessage(owner.projectId, owner.userId);
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
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
      { signal: req.signal },
    );

    let raw = "";
    for await (const event of events) {
      if (event.type === "text_delta") raw += event.text;
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
