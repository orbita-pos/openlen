import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { createVersion } from "@/lib/projects/versions";
import {
  getCreditState,
  debitCredits,
  estimateCredits,
  creditsForUsage,
} from "@/lib/credits";
import { DESIGN_GUIDANCE } from "@/lib/design-guidance";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { detectSlotPath } from "@/lib/html-engine";
import { GeminiProvider, type Message } from "@/lib/ai-gateway";
import {
  applyOps,
  buildScopedView,
  parseOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
  type ScopedView,
} from "@/lib/html-ops";
import { normalizeBornCanonical } from "@/lib/normalize";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/templates/ai-design — conversational AI page redesign.
//
// Body: { projectId, currentHtml, prompt, history?, model?, scope?, attachedImage? }
//
// Streams Server-Sent Events as Gemini reasons + rewrites the page:
//   - reasoning_chunk { text }   — append-only, the model's design notes
//   - html_chunk      { text }   — append-only, after the ---HTML--- marker
//   - done            { reasoning, html, updatedAt, mode, appliedOpCount }
//   - error           { message }
//
// The system prompt instructs the model to first write 1-3 sentences of
// design reasoning, then a literal `---HTML---` marker on its own line,
// then either an <edits> ops block (Mode A) or a full HTML document
// (Mode B). We split on the marker as bytes arrive so the client can
// update reasoning text and iframe srcDoc independently.
//
// Provider: Gemini via @openlen/ai-gateway (F3 cutover, 2026-05-27).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const ENCODER = new TextEncoder();
const MARKER = "---HTML---";
// Hard upper bound on a single Gemini chat-edit turn. Real edits can take
// ~3 min on dense pages; this only catches a wedged stream, not a slow one.
const STREAM_TIMEOUT_MS = 360_000;

