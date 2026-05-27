import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState } from "@/lib/credits";
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import { detectSlotPath } from "@/lib/html-engine";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { generateHtmlStream } from "@/lib/ai-stream/generate";
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
// Body: { brief: string, model?: "gemini-pro" | "gemini-flash" }
//
// Streams Server-Sent Events as Gemini writes the page:
//   html_chunk    { text }              — sanitized HTML deltas (post-F3 S4)
//   progress      { chars }             — server→client keepalive
//   project_saved { projectId, title }  — terminal success
//   error         { message }
//
// Pipeline (F3 cutover, 2026-05-27):
//   GeminiProvider stream → HtmlStream (sanitize + normalize on end) →
//   SSE wrapper. Credits debit on the upstream `usage` event inside
//   generateHtmlStream; this route only does pre-flight balance gate +
//   post-flight project save. The legacy `reasoning_chunk` + `---HTML---`
//   marker scheme from the Kimi era was dropped — Gemini's
//   instruction-tuning makes raw-HTML output reliable from the first
//   byte.
// ─────────────────────────────────────────────────────────────────────────────

const ENCODER = new TextEncoder();

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
- All custom CSS inline in a <style> block in <head>. Use CSS custom properties on :root for design tokens (--accent, --accent-r as an RGB triplet, --bg, --surface, --fg, --border, --font-display, --font-body, --radius). Reference them via var() throughout — never hardcode the same color in many places. Also emit a \`:root.dark { … }\` block that redefines --bg, --surface, --fg, --border and --accent with hand-designed dark-theme values (a real dark palette — not a mechanical inversion); every text and heading color MUST resolve from a var() token so the whole page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that is a reserved editor-mode marker.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Inline SVG for logos / icons / illustrations. NO external image URLs. For hero / product imagery use a <div> with a tasteful bg-gradient-to-br placeholder.
- Mobile-responsive down to 360px width.

OUTPUT FORMAT — follow exactly:
Emit the complete HTML document directly, starting with <!doctype html> and ending with </html>. No preamble, no design notes, no markdown code fences — the first character of your response is <.`;

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
  // eslint-disable-next-line no-console
  console.log(`[generate] request — ${brief.length} chars`);

  const modelParam =
    body &&
    typeof body === "object" &&
    typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model
      : undefined;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Auth required — anonymous /api/generate would let anyone burn API
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

  const PROVIDER = resolveAIProvider(modelParam);
  if (!PROVIDER.key) {
    return json({ error: `${PROVIDER.label} API key missing` }, 500);
  }
  const aiModel: AIModel = modelParam === "gemini-flash" ? "gemini-flash" : "gemini-pro";
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: `BRIEF:\n${brief}` },
  ];

  const upstreamAbort = new AbortController();

  const sse = new ReadableStream<Uint8Array>({
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
      let keepalive: ReturnType<typeof setInterval> | null = null;
      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (keepalive) {
          clearInterval(keepalive);
          keepalive = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let totalHtmlChars = 0;
      // Server-to-client keepalive — emit a progress event every 5s so
      // the client watchdog stays reset even if Gemini is silent during
      // its initial "thinking" phase. Cleared in closeStream.
      keepalive = setInterval(() => {
        emit("progress", { chars: totalHtmlChars });
      }, 5000);

      try {
        // Credit gate — one credit is enough to start; the real cost is
        // metered + debited inside generateHtmlStream on the `usage` event.
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

        // eslint-disable-next-line no-console
        console.log(
          `[generate] auth + quota + credits ok — calling ${PROVIDER.label}`,
        );

        const { stream, done } = generateHtmlStream({
          apiKey: PROVIDER.key as string,
          messages,
          model: aiModel,
          userId,
          signal: upstreamAbort.signal,
          // Fresh pages have no need for op-ids; they're a chat-tab
          // protocol marker injected at edit time by tagWithOpIds. Saving
          // them with the project bloats every row and re-tagging on every
          // chat turn would still rewrite them, so leave them off.
          htmlOpts: { injectOpIds: false },
          maxOutputTokens: 65_536,
          temperature: 0.8,
        });

        // Pipe per-write HTML chunks to the SSE client as `html_chunk`
        // events. HtmlStream already sanitizes + applies the born-canonical
        // marker pass on end(); the chunks here are the same bytes the
        // final document will contain (sans normalize-time rewrites).
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let loggedFirst = false;
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (readErr) {
            // The stream errored — break out and surface via `done`.
            // eslint-disable-next-line no-console
            console.error("[generate] reader error", readErr);
            break;
          }
          if (chunk.done) break;
          const text = decoder.decode(chunk.value, { stream: true });
          if (text.length > 0) {
            if (!loggedFirst) {
              loggedFirst = true;
              // eslint-disable-next-line no-console
              console.log("[generate] streaming started");
            }
            totalHtmlChars += text.length;
            emit("html_chunk", { text });
          }
        }

        const summary = await done;

        if (summary.stopKind === "error" || !summary.finalHtml) {
          emit("error", {
            message:
              summary.error?.message ?? "Generation failed — try again.",
          });
          closeStream();
          return;
        }

        // Gemini occasionally wraps the output in ```html...``` fences
        // despite the system prompt forbidding it. Strip a possible fence
        // pair before validating — same safety net the Kimi-era route had.
        const html = stripMarkdownFences(summary.finalHtml);

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
              summary.stopKind === "max_tokens"
                ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                : "The page ended without a closing </html>. Try again.",
          });
          closeStream();
          return;
        }
        if (detectSlotPath(html)) {
          emit("error", {
            message: "The model emitted editor-mode markers — try again.",
          });
          closeStream();
          return;
        }

        const title = extractTitle(html) ?? brief.slice(0, 60).trim();

        let projectId: string;
        try {
          projectId = await createProject(userId, {
            html,
            brief,
            title,
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[generate] createProject failed", err);
          emit("error", {
            message: "Generated the page but couldn't save it — try again.",
          });
          closeStream();
          return;
        }

        await createVersion({
          projectId,
          html,
          label: `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        // eslint-disable-next-line no-console
        console.log(
          `[generate] tokens — prompt: ${summary.usage?.inputTokens ?? "?"}, output: ${summary.usage?.outputTokens ?? "?"} → ${summary.creditsDebited} credits`,
        );

        emit("project_saved", { projectId, title });
        closeStream();
      } catch (err) {
        upstreamAbort.abort();
        // eslint-disable-next-line no-console
        console.error("[generate] stream failed", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        closeStream();
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(sse, {
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
