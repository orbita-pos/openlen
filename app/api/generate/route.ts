import { auth } from "@/auth";
import { createProject } from "@/lib/projects";
import { createVersion } from "@/lib/projects/versions";
import { getCreditState } from "@/lib/credits";
import { DESIGN_GUIDANCE, DESIGN_REFERENCE } from "@/lib/design-guidance";
import { detectSlotPath } from "@/lib/html-engine";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { generateHtmlStream } from "@/lib/ai-stream/generate";
import { selectReferenceTemplate } from "@/lib/templates/select-reference";
import { fetchImageAsInlineData } from "@/lib/ai/inline-image";
import { critiqueGeneratedPage } from "@/lib/ai/vision-critique";
import { recordCriticRun, recordRegenOutcome } from "@/lib/ai/quality-metrics";
import type { InlineImage, Message } from "@/lib/ai-gateway";
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

// CSS recipes, micro-snippets, and brand catalogs ship as a separate
// user-tagged reference block. Gemini 3.x treats long system prompts as
// constraints — pushing taste material into a `<reference>`-tagged user
// turn keeps the model from over-anchoring on phrasing.
const REFERENCE_MESSAGE = `<reference>
The following library is the design taste catalog. Use it as material to draw from when filling in the variant brief — match the register, don't quote verbatim.

${DESIGN_REFERENCE}
</reference>`;

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
  const aiModel: AIModel = modelParam === "gemini-pro" ? "gemini-pro" : "gemini-flash";

  // Quality S2 — pick a curated template screenshot as a multimodal quality
  // reference and attach it (base64 inlineData) to the brief turn, which is
  // the last user message the gateway anchors images on. Best-effort: a
  // selector miss or fetch failure falls back cleanly to text-only.
  let referenceImages: InlineImage[] | undefined;
  let briefBlock = `BRIEF:\n${brief}`;
  try {
    const ref = await selectReferenceTemplate(brief);
    if (ref) {
      const img = await fetchImageAsInlineData(ref.screenshotUrl);
      if (img) {
        referenceImages = [img];
        briefBlock = `<reference family="${ref.family}" id="${ref.id}">
The attached image is a high-quality landing page from our curated set. Match its visual quality, density, spacing discipline, and aesthetic polish. Adapt the layout to fit the brief — do NOT copy sections verbatim.
</reference>

BRIEF:
${brief}`;
        // eslint-disable-next-line no-console
        console.log(`[generate] reference template: ${ref.id} (family=${ref.family})`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[generate] reference ${ref.id} chosen but image fetch failed — text-only`);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[generate] no reference template matched — text-only`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[generate] reference selection failed — text-only", err);
  }

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: REFERENCE_MESSAGE },
    { role: "user" as const, content: briefBlock },
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

        // One generation pass: stream HTML chunks to the client, await the
        // canonical post-process HTML, then validate it. Returns the validated
        // document or a user-facing error message. Used for both the initial
        // pass and the (optional) critic-driven regen — the regen re-streams
        // so the live preview shows the better version coming together.
        const runPass = async (
          genMessages: Message[],
          label: string,
        ): Promise<{ ok: true; html: string } | { ok: false; message: string }> => {
          const { stream, done } = generateHtmlStream({
            apiKey: PROVIDER.key as string,
            messages: genMessages,
            images: referenceImages,
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
              console.error(`[generate] reader error (${label})`, readErr);
              break;
            }
            if (chunk.done) break;
            const text = decoder.decode(chunk.value, { stream: true });
            if (text.length > 0) {
              if (!loggedFirst) {
                loggedFirst = true;
                // eslint-disable-next-line no-console
                console.log(`[generate] streaming started (${label})`);
              }
              totalHtmlChars += text.length;
              emit("html_chunk", { text });
            }
          }

          const summary = await done;

          if (summary.stopKind === "error" || !summary.finalHtml) {
            return {
              ok: false,
              message: summary.error?.message ?? "Generation failed — try again.",
            };
          }

          // Gemini occasionally wraps the output in ```html...``` fences
          // despite the system prompt forbidding it. Strip a possible fence
          // pair before validating — same safety net the Kimi-era route had.
          const passHtml = stripMarkdownFences(summary.finalHtml);

          if (passHtml.length < 1000 || !/^<!doctype/i.test(passHtml)) {
            return {
              ok: false,
              message:
                "The model didn't return a complete HTML document. Try again.",
            };
          }
          if (!/<\/html>\s*$/i.test(passHtml)) {
            return {
              ok: false,
              message:
                summary.stopKind === "max_tokens"
                  ? "The page hit the model's output cap before finishing. Try a shorter, more focused brief."
                  : "The page ended without a closing </html>. Try again.",
            };
          }
          if (detectSlotPath(passHtml)) {
            return {
              ok: false,
              message: "The model emitted editor-mode markers — try again.",
            };
          }

          // eslint-disable-next-line no-console
          console.log(
            `[generate] tokens (${label}) — prompt: ${summary.usage?.inputTokens ?? "?"}, output: ${summary.usage?.outputTokens ?? "?"} → ${summary.creditsDebited} credits`,
          );
          return { ok: true, html: passHtml };
        };

        // ── Initial pass ────────────────────────────────────────────────────
        const first = await runPass(messages, "initial");
        if (!first.ok) {
          emit("error", { message: first.message });
          closeStream();
          return;
        }
        let html = first.html;
        let regenerated = false;

        // ── Vision critic loop (Quality S3) ─────────────────────────────────
        // Render the page, show Gemini Flash the screenshot, and regenerate
        // with surgical feedback if the verdict says the page is visually
        // broken. The win is variance reduction — catching the ~5% of broken
        // pages before they reach the user — not raising the average.
        //
        // Kill switch: OPENLEN_VISION_CRITIC=0 falls back to S2 one-shot
        // behavior (no critic call). Default ON. Capped at exactly ONE regen —
        // a flawed page beats a third try the user has to wait on. Born-
        // canonical normalization already ran inside each runPass (HtmlStream
        // .end()), so the chosen final — first pass or regen — is canonical;
        // nothing re-normalizes between critique and regen.
        if (process.env.OPENLEN_VISION_CRITIC !== "0") {
          emit("critic-checking", {});
          const verdict = await critiqueGeneratedPage({
            brief,
            html,
            model: "gemini-3.5-flash",
            apiKey: PROVIDER.key as string,
          });
          recordCriticRun({
            shouldRegenerate: verdict.shouldRegenerate,
            fallback: verdict.fallback,
          });
          // eslint-disable-next-line no-console
          console.log(
            `[critic] regen=${verdict.shouldRegenerate ? "triggered" : "skipped"}`,
          );

          if (verdict.shouldRegenerate) {
            // Reason goes to the client only to drive a neutral "improving the
            // design…" state — never the raw critic text (bad UX to tell a
            // user their page looked bad).
            emit("regen-starting", { reason: verdict.issues.join("; ") });
            const regenBriefBlock = `<critic-feedback>\n${verdict.regenerationFeedback}\n\nIssues found in the previous attempt: ${verdict.issues.join(", ")}\n</critic-feedback>\n\n${briefBlock}`;
            const regenMessages: Message[] = [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: REFERENCE_MESSAGE },
              { role: "user", content: regenBriefBlock },
            ];
            const regen = await runPass(regenMessages, "regen");
            if (regen.ok) {
              html = regen.html;
              regenerated = true;
              recordRegenOutcome(true);
            } else {
              // Regen produced invalid HTML — ship the (already-valid) first
              // pass rather than error or wait for a third try.
              // eslint-disable-next-line no-console
              console.warn(
                `[generate] regen failed validation (${regen.message}) — shipping first pass`,
              );
              recordRegenOutcome(false);
            }
          }
        }

        // ── Save the chosen final document ──────────────────────────────────
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
          label: regenerated ? `Generated (regen): ${title}` : `Generated: ${title}`,
          source: "initial",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[generate] initial version snapshot failed", err);
        });

        emit("project_saved", { projectId, title, regenerated });
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