const SYSTEM_PROMPT = `You are a senior product designer with the eye of Linear, Vercel, Stripe, and Resend. You design polished, opinionated landing pages — modern typography, generous whitespace, subtle motion, hairline borders, real copy that says specific things about real fictional products.

You are editing a single landing page HTML document for a user. They speak conversationally. Read their request, understand the intent, and rewrite the page to match. You have FULL CREATIVE FREEDOM — change one detail, rewrite one section, or rebuild the entire page if the request demands it. Be ambitious; the user trusts your taste.

${DESIGN_GUIDANCE}

OUTPUT EFFICIENCY (critical — long documents truncate against the response cap):
- No HTML comments (<!-- ... -->) anywhere in the output. They burn tokens, they don't render.
- No multi-line whitespace inside elements. Single-line each element when reasonable.
- Reuse Tailwind classes — don't paste the same long class string into 10 sibling cards. If a card pattern repeats, give it a single class in <style> and apply.
- Inline <style> blocks: collapse redundant rules. No "/* Pricing card */"-style section dividers.
- Inline <svg>: only emit what's needed. Skip xmlns when duplicated across many siblings.
- Skip blank lines between sections of the document. Compact.
- Goal: same visual quality, fewer tokens.

NON-NEGOTIABLE CONSTRAINTS:
- Output a COMPLETE, self-contained HTML document: starts with <!doctype html>, ends with </html>.
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via <link> in <head>. Allowed families: Inter, Geist, Fraunces, Source Serif 4, Crimson Pro, JetBrains Mono.
- All custom CSS inline in a <style> block in <head>. Use CSS custom properties on :root for design tokens (--accent, --accent-r as RGB triplet, --bg, --surface, --fg, --border, --font-display, --font-body, --radius). Reference via var() throughout — DO NOT hardcode the same color in 47 places, use the var. Also emit a \`:root.dark { … }\` block with hand-designed dark-theme values for --bg, --surface, --fg, --border and --accent; every text color MUST be a var() token so the page flips cleanly.
- NO React, NO Babel, NO JSX, NO <script type="text/babel">, NO window.X globals, NO import statements anywhere.
- NO data-slot-path= attribute anywhere — that's an editor-mode marker, reserved.
- NO login / signup / "my account" / dashboard UI. Public marketing pages only.
- Images: when a "USER ATTACHED IMAGE" block appears in the user message, that URL is REAL — use it verbatim as an <img src> (or CSS background-image), and never placeholder a user-attached image. With no attached image, do NOT invent image URLs — use a simple <div> with bg-gradient-to-br as a placeholder. NEVER embed an image as a data: URI, and NEVER hand-build a detailed SVG mockup posing as an image (it is slow, expensive, and not what the user wants) — a placeholder is only a plain gradient <div>. Inline SVG is for icons and small decorative marks only.
- Mobile-responsive at 360px minimum width.

CONVERSATIONAL TONE for your reasoning text:
Speak like a senior designer reviewing the change with a peer. 1-3 sentences. Reference the design intent ("Switched to Fraunces serif because your hero reads editorial — Linear-cold sans was fighting it"), not literal token values ("changed accent to #C8A06A"). When you reshape structure, name what you did ("Folded pricing from 3 tiers to 2 to feel curated").

═══════════════════════════════════════════════════════════════════════════
OUTPUT MODES — you have TWO and you MUST choose ONE per turn.
═══════════════════════════════════════════════════════════════════════════

MODE A — OPERATIONS (PREFERRED for ≤ 8 disparate changes):

The CURRENT DOCUMENT (sent below in the user message) has \`data-op-id="..."\` attributes injected on every element. Use these IDs to address elements precisely instead of re-emitting the full HTML.

Output format for Mode A:
First, write 1-3 sentences of reasoning. Plain prose.

Then a blank line.

Then the literal marker on its own line: ${MARKER}

Then a newline, then an <edits>...</edits> block with up to 8 <edit> children.

Each <edit> has:
- op="replace" | "insert_before" | "insert_after" | "delete"
- target="<the data-op-id value of the element you're modifying>"
- For non-delete: a <new>...</new> child containing the new outerHTML (DO NOT include data-op-id attrs in your output — those are server-injected).

RULES for Mode A:
- Always address by data-op-id, never by full outerHTML or selectors.
- Maximum 8 operations per turn. If the request would need more, prefer MODE B.
- Operations are applied in emission order — later ops see the DOM after earlier ones.
- DO NOT wrap the <edits> block in markdown code fences.

EXAMPLE Mode A response:
Tightened the headline and added a CTA below it.

${MARKER}
<edits>
  <edit op="replace" target="a4">
    <new><h1 class="text-6xl tracking-tight">Catch agents breaking rules.</h1></new>
  </edit>
  <edit op="insert_after" target="b1">
    <new><a class="cta-button" href="#book">Read the book →</a></new>
  </edit>
  <edit op="delete" target="c7"/>
</edits>

───────────────────────────────────────────────────────────────────────────

MODE B — FULL REWRITE (only when changes are TONAL or touch most of the page):

Use Mode B for "make it brutalist", "rebuild as editorial", "switch to dark cinematic" — when the entire visual language changes. Also use Mode B if you'd need > 8 ops.

Output format for Mode B:
First, write reasoning. Then a blank line.

Then the marker: ${MARKER}

Then the complete new HTML page starting with <!doctype html> and ending with </html>. Do NOT include data-op-id attrs (they're server-injected, strip them in your output).

EXAMPLE Mode B response:
Rebuilt as a brutalist masthead — heavy serif headlines, raw gradients, no rounded corners.

${MARKER}
<!doctype html>
<html lang="en">
...

═══════════════════════════════════════════════════════════════════════════
PICK MODE A unless the request truly touches most of the page. The data-op-id system exists so you don't burn output tokens re-emitting parts that don't change.
═══════════════════════════════════════════════════════════════════════════
`;

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

interface ScopeBody {
  outerHtml?: string;
  hint?: string;
  /** CSS-selector breadcrumb from the iframe's section-select script.
   *  When set and it resolves to an element in the tagged document, the
   *  request becomes a hard-pin (Gemini must anchor on that op-id) instead
   *  of a soft text-hint. */
  path?: string;
}

interface AttachedImageBody {
  url?: string;
  alt?: string;
}

