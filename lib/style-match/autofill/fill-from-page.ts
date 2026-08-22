// Page → template content transfer for "convert my page into this template".
// Reuses the autofill discipline (leaf-only replace, structure sacred, NEVER
// delete — locked design decision) but the content source is the user's EXISTING
// page, not structured JSON. Two strategies are exported so the spike can MEASURE
// which maps better before we commit one to the endpoint:
//   • fillTemplateFromPage  — 1 call: page content inventory + tagged template.
//   • extractPageData (+ existing fillTemplate) — 2 calls: structured extract, then fill.
// NOTE: the Gemini-call body is duplicated from fill-template.ts on purpose — we're
// still picking a winner; if 1-call wins we factor a shared helper out then.

import { applyOps, parseOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import { sanitizeFilledHtml } from "./sanitize";

import { fireworksStreamProvider } from "@/lib/ai/fireworks-as-stream-provider";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ID =
  process.env.STYLE_MATCH_FILL_MODEL || process.env.STYLE_MATCH_TEXT_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 16_000;

const LEAF = "h1|h2|h3|h4|h5|h6|p|span|li|a|button|label|blockquote|em|strong|time|small|dt|dd|td|th|figcaption|summary";
const MAX_ATTEMPTS = 2; // 1 retry — covers a transient upstream blip or a no-ops response

// ───────── deterministic helpers (no AI) ─────────

/** Ordered inventory of the source page's visible leaf text — what the model maps
 *  into the template's slots. Compact (no markup) to keep the prompt small. */
export function pageContentInventory(html: string): string {
  const body = html.replace(/[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");
  const re = new RegExp(`<(${LEAF})\\b[^>]*>([^<]*?)</\\1>`, "gi");
  const lines: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const text = m[2].replace(/\s+/g, " ").trim();
    if (text.length > 1) lines.push(`[${m[1].toLowerCase()}] ${text}`);
  }
  return lines.join("\n");
}

/** Transplant the source page's <title> + meta description into the template head
 *  — deterministic, so the browser tab / SEO stops showing the template's brand.
 *  (The fill engine is body-only; this is the must-fix for the <head>.) */
export function transplantHeadMeta(templateHtml: string, sourceHtml: string): string {
  const srcTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(sourceHtml)?.[1]?.trim();
  const srcDesc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(sourceHtml)?.[1]?.trim();
  let out = templateHtml;
  if (srcTitle) {
    out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out)
      ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${srcTitle}</title>`)
      : out.replace(/<head[^>]*>/i, (h) => `${h}<title>${srcTitle}</title>`);
  }
  if (srcDesc && /<meta[^>]+name=["']description["']/i.test(out)) {
    out = out.replace(
      /(<meta[^>]+name=["']description["'][^>]*content=["'])[^"']*(["'])/i,
      `$1${srcDesc}$2`,
    );
  }
  return out;
}

/** Op-ids that are SAFE to replace: pure-text leaf elements (a leaf tag whose
 *  content has no nested elements). Replacing anything else — a container, or a
 *  leaf that wraps inline children like <a><span>…</span></a> — drops a subtree
 *  (the structural drift we measured). The model's ops are filtered to this
 *  allowlist, trading a few uncoverable slots for ZERO design drift. */
function safeLeafOpIds(taggedHtml: string): Set<string> {
  const re = new RegExp(`<(${LEAF})\\b([^>]*)>([^<]*?)</\\1>`, "gi");
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(taggedHtml))) {
    const id = /\bdata-op-id="([^"]+)"/.exec(m[2])?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

// ───────── Gemini call (duplicated from fill-template.ts; see NOTE) ─────────

async function callGemini(
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ text: string; error?: string; usage?: { in: number; out: number } }> {
  // Rellenar una plantilla con el contenido de una página es TEXTO: lo escribe
  // DeepSeek. `OPENLEN_AUTOFILL=gemini` vuelve atrás.
  //
  // ⚠️ Esta llamada usaba `fetch` CRUDO contra la API de Gemini, no
  // `GeminiProvider` — por eso una auditoría que buscara `new GeminiProvider` no
  // la veía. Si vuelves a inventariar proveedores, busca también las URLs.
  if (process.env.OPENLEN_AUTOFILL?.trim().toLowerCase() === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { text: "", error: "GEMINI_API_KEY not set" };
    const url = `${GEMINI_BASE}/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
    let r: Response;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal,
      });
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : String(e) };
    }
    if (!r.ok) return { text: "", error: `Gemini ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}` };
    const p = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = p.candidates?.[0]?.content?.parts?.map((x) => x.text ?? "").join("") ?? "";
    return {
      text,
      usage: p.usageMetadata
        ? { in: p.usageMetadata.promptTokenCount ?? 0, out: p.usageMetadata.candidatesTokenCount ?? 0 }
        : undefined,
    };
  }

  // Sin `jsonObject`: la salida de esta superficie es un bloque de ops con su
  // propio protocolo, no JSON.
  const provider = fireworksStreamProvider({
    requestId: "autofill-from-page",
    operation: "template_autofill",
    maxOutputTokens: MAX_TOKENS,
    temperature: 0.5,
  });
  let text = "";
  let usage: { in: number; out: number } | undefined;
  try {
    for await (const ev of provider.stream(
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        maxOutputTokens: MAX_TOKENS,
        temperature: 0.5,
      },
      signal ? { signal } : {},
    )) {
      if (ev.type === "text_delta") text += ev.text;
      else if (ev.type === "usage") usage = { in: ev.inputTokens, out: ev.outputTokens };
      else if (ev.type === "done" && ev.stopReason.kind === "error") {
        return { text: "", error: "el proveedor devolvió un error" };
      }
    }
  } catch (e) {
    return { text: "", error: e instanceof Error ? e.message : String(e) };
  }
  return usage ? { text, usage } : { text };
}

