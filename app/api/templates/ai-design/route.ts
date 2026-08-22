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
import { MARKER, SYSTEM_PROMPT } from "./system-prompt";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { extractModelRuntime, modelJsEnabled, modelRuntimePromptBlock } from "@/lib/ai-stream/model-runtime";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { detectSlotPath, sanitizeForPublish } from "@/lib/html-engine";
import { GeminiProvider, type InlineImage, type Message } from "@/lib/ai-gateway";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import {
  applyOps,
  buildScopedView,
  parseOps,
  rejectDocumentWideOps,
  resolveOpIdByPath,
  stripOpIds,
  tagWithOpIds,
  type ScopedView,
} from "@/lib/html-ops";
import { preparePage } from "@/lib/page-engine/prepare";
import { jsonResponse, sseChannel } from "@/lib/ai/sse";
import { extractDocument } from "@/lib/ai/extract-document";
import { writerForTurn } from "@/lib/ai/provider-switch";
import { persistPage } from "@/lib/page-engine/persist";
import { applyModuleIntent } from "@/lib/projects/module-intent";
import { describeBehaviorIssues } from "@/lib/behaviors/validate";
import { LANGUAGE_RULE } from "@/lib/ai/authoring-rules";
import { todayLine } from "@/lib/ai/today-line";

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

// Hard upper bound on a single Gemini chat-edit turn. Real edits can take
// ~3 min on dense pages; this only catches a wedged stream, not a slow one.
const STREAM_TIMEOUT_MS = 360_000;

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


interface AiDesignBody {
  projectId?: string;
  currentHtml?: string;
  page?: string;
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
  // Multi-page: when set, the edit reads/writes data.pages[page].html
  // instead of the home document. Validated against the stored map below
  // (after the project row loads).
  const pageSlugRaw = typeof body.page === "string" ? body.page.trim() : "";
  if (!/<html[\s>]/i.test(currentHtml) || !/<\/html>/i.test(currentHtml)) {
    return errorJson(400, "currentHtml must be a full HTML document");
  }