// Dual-mode user message — the model picks Mode A (ops, address by
// data-op-id) or Mode B (full rewrite) based on the request size.
//
// Focus can be a HARD PIN (resolved op-id from the CSS-selector path) or
// a SOFT HINT (textual fallback when the path failed to resolve, or no
// path was sent). Pin language is strict; hint language is permissive.
//
// When a scopedView is provided (pin resolved AND we successfully sliced
// the enclosing semantic container), the message ships ONLY that slice
// plus a compact outline of the doc's other top-level sections. Full
// taggedHtml is omitted — a long editorial template easily blows past the
// model's context if shipped in full every turn, even when the user only
// wants to touch one section.
function buildUserMessage(args: {
  briefBlock: string;
  taggedHtml: string;
  scopedView: ScopedView | null;
  prompt: string;
  scopePin: { opId: string; hint: string } | null;
  scopeHint: string | null;
  attachedImage: { url: string; alt?: string } | null;
}): string {
  let focusBlock = "";
  if (args.scopePin && args.scopedView) {
    focusBlock = `USER FOCUS PIN: target="${args.scopePin.opId}" — the user clicked this EXACT element (${args.scopePin.hint}). Anchor your primary edit on this op-id. Only widen to siblings/ancestors when the user's request explicitly implies it.\n\n`;
  } else if (args.scopePin) {
    focusBlock = `USER FOCUS PIN: target="${args.scopePin.opId}" — the user clicked this EXACT element (${args.scopePin.hint}). In Mode A you MUST anchor your primary edit on this op-id. Only widen to siblings/ancestors when the user's request explicitly implies it (e.g. "make this section and the next one match"). In Mode B (full rewrite), treat the pin as a strong hint about where the user's attention is, but you may restructure freely.\n\n`;
  } else if (args.scopeHint) {
    focusBlock = `USER FOCUS HINT: the user gestured at this element → ${args.scopeHint}. Center your changes here if relevant. You can still touch siblings or related elements when the request implies it.\n\n`;
  }
  let imageBlock = "";
  if (args.attachedImage) {
    const altLine = args.attachedImage.alt
      ? `\nAlt text: ${args.attachedImage.alt}`
      : "";
    imageBlock = `USER ATTACHED IMAGE: ${args.attachedImage.url}${altLine}
This is a REAL image URL the user explicitly provided — use it VERBATIM as the src of an <img> tag (or as a CSS background-image). This OVERRIDES the "no external image URLs" constraint: that rule only forbids INVENTING urls; this one is real. Do NOT create a placeholder <div>, and do NOT tell the user to "replace the div later" — insert the actual <img> with this exact src now. If the page already has a placeholder for this image (a gradient <div>, an empty bordered box), REPLACE that whole element with the <img> — do NOT nest the <img> inside it, or the placeholder's padding / background will frame the image. The image fills its slot edge-to-edge unless a frame is clearly part of the design.
If the request specifies a position ("right", "background", "above", "as the hero"), honor it precisely. Otherwise, place it where it makes the most sense — typically an <img> with object-cover at the slot's aspect ratio, or a CSS background-image when the user implies a backdrop. Always include alt text (use the user's alt if provided; otherwise infer from the image + surrounding copy). When inserting into a previously text-only section, restructure the layout (2-column, hero with bg, etc.) so the image feels intentional rather than tacked on.

`;
  }

  let documentBlock: string;
  if (args.scopedView) {
    documentBlock = `SCOPED VIEW — only the user-pinned section is shown below. The FULL document exists server-side and ops you emit are applied against it, so op-ids from the OUTLINE are also addressable (insert_before / insert_after / delete other sections, etc.).

FORCE MODE A (ops): emit an <edits>...</edits> block ONLY. Do NOT emit a full <!doctype> rewrite — there's no full doc in this view to rewrite from. Op cap for scoped requests: 16.

SCOPED SECTION (container op-id="${args.scopedView.containerOpId}"):

${args.scopedView.scopedHtml}

DOCUMENT OUTLINE (all top-level sections of the page, in source order):
${args.scopedView.outline}`;
  } else {
    documentBlock = `CURRENT DOCUMENT (every element has a server-injected \`data-op-id\` attribute — use those values in Mode A's <edit target="..."> calls):

${args.taggedHtml}`;
  }

  return `${args.briefBlock}${focusBlock}${imageBlock}${documentBlock}

USER REQUEST:
${args.prompt}`;
}

function stripMarkdownFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  return out.trim();
}

interface AiDesignBody {
  projectId?: string;
  currentHtml?: string;
  prompt?: string;
  history?: HistoryTurn[];
  /** "gemini-pro" (default) or "gemini-flash" — the model the Chat panel picked. */
  model?: string;
  /** When set, the user has scoped this turn to a single element of the
   *  current HTML. The model is instructed to modify ONLY that element. */
  scope?: ScopeBody;
  /** When set, the user has attached an image to insert. The model receives
   *  the URL + alt and is instructed to place it per the user's prompt
   *  (right side, background, hero, etc.) or by inference if unspecified. */
  attachedImage?: AttachedImageBody;
}

const SCOPE_OUTER_MAX = 50_000;
const ATTACHED_URL_MAX = 2_000;
const ATTACHED_ALT_MAX = 300;

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return errorJson(401, "unauthorized");

  const body = (await req.json().catch(() => null)) as AiDesignBody | null;
  if (!body) return errorJson(400, "invalid_body");

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return errorJson(400, "projectId is required");

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length === 0 || prompt.length > 2000) {
    return errorJson(400, "prompt must be 1–2000 chars");
  }

  const currentHtml = typeof body.currentHtml === "string" ? body.currentHtml : "";
  if (!/<html[\s>]/i.test(currentHtml) || !/<\/html>/i.test(currentHtml)) {
    return errorJson(400, "currentHtml must be a full HTML document");
  }

  const history: HistoryTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (h): h is HistoryTurn =>
            h !== null &&
            typeof h === "object" &&
            (h.role === "user" || h.role === "assistant") &&
            typeof h.content === "string" &&
            h.content.length > 0,
        )
        .slice(-6)
    : [];

  // Validate the scope payload (optional). The hint is a textual fallback;
  // the path (when provided) is what unlocks hard-pinning to a specific
  // data-op-id after tagging. We capture both here and decide which one to
  // use in the prompt after the document has been tagged.
  let scopeHint: string | null = null;
  let scopePath: string | null = null;
  if (body.scope && typeof body.scope === "object") {
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

  // Validate the attached image (optional). Must be a valid http(s) URL.
  // Invalid attachments are silently dropped — better to ignore than 400
  // (the prompt itself still has value).
  let attachedImage: { url: string; alt?: string } | null = null;
  if (body.attachedImage && typeof body.attachedImage === "object") {
    const url =
      typeof body.attachedImage.url === "string"
        ? body.attachedImage.url.trim()
        : "";
    if (url.length > 0 && url.length <= ATTACHED_URL_MAX) {
      try {
        // Resolve against the request origin so a root-relative URL (e.g.
        // /openlen-images/x.webp from the curated gallery) becomes a usable
        // absolute URL instead of being dropped.
        const parsed = new URL(url, req.url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const alt =
            typeof body.attachedImage.alt === "string"
              ? body.attachedImage.alt.trim().slice(0, ATTACHED_ALT_MAX)
              : "";
          attachedImage = alt
            ? { url: parsed.href, alt }
            : { url: parsed.href };
        }
      } catch {
        /* leave attachedImage null */
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    "[ai-design] attachedImage — client sent:",
    body.attachedImage?.url ?? "(none)",
    "| accepted:",
    attachedImage?.url ?? "(none)",
  );

  const userId = session.user.id;

  const rows = await db
    .select({
      data: schema.projects.data,
      userBrief: schema.projects.userBrief,
    })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) return errorJson(404, "project not found");

  const aiModel: AIModel = body.model === "gemini-flash" ? "gemini-flash" : "gemini-pro";
  const PROVIDER = resolveAIProvider(aiModel);
  if (!PROVIDER.key) {
    return errorJson(500, `${PROVIDER.label} API key missing`);
  }

  // Project Brief — persistent user-controlled context from the Brief sidebar
  // tab. Prepended to the turn's user message so the model sees it as part of
  // the current request, not buried in a previous turn. Trimmed at the source
  // by setProjectUserBrief (4000-char cap) so we don't have to worry here.
  const userBrief = (existing.userBrief ?? "").trim();
  const briefBlock = userBrief
    ? `PROJECT BRIEF (persistent — applies to every request):\n${userBrief}\n\n`
    : "";

  // Tag every element of the current document with a short `data-op-id`
  // attribute. The model addresses elements by these IDs in Mode A (ops);
  // we strip them before persisting. Output savings: 5-50x vs emitting
  // full outerHTML as anchors.
  const { taggedHtml, taggedCount } = tagWithOpIds(currentHtml);
  if (taggedCount === 0) {
    return errorJson(400, "currentHtml has no taggable elements");
  }

  // Hard-pin: if the client sent a path AND it resolves to an element in
  // the tagged document, the model gets a precise data-op-id target. On
  // any failure (missing path, malformed selector, element not found), we
  // degrade silently to the textual hint — the request still works, just
  // with the old soft-hint behavior.
  let scopePin: { opId: string; hint: string } | null = null;
  if (scopePath && scopeHint) {
    const opId = resolveOpIdByPath(taggedHtml, scopePath);
    if (opId) scopePin = { opId, hint: scopeHint };
  }

  // When the pin resolved, slice the doc to just the pin's enclosing
  // semantic container + an outline of the rest. This is the fix for
  // 400-too-large errors on long editorial templates: a 200KB doc would
  // blow the context, but the same request scoped to one section ships
  // in <5KB. We still tag the full doc (above) and apply ops against it,
  // so the model can still reference outline op-ids for cross-section
  // edits.
  let scopedView: ScopedView | null = null;
  if (scopePin) {
    scopedView = buildScopedView(taggedHtml, scopePin.opId);
  }

  const userMessageContent = buildUserMessage({
    briefBlock,
    taggedHtml,
    scopedView,
    prompt,
    scopePin,
    scopeHint,
    attachedImage,
  });

  // Pre-flight size guard. Gemini 2.5 Pro has a 1M-token context but a
  // single chat-edit turn against a 200KB tagged doc is wasteful. Be
  // conservative: ~3.5 chars per token on tag-dense HTML, cap at 240K
  // tokens (the previous Kimi cap; keeps responses snappy and within
  // Gemini's per-call billing sweet spot). When we exceed, surface a
  // UI-actionable error pointing at Select.
  const SYSTEM_TOKEN_BUDGET = 4_000;
  const MAX_PROMPT_TOKENS = 240_000;
  const estimatedTokens =
    Math.ceil(userMessageContent.length / 3.5) + SYSTEM_TOKEN_BUDGET;
  if (estimatedTokens > MAX_PROMPT_TOKENS) {
    const suggestion = scopedView
      ? "even scoped to this section it's still too large — try clicking 🎯 Select on a smaller child element"
      : "use the 🎯 Select tool above the chat to scope your request to one section";
    return errorJson(
      413,
      `Page is too large for one turn (≈${Math.round(
        estimatedTokens / 1000,
      )}K tokens, cap ${MAX_PROMPT_TOKENS / 1000}K). ${suggestion}.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[ai-design] prompt size: ${userMessageContent.length} chars, ~${Math.round(
      estimatedTokens / 1000,
    )}K tokens${scopedView ? " (scoped)" : ""}${attachedImage ? " +image" : ""}`,
  );

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    {
      role: "user",
      content: userMessageContent,
    },
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
      const closeStream = () => {
        if (closed) return;
        closed = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
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
      // bytes that we know cannot be part of a future marker boundary.
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
            const after = buffer.slice(idx + MARKER.length).replace(/^\r?\n/, "");
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

      // Hard ceiling — abort a genuinely stalled upstream. Set well above
      // a normal slow run (a real chat edit can take ~3 min) so it only
      // catches true hangs.
      let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        upstreamAbort.abort();
      }, STREAM_TIMEOUT_MS);

      try {
        // Credit gate — chat edits debit credits, metered + charged after
        // the edit is applied + saved (see below).
        const { balance } = await getCreditState(userId);
        if (balance < 1) {
          emit("error", {
            message:
              "Te quedaste sin créditos este mes. Esperá al reset mensual o pasá a Pro.",
          });
          closeStream();
          return;
        }

        const provider = new GeminiProvider(PROVIDER.key as string);
        const events = provider.stream(
          {
            model: PROVIDER.model,
            messages,
            // Structural rebuilds on dense editorial templates regularly
            // exceed 32K. 64K is well within Gemini 2.5 Pro's per-response
            // cap and keeps the truncation edge case rare without making
            // every easy request slow. Paired with the OUTPUT EFFICIENCY
            // block in the system prompt that discourages bloat.
            maxOutputTokens: 65_536,
            temperature: 0.8,
          },
          { signal: upstreamAbort.signal },
        );

        let finishReason:
          | "end_turn"
          | "max_tokens"
          | "cancelled"
          | "error"
          | null = null;
        let usage: { inputTokens: number; outputTokens: number } | null = null;
        let providerError: string | null = null;

        try {
          for await (const event of events) {
            if (event.type === "text_delta") {
              handleDelta(event.text);
            } else if (event.type === "usage") {
              usage = {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              };
            } else if (event.type === "done") {
              finishReason = event.stopReason.kind;
              if (event.stopReason.kind === "error") {
                providerError = event.stopReason.error;
              }
              break;
            }
          }
        } catch (loopErr) {
          const msg =
            loopErr instanceof Error ? loopErr.message : String(loopErr);
          emit("error", {
            message: upstreamAbort.signal.aborted
              ? "The model took too long (over 6 minutes) and was stopped. Try a smaller / more scoped change (🎯 Select), or try again."
              : `${PROVIDER.label} stream failed: ${msg}`,
          });
          closeStream();
          return;
        }

        if (providerError) {
          emit("error", {
            message: `${PROVIDER.label}: ${providerError}`,
          });
          closeStream();
          return;
        }

        if (mode === "reasoning") {
          // We never crossed the ---HTML--- marker. Either the model forgot
          // to emit it, or the response was so short / chatty it didn't get
          // there. Distinct from truncation mid-HTML.
          flushReasoning(true);
          emit("error", {
            message:
              "Model only returned reasoning — it didn't emit the HTML block. Try again.",
          });
          closeStream();
          return;
        }

        if (buffer.length > 0) {
          accumulatedHtml += buffer;
          emit("html_chunk", { text: buffer });
          buffer = "";
        }

        // Sniff the output mode by looking at the first non-whitespace
        // chars after the marker. Mode A (ops) starts with <edits>; Mode B
        // (full rewrite) starts with <!doctype>.
        const raw = stripMarkdownFences(accumulatedHtml);
        const isOpsMode = /^\s*<edits[\s>]/i.test(raw);

        let trimmedHtml: string;
        let appliedOpCount = 0;
        let outputMode: "ops" | "rewrite";

        if (isOpsMode) {
          outputMode = "ops";
          const { ops, errors: parseErrors } = parseOps(raw);
          if (parseErrors.length > 0 && ops.length === 0) {
            emit("error", {
              message: `Couldn't parse ops: ${parseErrors[0]}`,
            });
            closeStream();
            return;
          }
          if (ops.length === 0) {
            emit("error", {
              message:
                "Empty <edits> block — the model didn't emit any operations. Try again.",
            });
            closeStream();
            return;
          }
          // Scoped requests get a higher cap — they're naturally focused, so
          // 16 granular ops on one section is more useful than forcing the
          // user to chain multiple chats.
          const opsCap = scopedView ? 16 : 8;
          if (ops.length > opsCap) {
            emit("error", {
              message: `Model emitted ${ops.length} ops but the cap is ${opsCap}. Break the request into multiple smaller chats.`,
            });
            closeStream();
            return;
          }
          const applyResult = applyOps(taggedHtml, ops);
          if (applyResult.html === null) {
            const firstErr = applyResult.errors[0];
            const msg = firstErr
              ? `Op ${firstErr.opIndex + 1} (${firstErr.op}) failed: ${firstErr.reason}`
              : "Couldn't apply ops — try again.";
            emit("error", { message: msg });
            closeStream();
            return;
          }
          trimmedHtml = applyResult.html;
          appliedOpCount = applyResult.appliedCount;
          if (detectSlotPath(trimmedHtml)) {
            emit("error", {
              message:
                "Ops produced HTML with editor-mode markers — try again.",
            });
            closeStream();
            return;
          }
        } else {
          // Mode B — full rewrite. Defensive: strip any data-op-id the
          // model might have re-emitted into the output even though the
          // prompt told it not to.
          outputMode = "rewrite";
          // Scoped requests must NEVER produce a Mode B response — the
          // model only saw a slice of the doc, so a "full rewrite" from
          // that context would replace the entire page with what's
          // actually just one section. The prompt forbids it; if we get
          // one anyway, bail rather than truncate the user's page.
          if (scopedView) {
            emit("error", {
              message:
                "Model emitted a full rewrite from a scoped view — that would replace the whole page with just one section. Try again, or clear the 🎯 Select to allow a full rewrite.",
            });
            closeStream();
            return;
          }
          trimmedHtml = stripOpIds(raw);
          if (trimmedHtml.length < 1000) {
            emit("error", {
              message:
                "HTML came back too short to be a real page — the model probably truncated. Try a smaller change or chat again.",
            });
            closeStream();
            return;
          }
          if (!/^<!doctype/i.test(trimmedHtml)) {
            emit("error", {
              message:
                "Model started the HTML mid-document (no <!doctype>) — try again.",
            });
            closeStream();
            return;
          }
          if (!/<\/html>\s*$/i.test(trimmedHtml)) {
            const wasLengthCap = finishReason === "max_tokens";
            const message = wasLengthCap
              ? "Response hit the per-turn output cap before closing </html>. The model should have picked Mode A (ops) for this — try again, or click 🎯 Select to focus the next attempt."
              : "Response ended without closing </html>. Try again.";
            emit("error", { message });
            closeStream();
            return;
          }
          if (detectSlotPath(trimmedHtml)) {
            emit("error", {
              message: "Model emitted editor-mode markers — try again.",
            });
            closeStream();
            return;
          }
        }

        // Born-canonical: a Mode B rewrite — or ops that hit the token
        // blocks — can drop the data-ol-* contract. Re-run the chain so
        // the page stays themeable. Idempotent: a no-op when the markers
        // survived.
        trimmedHtml = normalizeBornCanonical(trimmedHtml);

        const reasoning = accumulatedReasoning.trim();
        const now = new Date();

        try {
          const nextData: ProjectData = { html: trimmedHtml };
          await db
            .update(schema.projects)
            .set({ data: nextData, updatedAt: now })
            .where(
              and(
                eq(schema.projects.id, projectId),
                eq(schema.projects.userId, userId),
              ),
            );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[ai-design] db update failed", err);
          emit("error", {
            message: "Generated successfully but failed to save — try again.",
          });
          closeStream();
          return;
        }

        // Snapshot the post-chat state into the version timeline so the
        // user can restore later. Failures here don't break the stream —
        // we still apply the HTML and emit done. The label tags the mode
        // + op count explicitly so the timeline reads cleanly.
        const versionLabel =
          outputMode === "ops"
            ? `Ops (${appliedOpCount}): ${prompt.slice(0, 70)}${prompt.length > 70 ? "…" : ""}`
            : `Rewrite: ${prompt.slice(0, 76)}${prompt.length > 76 ? "…" : ""}`;
        await createVersion({
          projectId,
          html: trimmedHtml,
          label: versionLabel,
          source: "chat",
        }).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[ai-design] version snapshot failed", err);
        });

        // Debit credits — billed from the real token usage the provider
        // reports. Falls back to a char estimate only if the usage event
        // never arrived (rare; Gemini emits it on every stream).
        const credits = usage
          ? creditsForUsage(usage.inputTokens, usage.outputTokens, PROVIDER.rate)
          : estimateCredits(
              SYSTEM_PROMPT.length + userMessageContent.length,
              accumulatedReasoning.length + accumulatedHtml.length,
              PROVIDER.rate,
            );
        // eslint-disable-next-line no-console
        console.log(
          `[ai-design] tokens — prompt: ${usage?.inputTokens ?? "?"}, output: ${usage?.outputTokens ?? "?"} → ${credits} credits`,
        );
        await debitCredits(userId, credits);

        emit("done", {
          reasoning,
          html: trimmedHtml,
          updatedAt: now.toISOString(),
          mode: outputMode,
          appliedOpCount,
        });
        closeStream();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[ai-design] stream failed", err);
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
