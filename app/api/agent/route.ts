import { auth } from "@/auth";
import { GeminiProvider, type InlineImage } from "@/lib/ai-gateway";
import { resolveAIProvider } from "@/lib/ai-provider";
import { getCreditState, debitCredits, creditsForUsage } from "@/lib/credits";
import { resolveOpIdByPath, tagWithOpIds } from "@/lib/html-ops";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { validateUrl } from "@/lib/style-match/scrape/validate-url";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { buildAgentMessages } from "@/lib/agent/context";
import { runAgentLoop, type AgentErrorCode } from "@/lib/agent/loop";
import { streamWithRetry } from "@/lib/agent/retry";
import { realDeps, runAgentTool, summarizeProjectState, type AgentSession } from "@/lib/agent/tools";
import { verifyEditedPage } from "@/lib/agent/verify";

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
    history?: { role: "user" | "assistant"; content: string }[];
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

  // Same validation ai-design applies to body.page: a non-empty slug that
  // doesn't resolve against this project's data.pages is a 404, never a
  // silent fallback to home.
  const pageSlug =
    pageSlugRaw && project.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");

  const PROVIDER = resolveAIProvider("gemini-flash");
  if (!PROVIDER.key) return errorJson(500, `${PROVIDER.label} API key missing`);

  // The ACTIVE document — home's data.html or the validated subpage's html.
  // Same no-taggable-elements 400 as before, now checked against whichever
  // document is actually active this turn.
  const activeHtml = pageSlug ? project.data.pages?.[pageSlug]?.html ?? "" : project.data.html ?? "";
  const { taggedHtml, taggedCount } = tagWithOpIds(activeHtml);
  if (taggedCount === 0) return errorJson(400, "project html has no taggable elements");

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
      attachedInline = await fetchImageAsInlineData(attachedImage.url, { redirect: "error" });
    }
  }

  const state = summarizeProjectState({
    data: project.data,
    title: project.title,
    subdomain: project.subdomain,
    publishedAt: project.publishedAt,
  });
  const built = buildAgentMessages({
    state,
    taggedHtml,
    userBrief: project.userBrief,
    prompt,
    history,
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
    ownerEmail: session.user.email ?? null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
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
          const code: AgentErrorCode = "no_credits";
          emit("error", {
            message: "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
            code,
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
          openStream: (msgs) => {
            // F5: los píxeles adjuntos van SOLO en el turno cuyo último
            // mensaje es el prompt del usuario (el gateway los ancla ahí);
            // mezclarlos con un mensaje de functionResponses rompería el
            // protocolo FC de Gemini.
            const withImage =
              attachedInline && msgs[msgs.length - 1] === promptMessage
                ? [attachedInline]
                : undefined;
            return streamWithRetry(
              () =>
                provider.stream(
                  {
                    model: PROVIDER.model,
                    messages: msgs,
                    tools,
                    toolMode: "auto",
                    maxOutputTokens: 16_384,
                    temperature: 0.7,
                    ...(withImage ? { images: withImage } : {}),
                  },
                  { signal: upstreamAbort.signal },
                ),
              { signal: upstreamAbort.signal },
            );
          },
          // Graceful termination: a tools-OFF stream the loop uses only to
          // compose a closing summary when a step-budget cap is hit, so the turn
          // ends with "here's what I did / what's pending" instead of a red error.
          closeOut: (msgs) =>
            streamWithRetry(
              () =>
                provider.stream(
                  { model: PROVIDER.model, messages: msgs, tools: [], toolMode: "none", maxOutputTokens: 2_048, temperature: 0.7 },
                  { signal: upstreamAbort.signal },
                ),
              { signal: upstreamAbort.signal },
            ),
          runTool: (name, args) => runAgentTool(agentSession, deps, name, args),
          // F5 — los ojos: tras un turno que mutó el documento, renderiza y
          // verifica rotura visual objetiva; si la hay, el loop inyecta la
          // crítica y el modelo recibe UN ciclo de arreglo. El costo del
          // render+visión corre por la casa (no entra en result.usage — el
          // usuario no paga la QA). Kill-switch: OPENLEN_AGENT_VISION=0.
          verifyTurn:
            process.env.OPENLEN_AGENT_VISION === "0"
              ? undefined
              : async ({ html }) => {
                  const verdict = await verifyEditedPage({
                    html,
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
          const credits = creditsForUsage(inputTokens, outputTokens, PROVIDER.rate);
          // F3: Gemini's implicit-cache discount (90% off cached input
          // tokens) is automatic on Google's own invoice — creditsForUsage
          // still prices off raw input/output, so OpenLen's product credits
          // are UNCHANGED by cachedTokens; this is visibility only.
          const cachedPct = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0;
          console.log(
            `[agent] tokens — in ${inputTokens} (cached ${cachedTokens}, ${cachedPct}%) / out ${outputTokens}`,
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

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