// ───────── 1-call: fillTemplateFromPage ─────────

const PAGE_FILL_SYSTEM_PROMPT = `You are rebuilding a landing page TEMPLATE so it carries a specific business's real content, taken from their EXISTING page. Replace the template's generic placeholder copy with the business's actual copy — surgically, at the leaf level. You do NOT redesign, restructure, or restyle. The template's design is SACRED — it's exactly what the user picked.

INPUT: a SOURCE CONTENT inventory (the user's real copy, one line per element as "[tag] text") and a TEMPLATE (every element carries a data-op-id).

RULES:
- Replace ONLY leaf text-bearing elements: h1-h6, p, span, li, a, button, label, blockquote, em, strong, time, small, dt, dd, td, th, figcaption, summary.
- NEVER replace containers (div, section, header, footer, article, nav, ul, ol, dl, table, tr, picture, figure, main, form) — replacing one deletes its children.
- NEVER emit op="delete". The template's structure stays 100% intact.
- Map source content to the contextually right slot: the source's main headline → the template's hero h1; source section headings → template section headings; source body copy → template paragraphs; source feature/list items → template feature/list slots, 1:1 in order.
- SPARSE DISCIPLINE: only replace a template slot when the source has corresponding real content. If the source has nothing for a slot (e.g. the template has a testimonials section but the source page has none), LEAVE THE TEMPLATE'S ORIGINAL COPY untouched — do NOT invent, do NOT delete. The user edits those later.
- LENGTH BUDGET: match the slot's expected length (hero h1 6-12 words; section headings 2-6 words; card descriptions 15-30 words; buttons 1-4 words). Compress source copy to fit; never overflow the design.
- Preserve the source's language. Keep each replacement element's tag + classes; change only the visible text. Emit NO data-op-id and NO data-slot-path in your output.
- CAP at 80 ops. Prioritize prominence: hero > features > pricing > CTAs > testimonials > FAQ > footer.

PROTOCOL — output ONLY this block, no preamble, no markdown fences:
<edits>
<edit op="replace" target="<leaf-id>"><new><h1 class="...">New text</h1></new></edit>
</edits>`;

function buildPageUserMessage(inventory: string, taggedHtml: string): string {
  return `SOURCE CONTENT (the user's real copy — pull from here):
═══════════════════════════════════════════
${inventory}
═══════════════════════════════════════════

TEMPLATE HTML (every element has a data-op-id):
═══════════════════════════════════════════
${taggedHtml}
═══════════════════════════════════════════

Emit your <edits>...</edits> block now. Replace the template's generic copy with this business's real content on LEAF elements only. Leave template copy untouched where the source has nothing. Preserve the design 100%.`;
}