  // Map to ONLY {role, content} (the TS wrapper now serializes
  // functionCalls/functionResponses off Message objects, so spreading a
  // client history entry whole would be a tool-call injection vector) and cap
  // each content at 4000 chars. Well-formed {role, content} clients are
  // unaffected: same filter, same slice(-6).
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
        .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }))
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
  const pageSlug =
    pageSlugRaw && existing.data?.pages?.[pageSlugRaw] ? pageSlugRaw : null;
  if (pageSlugRaw && !pageSlug) return errorJson(404, "page not found");
  // Defense-in-depth against wrong-page corruption: the client pairs a live
  // `currentHtml` with a `page` slug. Normally they're the SAME page, so
  // currentHtml ≈ the stored page (modulo unsaved edits). A gross mismatch —
  // a different <title> AND a wildly different length — means the client paired
  // one page's HTML with another page's slug; persisting would overwrite the
  // wrong page. Reject that, while staying tolerant of legitimate unsaved edits
  // (same title or similar length passes through).
  if (pageSlug) {
    const storedPageHtml = existing.data?.pages?.[pageSlug]?.html ?? "";
    if (storedPageHtml) {
      const titleOf = (h: string) =>
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1]?.trim().toLowerCase() ?? "";
      const ct = titleOf(currentHtml);
      const st = titleOf(storedPageHtml);
      const lenRatio =
        Math.min(currentHtml.length, storedPageHtml.length) /
        Math.max(currentHtml.length, storedPageHtml.length, 1);
      // Reject a gross mismatch: a different <title> AND a >2x size delta, OR an
      // extreme >5x size delta alone (catches a wrong-page payload even when two
      // pages happen to share a title) — both far outside a legitimate unsaved
      // edit at send time. The client always snapshots currentHtml + page from
      // one render, so this only ever fires on a buggy/crafted request.
      if ((ct && st && ct !== st && lenRatio < 0.5) || lenRatio < 0.2) {
        return errorJson(409, "currentHtml does not match the target page");
      }
    }
  }

  // Default to Flash; only the explicit "gemini-pro" opts into the pricier
  // model. The old default (anything-not-flash → Pro) silently billed 4× on
  // a fresh browser / empty localStorage / undefined model.
  const aiModel: AIModel = body.model === "gemini-pro" ? "gemini-pro" : "gemini-flash";
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
  //
  // SYSTEM_TOKEN_BUDGET accounts for SYSTEM_PROMPT ALONE (DESIGN_GUIDANCE
  // inlined, plus this route's own MODE A/B instructions) — referenceMessage
  // is already counted separately below via its own .length, so it does NOT
  // also belong in this constant. Re-measured at the Arreglo 6 audit:
  // DESIGN_GUIDANCE alone is ~7.7K tokens and the full SYSTEM_PROMPT (with
  // this route's boilerplate on top) is ~9.5K — the old "SYSTEM_PROMPT plus
  // REFERENCE_MESSAGE together ≈ 7K" comment was wrong on both what it
  // covered and the number. Rounded up with headroom for DESIGN_GUIDANCE
  // growth; harmless either way — the real ceiling enforced below is
  // MAX_PROMPT_TOKENS (240K, itself a fraction of Gemini's 1M-token context).
  const SYSTEM_TOKEN_BUDGET = 10_000;
  const MAX_PROMPT_TOKENS = 240_000;
  // Sin catálogo de gusto: aquí viajaban las recetas de CSS, cinco fragmentos
  // de HTML de la plantilla Mirror y los catálogos de marcas, anunciados como
  // "the design taste catalog". El modelo edita la página del usuario, no la
  // nuestra.
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

  // Quality S2 — render the CURRENT page to a full-page image and attach it
  // as VISUAL CONTEXT so the model can see what it's editing (spacing,
  // hierarchy, balance). Reference only — never inserted.
  //
  // OFF by default: it spawns headless Chromium PER chat turn and we have no
  // evidence yet that the image moves the needle for ai-design (most turns
  // mutate the HTML, so a per-turn render rarely earns its cost). Opt in with
  // OPENLEN_AIDESIGN_PAGE_REFERENCE=1 once a use case proves it (e.g.
  // "redesign this page as SaaS"). The /api/generate reference — the
  // paper-backed win — is unconditional. Also skipped when the user attached
  // an image (avoid two-image confusion). Best-effort: a render failure just
  // proceeds text-only.
  let referenceImages: InlineImage[] | undefined;
  let finalUserContent = userMessageContent;
  if (!attachedImage && process.env.OPENLEN_AIDESIGN_PAGE_REFERENCE === "1") {
    const rendered = await renderHtmlToInlineImage(currentHtml);
    if (rendered) {
      referenceImages = [rendered];
      finalUserContent = `${userMessageContent}

VISUAL CONTEXT: the attached image is a full-page render of the CURRENT page (what the user sees right now). Use it only to judge the present visual state — spacing, hierarchy, balance, what's already there — when deciding your edit. It is REFERENCE ONLY: do NOT insert it as an <img>, and do NOT treat it as a "USER ATTACHED IMAGE".`;
      // eslint-disable-next-line no-console
      console.log("[ai-design] attached current-page render as visual context");
    }
  }

  const messages: Message[] = [
    {
      role: "system",
      // El Chat sólo promete JavaScript cuando SABE capturarlo: la captura de
      // abajo es exclusiva del modo reescritura, y con Gemini no corre. Ver
      // lib/ai/js-clause.ts — prometerlo sin captura entrega botones muertos.
      content:
        swapJsClauses(SYSTEM_PROMPT, ["contrato-completo", "no-negociable"], process.env) +
        modelRuntimePromptBlock(process.env),
    },
    ...history,
    {
      // El Chat reescribe el copy de la página igual que la puerta de generar,
      // así que hereda su fallo: sin la fecha, "desde 1998" sale con los años
      // contados desde el entrenamiento del modelo.
      role: "user",
      content: `${todayLine()}${LANGUAGE_RULE}${finalUserContent}`,
    },
  ];

  const upstreamAbort = new AbortController();

  // Sin fijarlo, Flash piensa con presupuesto dinámico: medido sobre una página
  // real de 40KB, 3,251 tokens de pensamiento para producir 208 de edición, y el
  // usuario mirando la nada 20.3s antes del primer byte. Con 1024 son 9.1s y las
  // mismas ops. En 0 NO se apaga y ya: el modelo deja de emitir el marcador
  // `---HTML---` y se pone a conversar, así que el turno entero se pierde.
  // `auto` devuelve el comportamiento de antes.
  // Quién edita la página. DeepSeek por defecto, medido sobre 6 turnos reales
  // con este mismo prompt, este mismo marcador y este mismo protocolo de ops:
  // primer byte de 1.0-2.4s SIEMPRE, contra 3.8-84.7s de Gemini —84.7s para
  // agrandar un botón—, 6 de 6 turnos completados contra 4 de 6 (un 503 por
  // demanda y un turno sin marcador), e igual o más ops aplicadas en todos los
  // casos comparables. `OPENLEN_CHAT_PROVIDER=gemini` devuelve el camino de
  // antes sin tocar código.
  //
  // Un turno CON imágenes de referencia se queda en Gemini pase lo que pase: en
  // la política de Fireworks toda imagen va a Qwen y al razonador nunca se le ha
  // mandado una. Mandarla a ciegas es apostar la edición del usuario.
  //
  // ⚠️ ESO CAMBIÓ el 2026-08-21: la referencia adjunta ya NO cae en Gemini, cae
  // en QWEN — el papel con visión, por el mismo transporte. La cautela de arriba
  // era real (Qwen no se había medido editando páginas) y se acepta a
  // sabiendas: Gemini queda para los píxeles. `OPENLEN_CHAT_PROVIDER=gemini`
  // vuelve atrás por completo.
  const writer = writerForTurn("OPENLEN_CHAT_PROVIDER", (referenceImages?.length ?? 0) > 0);
  /** El razonador. Es además el ÚNICO que puede capturar JavaScript del modelo:
   *  la cápsula se llama "deepseek-generate-v1". */
  const useDeepSeek = writer === "deepseek";
  /** Cualquiera de los dos papeles de Fireworks — razonador o visión. */
  const useFireworks = writer !== "gemini";
  const modelLabel = writer === "deepseek" ? "DeepSeek" : writer === "qwen" ? "Qwen" : PROVIDER.label;
  // El turno se cobra al proveedor que lo corrió. A tarifa de Gemini la salida
  // de DeepSeek se cobraba casi nueve veces de más, y una edición que reescribe
  // una sección cruza el umbral donde eso son 2 créditos en vez de 1 (ver la
  // tabla RATES en lib/credits). La decisión de arriba ya contempla las
  // imágenes, así que aquí no hay mezcla posible.
  const CREDIT_RATE =
    writer === "deepseek" ? "deepseek-flash" : writer === "qwen" ? "qwen-vision" : PROVIDER.rate;

  const raw = process.env.OPENLEN_AIDESIGN_THINKING;
  const THINKING_BUDGET = raw === "auto" ? undefined
    : Number.isInteger(Number(raw)) && Number(raw) > 0 ? Number(raw)
    : 1024;
  const startedAt = Date.now();
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = sseChannel(controller);
      const emit = channel.emit;
      const closeStream = () =>
        channel.close(() => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
        });

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

        const events = useFireworks
          ? createFireworksStreamClient().stream(
              {
                messages: messages.map((message) => ({ role: message.role, content: message.content })),
                // La referencia viaja SÓLO en el turno de visión: mandársela al
                // razonador es exactamente lo que la política prohíbe.
                ...(writer === "qwen" && referenceImages?.length ? { images: referenceImages } : {}),
                maxOutputTokens: 65_536,
                temperature: 0.8,
                requestId: projectId,
                operation: writer === "qwen" ? "page_write_with_reference" : "page_edit",
              },
              { signal: upstreamAbort.signal },
            )
          : new GeminiProvider(PROVIDER.key as string).stream(
          {
            model: PROVIDER.model,
            messages,
            images: referenceImages,
            // Structural rebuilds on dense editorial templates regularly
            // exceed 32K. 64K is well within Gemini 2.5 Pro's per-response
            // cap and keeps the truncation edge case rare without making
            // every easy request slow. Paired with the OUTPUT EFFICIENCY
            // block in the system prompt that discourages bloat.
            maxOutputTokens: 65_536,
            temperature: 0.8,
            thinkingBudget: THINKING_BUDGET,
          },
          { signal: upstreamAbort.signal },
        );

        let finishReason:
          | "end_turn"
          | "max_tokens"
          | "cancelled"
          | "error"
          | null = null;
        let usage: { inputTokens: number; outputTokens: number; thinkingTokens: number } | null = null;
        let providerError: string | null = null;

        try {
          for await (const event of events) {
            if (event.type === "text_delta") {
              handleDelta(event.text);
            } else if (event.type === "reasoning_delta") {
              // DeepSeek manda su pensamiento por un canal propio en vez de
              // mezclarlo con la respuesta, así que no pasa por el separador
              // del marcador: llega ya separado.
              accumulatedReasoning += event.text;
              emit("reasoning_chunk", { text: event.text });
            } else if (event.type === "usage") {
              usage = {
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
                // El pensamiento del modelo se cobra y se espera como salida, y
                // esta ruta no fija presupuesto: sin este número no hay forma de
                // saber si un turno tardó minutos por el documento o por pensar.
                thinkingTokens: event.thinkingTokens,
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
              : `${modelLabel} stream failed: ${msg}`,
          });
          closeStream();
          return;
        }

        if (providerError) {
          emit("error", {
            message: `${modelLabel}: ${providerError}`,
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
        const raw = extractDocument(accumulatedHtml);
        const isOpsMode = /^\s*<edits[\s>]/i.test(raw);

        let trimmedHtml: string;
        let appliedOpCount = 0;
        let droppedNotice = "";
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
          // Una op contra el <body> no es una edición: es un documento nuevo,
          // y eso es el Modo B. Medido, el modelo llegaba ahí queriendo tocar
          // `:root` y se llevaba la página entera dos de cada cinco veces.
          // Las demás ops de la tanda sí se aplican — perder el cambio de
          // acento es mucho menos malo que perder la página del usuario.
          const { ops: safeOps, rejected: rejectedOps } = rejectDocumentWideOps(taggedHtml, ops);
          if (safeOps.length === 0) {
            emit("error", {
              message:
                "El modelo intentó reemplazar la página entera con una sola operación. Pídelo otra vez, o pide un rediseño completo.",
            });
            closeStream();
            return;
          }

          // Scoped requests get a higher cap — they're naturally focused, so
          // 16 granular ops on one section is more useful than forcing the
          // user to chain multiple chats.
          const opsCap = scopedView ? 16 : 8;
          if (safeOps.length > opsCap) {
            emit("error", {
              message: `Model emitted ${safeOps.length} ops but the cap is ${opsCap}. Break the request into multiple smaller chats.`,
            });
            closeStream();
            return;
          }
          if (rejectedOps.length > 0) {
            droppedNotice = rejectedOps.length === 1
              ? "Descarté una operación que habría reemplazado la página entera; el resto del cambio sí se aplicó."
              : `Descarté ${rejectedOps.length} operaciones que habrían reemplazado la página entera; el resto del cambio sí se aplicó.`;
            // eslint-disable-next-line no-console
            console.warn(`[ai-design] ${rejectedOps.length} op(s) contra la raíz descartadas — targets: ${rejectedOps.map((o) => o.target).join(", ")}`);
          }
          const applyResult = applyOps(taggedHtml, safeOps);
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

        // One gate before persistence — sanitize (inline scripts, on*
        // handlers, dangerous URLs, iframes the prompt asked the model not to
        // emit; prompt guidance is not an enforcement boundary), then
        // born-canonical + <head> completion, which a Mode B rewrite or ops
        // that hit the token blocks can otherwise drop.
        //
        // `seal: false` — nothing is served from here, publishToDir seals at
        // publish time. `render: false` — a chat turn cannot pay a
        // twenty-second browser launch; publish verifies instead.
        //
        // behaviors: "block" is the user-visible trade. DESIGN_GUIDANCE
        // animates the model to emit data-ol-* markers, and until now a
        // mis-wired one landed anyway with a note appended to `reasoning` for
        // the model to fix on the NEXT turn — which meant the visitor could
        // meet the dead control first. ai-design edits a page that already
        // exists, so refusing costs the user the edit, not the page.
        // El motor, el mismo que corre al crear (lib/page-engine). Hasta aquí
        // esta ruta sólo llamaba a la puerta: se creaba una página medida y a
        // la primera edición nadie volvía a mirar.
        //
        // Las etapas con navegador SÓLO en la reescritura completa. Medido: la
        // puerta sola tarda 7-17 ms y con render 5.5 s en caliente. Una
        // reescritura es una página nueva y lo vale; dos operaciones
        // quirúrgicas sobre un párrafo, no — y el usuario está mirando.
        const prepared = await preparePage(trimmedHtml, {
          mode: "edit",
          renderChecks: outputMode !== "ops",
          // Sin esto, una conducta rota que ya venía en la página condena TODAS
          // las ediciones futuras y el usuario oye hablar de un control que no
          // tocó. La puerta sólo rechaza lo que este turno rompió.
          priorHtml: currentHtml,
          ...(existing.data?.settings !== undefined ? { settings: existing.data.settings } : {}),
        });
        const gated = prepared.ok
          ? { ok: true as const, html: prepared.html, issues: prepared.report.behaviorIssues, code: "", detail: "" }
          : { ok: false as const, html: "", issues: prepared.report.behaviorIssues, code: prepared.code, detail: prepared.detail ?? "" };
        if (!gated.ok) {
          // The reason has to survive as prose: describeBehaviorIssues writes
          // for the person reading the chat, `gated.detail` is the machine
          // slug. Collapsing them into one string is the mistake this whole
          // migration exists to stop repeating.
          const behaviorList = describeBehaviorIssues([...((gated.issues ?? []) as never[])]);
          emit("error", {
            message: behaviorList
              ? `Conductas mal cableadas — no guardé nada para no dejarte un control muerto en la página: ${behaviorList}. Pídemelo otra vez y lo cableo bien.`
              : gated.code === "reserved_marker"
                ? "Model emitted editor-mode markers — try again."
                : `El HTML no pasó la puerta de publicación (${gated.code}${gated.detail ? `: ${gated.detail}` : ""}) — try again.`,
          });
          closeStream();
          return;
        }
        trimmedHtml = gated.html;

        const reasoning = accumulatedReasoning.trim();
        const now = new Date();
        let enabledModules: string[] = [];

        enabledModules = [...prepared.report.modules];

        // EL SCRIPT DEL MODELO, capturado del texto CRUDO — antes de que el
        // saneado del gate lo borrara. Sólo en REESCRITURA: en modo ops el
        // modelo emite `<edits>`, no un documento, y no hay script que sacar.
        // Sólo con DeepSeek: firmar los bytes de un proveedor creyéndolos de
        // otro es justo la clase de error que un hash no puede detectar.
        const runtimeCapturado = (() => {
          if (!modelJsEnabled(process.env) || !useDeepSeek || outputMode === "ops") return null;
          const r = extractModelRuntime(accumulatedHtml);
          if (!r.ok) {
            if (r.reason !== "ausente") {
              // eslint-disable-next-line no-console
              console.warn(`[ai-design] runtime del modelo descartado: ${r.reason}`);
            }
            return null;
          }
          return r.code;
        })();

        const versionLabel =
          outputMode === "ops"
            ? `Ops (${appliedOpCount}): ${prompt.slice(0, 70)}${prompt.length > 70 ? "…" : ""}`
            : `Rewrite: ${prompt.slice(0, 76)}${prompt.length > 76 ? "…" : ""}`;

        // Guardado + los dos snapshots, en lib/page-engine/persist. Este bloque
        // era una copia del embudo del Agente — su propio comentario lo decía,
        // "cloned from ai-design's own page-branch" — y las dos mitades tenían
        // que no derivar nunca.
        const saved = await persistPage(
          {
            projectId,
            userId,
            page: pageSlug,
            html: trimmedHtml,
            label: versionLabel,
            ...(enabledModules.length ? { settings: prepared.report.moduleSettings as ProjectData["settings"] } : {}),
            // Un rewrite completo redefine el diseño → nuevo baseline del reset.
            // Las ops quirúrgicas son ediciones, no rediseños: no lo mueven.
            isBaseline: outputMode !== "ops",
            // `null` NO borra: una edición por ops re-sella el script que ya
            // había en vez de tirarlo.
            ...(runtimeCapturado ? { modelRuntime: runtimeCapturado } : {}),
          },
          {
            loadProject: async (id, uid) => {
              const rows = await db
                .select({ data: schema.projects.data, generatedRuntime: schema.projects.generatedRuntime })
                .from(schema.projects)
                .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, uid))).limit(1);
              return rows[0]
                ? { data: rows[0].data as ProjectData, generatedRuntime: rows[0].generatedRuntime }
                : null;
            },
            // `runtime` re-ata el JavaScript del modelo al documento nuevo. Va en
            // el MISMO update: escribirlo aparte abriría una ventana con el HTML
            // ya cambiado y la cápsula todavía apuntando al anterior.
            saveProjectData: async (id, uid, data, runtime) => {
              await db.update(schema.projects)
                .set({ data, updatedAt: now, ...(runtime ? { generatedRuntime: runtime } : {}) })
                .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, uid)));
            },
            // Best-effort: perder un snapshot no puede costar la edición.
            snapshotVersion: async (v) => {
              await createVersion(v).catch((err: unknown) => {
                // eslint-disable-next-line no-console
                console.error("[ai-design] version snapshot failed", err);
              });
            },
          },
        );
        if (!saved.ok) {
          // eslint-disable-next-line no-console
          console.error("[ai-design] persist failed", saved.error);
          emit("error", { message: "Generated successfully but failed to save — try again." });
          closeStream();
          return;
        }

        // Debit credits — billed from the real token usage the provider
        // reports. Falls back to a char estimate only if the usage event
        // never arrived (rare; Gemini emits it on every stream).
        const credits = usage
          ? creditsForUsage(usage.inputTokens, usage.outputTokens, CREDIT_RATE)
          : estimateCredits(
              SYSTEM_PROMPT.length + userMessageContent.length,
              accumulatedReasoning.length + accumulatedHtml.length,
              CREDIT_RATE,
            );
        // eslint-disable-next-line no-console
        console.log(
          `[ai-design] ${modelLabel} — prompt: ${usage?.inputTokens ?? "?"}, output: ${usage?.outputTokens ?? "?"}, thinking: ${usage?.thinkingTokens ?? "?"} → ${credits} credits · mode: ${outputMode} · ${Date.now() - startedAt}ms`,
        );
        await debitCredits(userId, credits);

        // Guardar-y-AVISAR: si se descartó algo, el usuario tiene que leerlo.
        // Un cambio que se pierde en silencio es peor que uno que no se hizo.
        emit("done", {
          reasoning: droppedNotice ? `${reasoning}

${droppedNotice}` : reasoning,
          html: trimmedHtml,
          updatedAt: now.toISOString(),
          mode: outputMode,
          appliedOpCount,
          enabledModules,
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

/** El cuerpo vive en lib/ai/sse; el nombre local se queda porque lo usan
 *  decenas de sitios y renombrarlos no aclara nada. */
function errorJson(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}
