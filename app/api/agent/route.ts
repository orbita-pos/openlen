import { auth } from "@/auth";
import { GeminiProvider, type Message } from "@/lib/ai-gateway";
import { resolveAIProvider } from "@/lib/ai-provider";
import { getCreditState, debitCredits, creditsForUsage } from "@/lib/credits";
import { resolveOpIdByPath, tagWithOpIds } from "@/lib/html-ops";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildAgentContext, estimateContextTokens } from "@/lib/agent/context";
import { runAgentLoop } from "@/lib/agent/loop";
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";

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
//   - error  { message }
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
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthorized");

  const body = (await req.json().catch(() => null)) as {
    projectId?: string;
    prompt?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    scope?: ScopeBody;
    attachedImage?: AttachedImageBody;
  } | null;

  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!projectId) return errorJson(400, "projectId is required");
  if (prompt.length === 0 || prompt.length > 2000) return errorJson(400, "prompt must be 1–2000 chars");
  // History hardening: map to ONLY {role, content} (the TS wrapper serializes
  // functionCalls/functionResponses off Message objects, so a client-supplied
  // history entry spread whole would be a tool-call injection vector) and cap
  // each content at 4000 chars.
  const history = Array.isArray(body?.history)
    ? body.history
        .filter(
          (h) =>
            h &&
            (h.role === "user" || h.role === "assistant") &&
            typeof h.content === "string" &&
            h.content.length > 0,
        )
        .slice(-6)
        .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }))
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

  const PROVIDER = resolveAIProvider("gemini-flash");
  if (!PROVIDER.key) return errorJson(500, `${PROVIDER.label} API key missing`);

  const { taggedHtml, taggedCount } = tagWithOpIds(project.data.html ?? "");
  if (taggedCount === 0) return errorJson(400, "project html has no taggable elements");

  // Hard-pin: only when the client sent BOTH a path and a hint (mirrors
  // ai-design) AND the path resolves against the freshly tagged document.
  // Any failure degrades silently to the soft hint.
  let scopePin: { opId: string; hint: string } | null = null;
  if (scopePath && scopeHint) {
    const opId = resolveOpIdByPath(taggedHtml, scopePath);
    if (opId) scopePin = { opId, hint: scopeHint };
  }

  const systemPrompt = buildAgentSystemPrompt();
  const state = summarizeProjectState({
    data: project.data,
    title: project.title,
    subdomain: project.subdomain,
    publishedAt: project.publishedAt,
  });
  const contextBlock = buildAgentContext({
    state,
    taggedHtml,
    userBrief: project.userBrief,
    attachedImage,
    scopePin,
    scopeHint,
  });
  const historyText = history.map((h) => h.content).join("\n");
  if (estimateContextTokens(contextBlock + historyText + prompt, systemPrompt) > MAX_PROMPT_TOKENS) {
    return errorJson(413, "Page too large for an agent turn");
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contextBlock },
    { role: "assistant", content: "Entendido. Tengo el estado y el documento. ¿Qué hacemos?" },
    ...history,
    { role: "user", content: prompt },
  ];

  const upstreamAbort = new AbortController();
  const agentSession: AgentSession = {
    projectId,
    userId,
    taggedHtml,
    ownerEmail: session.user.email ?? null,
    imageEditsThisTurn: 0,
  };
  const provider = new GeminiProvider(PROVIDER.key as string);
  const tools = buildFunctionDeclarations();

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const timeout = setTimeout(() => upstreamAbort.abort(), STREAM_TIMEOUT_MS);
      try {
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", { message: "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro." });
          close();
          return;
        }
        const result = await runAgentLoop({
          messages,
          tools,
          openStream: (msgs) =>
            provider.stream(
              { model: PROVIDER.model, messages: msgs, tools, toolMode: "auto", maxOutputTokens: 16_384, temperature: 0.7 },
              { signal: upstreamAbort.signal },
            ),
          runTool: (name, args) => runAgentTool(agentSession, deps, name, args),
          emit: (ev) => emit(ev.type, ev),
        });
        const credits = creditsForUsage(result.usage.inputTokens, result.usage.outputTokens, PROVIDER.rate);
        await debitCredits(userId, Math.max(1, credits));
        emit("done", { turns: result.turns, toolCalls: result.toolCalls });
        close();
      } catch (err) {
        console.error("[agent] stream failed", err);
        emit("error", { message: err instanceof Error ? err.message : "Unknown error" });
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

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
