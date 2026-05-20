import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState, debitCredits, estimateCredits } from "@/lib/credits";
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import {
  PLAN_LIMITS,
  checkAndConsume,
  getUserPlan,
  userLimitKey,
} from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/generate — free-form AI landing-page generation.
//
// Body: { brief: string }
//
// One Kimi K2.6 streaming call turns the brief into a complete HTML document —
// the same model + design system as the Chat editor (/api/templates/ai-design),
// just generating from scratch instead of editing. Server-Sent Events:
//   event: reasoning_chunk { text }            — design reasoning, append-only
//   event: html_chunk      { text }            — the HTML document, append-only
//   event: project_saved   { projectId, title} — terminal success
//   event: error           { message }
//
// The model writes 1-3 sentences of reasoning, a literal ---HTML--- marker,
// then the full document. We split on the marker as bytes arrive so the client
// can show streaming reasoning, then a live preview of the page.
// ─────────────────────────────────────────────────────────────────────────────

const ENCODER = new TextEncoder();
const MARKER = "---HTML---";

const SYSTEM_PROMPT = `You are a senior product designer-engineer hybrid with the eye of Linear, Vercel, Stripe, and Resend. You generate complete, production-grade landing pages from a short brief.

The user gives you a brief — sometimes specific, often vague or generic. Design and build the entire landing page yourself. You have FULL CREATIVE FREEDOM and the user trusts your taste. A vague or generic brief is your cue to apply judgment and taste, NOT to ask questions or fall back on something safe and forgettable.

${DESIGN_GUIDANCE}

OUTPUT EFFICIENCY (critical — long documents truncate against the response cap):
- No HTML comments (<!-- ... -->) anywhere in the output.
- No multi-line whitespace inside elements. Single-line each element when reasonable.
- Reuse Tailwind classes — if a card pattern repeats across siblings, give it one class in <style> and apply it instead of pasting the long class string.
- Collapse redundant CSS rules. No "/* Pricing */"-style section dividers in <style>.
- Inline <svg>: only emit what's needed; skip xmlns when duplicated across many siblings.
- Skip blank lines between sections of the document. Compact.
- Goal: same visual quality, fewer tokens.

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Include a descriptive <title> in <head> that names the product.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. Allowed families: Inter, Geist, Fraunces, Source Serif 4, Crimson Pro, JetBrains Mono.
- All custom CSS inline in a <style> block in <head>. Use CSS custom properties on :root for design tokens (--accent, --accent-r as an RGB triplet, --bg, --fg, --font-display, --font-body, --radius). Reference them via var() throughout — never hardcode the same color in many places.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that is a reserved editor-mode marker.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Inline SVG for logos / icons / illustrations. NO external image URLs. For hero / product imagery use a <div> with a tasteful bg-gradient-to-br placeholder.
- Mobile-responsive down to 360px width.

OUTPUT FORMAT — follow exactly:
First, write 1-3 sentences of design reasoning — the aesthetic direction you chose and why, the way a senior designer briefs a peer. Plain prose, no token values.
Then a blank line.
Then the literal marker on its own line: ${MARKER}
Then a newline, then the complete HTML document starting with <!doctype html> and ending with </html>.
Do NOT wrap the HTML in markdown code fences.`;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const brief =
    body &&
    typeof body === "object" &&
    typeof (body as { brief?: unknown }).brief === "string"
      ? (body as { brief: string }).brief.trim()
      : "";
  if (brief.length < 10 || brief.length > 4000) {
    return json({ error: "brief must be 10–4000 characters" }, 400);
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Auth required — anonymous /api/generate would let anyone burn Together
  // credits without ever creating an account.
  if (!userId) return json({ error: "unauthorized" }, 401);

  // Quota check — hourly + monthly windows defined in lib/limits.ts.
  const plan = await getUserPlan(userId);
  const decision = await checkAndConsume(
    userLimitKey(userId, "generate"),
    PLAN_LIMITS[plan].generate,
  );
  if (!decision.ok && decision.blocked) {
    return new Response(
      JSON.stringify({
        error: "quota_exceeded",
        scope: decision.blocked.label,
        plan,
        max: decision.blocked.max,
        windowMs: decision.blocked.windowMs,
        resetAt: decision.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                ((decision.resetAt?.getTime() ?? Date.now() + 60000) -
                  Date.now()) /
                  1000,
              ),
            ),
          ),
        },
      },
    );
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) return json({ error: "TOGETHER_API_KEY missing" }, 500);

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: `BRIEF:\n${brief}` },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            ENCODER.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let accumulatedReasoning = "";
      let accumulatedHtml = "";
      let buffer = "";
      let mode: "reasoning" | "html" = "reasoning";

      // While in reasoning mode, hold back the trailing (MARKER.length - 1)
      // characters in case they are the start of the marker. We only emit
      // bytes that can't be part of a future marker boundary.
      const HOLDBACK = MARKER.length - 1;

      const flushReasoning = (final: boolean) => {
        const safeLen = final
          ? buffer.length
          : Math.max(0, buffer.length - HOLDBACK);
        if (safeLen <= 0) return;
        const out = buffer.slice(0, safeLen);
        buffer = buffer.slice(safeLen);
        accumulatedReasoning += out;
        emit("reasoning_chunk", { text: out });
      };

      const handleDelta = (delta: string) => {
        buffer += delta;
        if (mode === "reasoning") {
          const idx = buffer.indexOf(MARKER);
          if (idx >= 0) {
            const before = buffer.slice(0, idx);
            if (before.length > 0) {
              accumulatedReasoning += before;
              emit("reasoning_chunk", { text: before });
            }
            const after = buffer
              .slice(idx + MARKER.length)
              .replace(/^\r?\n/, "");
            buffer = "";
            mode = "html";
            if (after.length > 0) {
              accumulatedHtml += after;
              emit("html_chunk", { text: after });
            }
          } else {
            flushReasoning(false);
          }
        } else {
          accumulatedHtml += buffer;
          emit("html_chunk", { text: buffer });
          buffer = "";
        }
      };

      try {
        // Credit gate — one credit is enough to start; the real cost is
        // metered + debited after the page is built (see below).
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

        const upstream = await fetch(
          "https://api.together.xyz/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "moonshotai/Kimi-K2.6",
              messages,
              temperature: 0.8,
              max_tokens: 65_536,
              stream: true,
            }),
          },
        );

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          emit("error", {
            message: `Together API ${upstream.status}: ${text.slice(0, 200)}`,
          });
          closeStream();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = "";
        let upstreamDone = false;
        let finishReason: string | null = null;

        while (!upstreamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = sseBuf.indexOf("\n\n")) >= 0) {
            const block = sseBuf.slice(0, nl);
            sseBuf = sseBuf.slice(nl + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") {
                upstreamDone = true;
                break;
              }
              try {
                const parsed = JSON.parse(payload) as {
                  choices?: Array<{
                    delta?: { content?: string };
                    finish_reason?: string | null;
                  }>;
                };
                const choice = parsed.choices?.[0];
                if (typeof choice?.finish_reason === "string") {
                  finishReason = choice.finish_reason;
                }
                const content = choice?.delta?.content;
                if (typeof content === "string" && content.length > 0) {
                  handleDelta(content);
                }
              } catch {
                /* skip malformed line */
              }
            }
            if (upstreamDone) break;
          }
        }

        if (mode === "reasoning") {
          // We never crossed the ---HTML--- marker.
          flushReasoning(true);
          emit("error", {
            message:
              "The model returned only reasoning — it didn't emit the HTML. Try again.",
          });
          closeStream();
          return;
        }

        if (buffer.length > 0) {
          accumulatedHtml += buffer;
          emit("html_chunk", { text: buffer });
          buffer = "";
        }

        const html = stripMarkdownFences(accumulatedHtml);
        if (html.length < 1000 || !/^<!doctype/i.test(html)) {
          emit("error", {
            message:
              "The model didn't return a complete HTML document. Try again.",
          });
          closeStream();
          return;
        }
        if (!/<\/html>\s*$/i.test(html)) {
          emit("error", {
            message:
              finishReason === "length"
                ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                : "The page ended without a closing </html>. Try again.",
          });
          closeStream();
          return;
        }
        if (html.includes("data-slot-path=")) {
          emit("error", {
            message: "The model emitted editor-mode markers — try again.",
          });
          closeStream();
          return;
        }

        const title = extractTitle(html) ?? brief.slice(0, 60).trim();

        let projectId: string;
        try {
          projectId = await createProject(userId, { html, brief, title });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[generate] createProject failed", err);
          emit("error", {
            message: "Generated the page but couldn't save it — try again.",
          });
          closeStream();
          return;
        }

        // Seed the version history so the user has a v0 to restore to.
        await createVersion({
          projectId,
          html,
          label: `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        // Debit credits — metered from the real input + output volume.
        await debitCredits(
          userId,
          estimateCredits(
            SYSTEM_PROMPT.length + brief.length,
            accumulatedReasoning.length + html.length,
          ),
        );

        emit("project_saved", { projectId, title });
        closeStream();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[generate] stream failed", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = m?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

function stripMarkdownFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  return out.trim();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