export interface PageFillResult {
  ok: boolean;
  html?: string;
  appliedOps?: number;
  totalOps?: number;
  droppedUnsafeOps?: number;
  attempts?: number;
  usage?: { in: number; out: number };
  durationMs: number;
  error?: string;
  raw?: string;
}

export async function fillTemplateFromPage(opts: {
  templateHtml: string;
  sourcePageHtml: string;
  signal?: AbortSignal;
}): Promise<PageFillResult> {
  const t0 = Date.now();
  const withHead = transplantHeadMeta(opts.templateHtml, opts.sourcePageHtml);
  const inventory = pageContentInventory(opts.sourcePageHtml);
  if (!inventory) return { ok: false, error: "source page has no extractable text", durationMs: Date.now() - t0 };
  const { taggedHtml } = tagWithOpIds(withHead);
  const safeLeaves = safeLeafOpIds(taggedHtml);
  const user = buildPageUserMessage(inventory, taggedHtml);

  let lastRaw = "";
  // Retry on a no-ops response (the model occasionally skips the <edits>
  // envelope — ~50% on the first call in the spike) or a transient upstream blip.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callGemini(PAGE_FILL_SYSTEM_PROMPT, user, opts.signal);
    if (res.error) {
      if (/\b(429|503)\b|unavailable|overloaded|rate.?limit/i.test(res.error) && attempt < MAX_ATTEMPTS) continue;
      return { ok: false, error: res.error, attempts: attempt, durationMs: Date.now() - t0 };
    }
    lastRaw = res.text;
    const { ops } = parseOps(res.text);
    // Keep only replaces that target a pure-text leaf (drops deletes AND
    // container/wrapping-leaf targets) — guarantees zero design drift.
    const before = ops.length;
    const safe = ops.filter((o) => o.type !== "delete" && safeLeaves.has(o.target));
    if (safe.length === 0) {
      if (attempt < MAX_ATTEMPTS) continue;
      return { ok: false, error: "model returned no usable ops", raw: lastRaw, attempts: attempt, durationMs: Date.now() - t0 };
    }
    const applied = applyOps(taggedHtml, safe);
    if (!applied.html) {
      if (attempt < MAX_ATTEMPTS) continue;
      return { ok: false, error: applied.errors[0]?.reason ?? "apply produced no HTML", raw: lastRaw, attempts: attempt, durationMs: Date.now() - t0 };
    }
    const sanitized = sanitizeFilledHtml(stripOpIds(applied.html));
    return {
      ok: true,
      html: sanitized.html,
      appliedOps: applied.appliedCount,
      totalOps: safe.length,
      droppedUnsafeOps: before - safe.length,
      attempts: attempt,
      usage: res.usage,
      durationMs: Date.now() - t0,
    };
  }
  return { ok: false, error: "exhausted retries", raw: lastRaw, durationMs: Date.now() - t0 };
}

// ───────── 2-call helper: extract structured data from the page ─────────

const EXTRACT_SYSTEM_PROMPT = `Extract the business information from this landing page's content as JSON. Fields: business_name (string), tagline (string), pitch (string), hero_keyword (string — one punchy word from the headline), features (array of {title, desc}), pricing (array of {name, price, period, features[]}), testimonials (array of {name, role, company, quote}), faq_questions (array of {q, a}), cta_primary (string), cta_secondary (string). Use null or [] where the page doesn't have it — do NOT invent. Preserve the page's language. Output ONLY valid JSON, no markdown fences, no commentary.`;

export async function extractPageData(
  sourcePageHtml: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; usage?: { in: number; out: number } }> {
  const inventory = pageContentInventory(sourcePageHtml);
  if (!inventory) return { ok: false, error: "source page has no extractable text" };
  const res = await callGemini(EXTRACT_SYSTEM_PROMPT, `PAGE CONTENT:\n\n${inventory}\n\nOutput the JSON now.`, signal);
  if (res.error) return { ok: false, error: res.error };
  const cleaned = res.text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return { ok: true, data: JSON.parse(cleaned) as Record<string, unknown>, usage: res.usage };
  } catch {
    return { ok: false, error: `model returned non-JSON: ${cleaned.slice(0, 200)}` };
  }
}
