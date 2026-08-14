import { SYSTEM_PROMPT as OPENLEN_DOCUMENT_PROMPT } from "@/app/api/generate/system-prompt";
import type { FireworksDocumentClient } from "@/lib/ai/fireworks-document-client";
import type { FireworksDocumentMessage, FireworksDocumentResult } from "@/lib/ai/fireworks-contracts";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import {
  CREATIVE_DOCUMENT_MANIFEST_VERSION,
  CreativeDocumentManifestSchema,
  type CreativeDocumentRejection,
} from "@/lib/generation/creative-document-contracts";
import { sha256 } from "@/lib/generation/content-hash";
import { normalizeBornCanonical, sanitizeForPublish, sealRelease, type SanitizeResult } from "@/lib/html-engine";
import type { IntentAnalysis } from "@/lib/generation/contracts";

import { AI_HYBRID_POLICY_VERSION } from "./ai-creation-contracts";
import { isDeliverableDocument } from "./creative-document-delivery";
import type { CreativeDocumentMetadata } from "./creative-document-delivery";
import { finalizeComposedDocument } from "./finalize-composed-document";

export const CREATIVE_DOCUMENT_PROMPT_VERSION = "creative-document/1.0" as const;
const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

export interface CreativeDocumentCandidate {
  readonly html: string;
  readonly title: string;
  readonly visualEngine: CreativeDocumentMetadata;
  readonly source: "document";
}

export interface CreativeDocumentInput {
  readonly requestId: string;
  readonly brief: string;
  readonly title: string;
  readonly profileData: BusinessProfileData;
  readonly creativeDirection: CreativeDirection;
  readonly intent: IntentAnalysis;
}

export interface CreativeDocumentDeps {
  readonly client?: FireworksDocumentClient;
  readonly normalize?: (html: string) => string;
  readonly sanitize?: (html: string) => SanitizeResult;
  readonly finalize?: typeof finalizeComposedDocument;
  readonly seal?: typeof sealRelease;
  readonly render?: typeof renderVisualQualityViewports;
  readonly recordModel?: (result: FireworksDocumentResult) => void;
  readonly maxOutputTokens?: number;
}

export interface CreativeDocumentOutcome {
  readonly candidate: CreativeDocumentCandidate | null;
  readonly turns: number;
  /** Redacted, in the order they were observed. Safe for telemetry. */
  readonly rejections: readonly CreativeDocumentRejection[];
  readonly stoppedBy: "authored" | "repaired" | "provider" | "budget" | "rejected";
}

/**
 * Pulls the document out of whatever the model wrapped it in. Models add
 * preambles, code fences, and closing remarks; none of that is a reason to
 * throw away a page that is sitting right there in the reply.
 */
export function extractHtmlDocument(text: string): string | null {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)(?:\n```|$)/i.exec(text);
  const body = fenced?.[1] ?? text;
  const opening = /<!doctype\s+html/i.exec(body) ?? /<html[\s>]/i.exec(body);
  if (opening?.index === undefined) return null;
  const start = opening.index;
  const closing = body.toLowerCase().lastIndexOf("</html>");
  const document = closing > start ? body.slice(start, closing + "</html>".length) : body.slice(start);
  return document.trim().length > 0 ? document.trim() : null;
}

const ALLOWED_SCRIPT_SRC = /^https:\/\/cdn\.tailwindcss\.com(?:\/|$)/i;

/**
 * What the MODEL wrote, measured on its own bytes.
 *
 * `sanitizeForPublish().removed` cannot answer this: `normalizeBornCanonical`
 * injects OpenLen's own Tailwind carrier scripts first, so the sanitizer
 * reports three removed scripts for a document that contains none. Asking the
 * model to rewrite a page because of OpenLen's carriers would burn its single
 * repair turn on every generation.
 */
export function authoredViolations(html: string): CreativeDocumentRejection[] {
  const rejections: CreativeDocumentRejection[] = [];
  const authoredScripts = [...html.matchAll(/<script\b([^>]*)>/gi)].some((match) => {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(match[1] ?? "");
    return !src || !ALLOWED_SCRIPT_SRC.test(src[1]!.trim());
  });
  if (authoredScripts) rejections.push("script_removed");
  if (/\son[a-z0-9_-]+\s*=/i.test(html)) rejections.push("event_handler_removed");
  if (/<(?:iframe|object|embed)\b/i.test(html)) rejections.push("frame_removed");
  if (/(?:href|src|action)\s*=\s*["']?\s*(?:javascript|vbscript|file)\s*:/i.test(html)) rejections.push("unsafe_url_removed");
  return rejections;
}

/**
 * The one place a rejection turns into something a model can act on. The audit
 * of the previous design found nine opaque codes and no detail; a repair turn
 * that is only told "render_failed" cannot converge.
 */
export function repairInstruction(rejections: readonly CreativeDocumentRejection[]): string {
  const lines = new Set<string>();
  for (const rejection of rejections) {
    switch (rejection) {
      case "no_document":
        lines.add("Your last reply did not contain an HTML document. Reply with the document only — first character `<`, last characters `</html>`. No preamble, no code fences, no closing notes.");
        break;
      case "truncated":
        lines.add("Your last document was cut off before `</html>` because it exceeded the output limit. Send the complete page, but make it more compact: fewer repeated utility classes, no HTML comments, no blank lines, shorter inline SVG.");
        break;
      case "script_removed":
        lines.add("OpenLen publishes static pages and removes every <script> element except the Tailwind CDN tag. Your JavaScript was stripped. Rebuild that behaviour with CSS only — :hover, :focus-within, :target, the checkbox/label pattern, CSS scroll-snap, and CSS animations all work on a published page.");
        break;
      case "event_handler_removed":
        lines.add("Inline event-handler attributes (onclick, onload, onmouseover, …) are removed at publish time. Remove them and express the interaction in CSS.");
        break;
      case "frame_removed":
        lines.add("<iframe>, <object>, and <embed> are not allowed. Replace them with inline content or a styled link.");
        break;
      case "unsafe_url_removed":
        lines.add("A URL in your document used a scheme that cannot be published (javascript:, vbscript:, file:, an executable data: URL, or embedded credentials). Use relative links, https:, http:, mailto:, or tel:.");
        break;
      case "reserved_marker":
        lines.add("The attribute `data-slot-path` is reserved by the OpenLen editor and must never appear. Remove it.");
        break;
      case "sanitization_failed":
        lines.add("The document could not be sanitized for publishing. Send a plain, well-formed HTML document with no embedded editor markers.");
        break;
      case "seal_failed":
        lines.add("The document could not be sealed for release. Keep the page free of inline scripts and author-supplied Content-Security-Policy meta tags.");
        break;
      case "missing_title":
        lines.add("The document needs a non-empty, descriptive <title> in <head> that names the business, and visible text in <body>.");
        break;
      case "mobile_overflow":
        lines.add("At 390px wide the page scrolls sideways. Something is wider than the viewport — a fixed pixel width, a long unbroken string, a wide grid that never collapses, or a negative margin. Make every section fit at 360px.");
        break;
      case "invalid_geometry":
        lines.add("The page did not produce a measurable layout. Make sure <html>, <head> and <body> are present and the page renders visible content without waiting on scripts.");
        break;
      case "render_unavailable":
        lines.add("The page could not be rendered for checking. Simplify the document and avoid very large inline assets.");
        break;
    }
  }
  return [...lines].join("\n");
}

interface CompileSuccess {
  readonly ok: true;
  readonly html: string;
  /** Non-fatal removals that were accepted on the final attempt. */
  readonly warnings: readonly CreativeDocumentRejection[];
}

interface CompileFailure {
  readonly ok: false;
  readonly rejections: readonly CreativeDocumentRejection[];
}

/**
 * Runs the artifact gates OpenLen owns. `tolerateRemovals` is what makes the
 * loop fail-soft: the first attempt is asked to redo a page whose JavaScript
 * was stripped, the last attempt ships the stripped page rather than nothing.
 */
export async function compileCreativeDocument(
  rawHtml: string,
  options: {
    readonly title: string;
    readonly profileData: BusinessProfileData;
    readonly truncated: boolean;
    readonly tolerateRemovals: boolean;
  },
  deps: CreativeDocumentDeps = {},
): Promise<CompileSuccess | CompileFailure> {
  const normalize = deps.normalize ?? normalizeBornCanonical;
  const sanitize = deps.sanitize ?? sanitizeForPublish;
  const finalize = deps.finalize ?? finalizeComposedDocument;
  const seal = deps.seal ?? sealRelease;
  const render = deps.render ?? renderVisualQualityViewports;

  const violations = authoredViolations(rawHtml);
  if (violations.length > 0 && !options.tolerateRemovals) {
    return { ok: false, rejections: options.truncated ? [...violations, "truncated"] : violations };
  }

  let normalized: string;
  try {
    normalized = normalize(rawHtml);
  } catch {
    return { ok: false, rejections: ["sanitization_failed"] };
  }

  let sanitized: SanitizeResult;
  try {
    sanitized = sanitize(normalized);
  } catch {
    return { ok: false, rejections: ["sanitization_failed"] };
  }
  if (sanitized.html === null) return { ok: false, rejections: ["reserved_marker"] };

  let finalized: ReturnType<typeof finalizeComposedDocument>;
  try {
    finalized = finalize({ html: sanitized.html, profileData: options.profileData, title: options.title });
  } catch {
    return { ok: false, rejections: ["sanitization_failed"] };
  }
  if (!finalized.ok) return { ok: false, rejections: ["sanitization_failed"] };

  if (!isDeliverableDocument(finalized.html)) {
    return { ok: false, rejections: options.truncated ? ["truncated", "missing_title"] : ["missing_title"] };
  }

  let sealed: ReturnType<typeof sealRelease>;
  try {
    sealed = seal(finalized.html);
  } catch {
    return { ok: false, rejections: ["seal_failed"] };
  }
  if (!sealed.sealed) return { ok: false, rejections: ["seal_failed"] };

  let rendered: Awaited<ReturnType<typeof renderVisualQualityViewports>>;
  try {
    rendered = await render(sealed.html);
  } catch {
    return { ok: false, rejections: ["render_unavailable"] };
  }
  if (!rendered) return { ok: false, rejections: ["render_unavailable"] };
  if (rendered.invalidGeometry) return { ok: false, rejections: ["invalid_geometry"] };
  if (rendered.mobileOverflow) return { ok: false, rejections: ["mobile_overflow"] };

  return { ok: true, html: sealed.html, warnings: violations };
}

function briefMessage(input: CreativeDocumentInput): string {
  const brand = input.profileData.brand?.accent;
  // The taxonomy stores slugs; a prompt reads better as plain words.
  const words = (slugs: readonly string[]) => slugs.slice(0, 8).map((slug) => slug.replace(/_/g, " ")).join(", ");
  const signals = words(input.intent.requiredVisualSignals);
  const forbidden = words(input.intent.forbiddenVisualSignals);
  return [
    `BRIEF: ${input.brief.trim().slice(0, 4_000)}`,
    `Business name to use on the page: ${input.title}`,
    signals ? `Visual signals this niche needs: ${signals}` : "",
    forbidden ? `Visual signals to avoid: ${forbidden}` : "",
    brand ? `Brand accent colour: ${brand}` : "",
    "",
    "This page must look like it belongs to this specific niche — not like a generic SaaS landing page. Choose the typography, palette, layout rhythm, and ornament the subject actually calls for.",
    "OpenLen publishes static HTML: every <script> except the Tailwind CDN tag is removed at publish time, so build all interaction with CSS.",
  ].filter(Boolean).join("\n");
}

function documentMetadata(input: CreativeDocumentInput, html: string, turns: 1 | 2, modelId: string, rejections: readonly CreativeDocumentRejection[]): CreativeDocumentMetadata {
  return {
    schemaVersion: "visual-engine-project/1.0",
    route: "creative_document",
    templateId: null,
    creativeDirection: input.creativeDirection,
    promptVersion: CREATIVE_DOCUMENT_PROMPT_VERSION,
    policyVersion: AI_HYBRID_POLICY_VERSION,
    contractVersion: "creative-direction/1.0",
    documentManifest: CreativeDocumentManifestSchema.parse({
      schemaVersion: CREATIVE_DOCUMENT_MANIFEST_VERSION,
      briefHash: sha256(input.brief),
      modelId,
      turns,
      repaired: turns === 2,
      rejectedReasons: [...rejections].slice(0, 16),
      outputHash: sha256(html),
      resultCode: "authored",
    }),
  };
}

/**
 * One creative call, then at most one repair that is told exactly what was
 * wrong. Never throws and never reports a hard failure: a null candidate means
 * the caller keeps whatever safe page it already had.
 */
export async function runCreativeDocument(
  input: CreativeDocumentInput,
  deps: CreativeDocumentDeps = {},
): Promise<CreativeDocumentOutcome> {
  const rejections: CreativeDocumentRejection[] = [];
  // The composition root owns the page budget and therefore the client; without
  // one there is nothing to call and the caller keeps its existing candidate.
  const client = deps.client;
  if (!client) return { candidate: null, turns: 0, rejections, stoppedBy: "provider" };

  const maxOutputTokens = deps.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const messages: FireworksDocumentMessage[] = [
    { role: "system", content: `${OPENLEN_DOCUMENT_PROMPT}\n\nYou are writing for OpenLen. Reply with the document only.` },
    { role: "user", content: briefMessage(input) },
  ];

  for (const turn of [1, 2] as const) {
    const lastTurn = turn === 2;
    let response: FireworksDocumentResult;
    try {
      response = await client.write({ messages, maxOutputTokens, requestId: `${input.requestId}-doc-${turn}` });
    } catch {
      return { candidate: null, turns: turn - 1, rejections, stoppedBy: "provider" };
    }
    try { deps.recordModel?.(response); } catch { /* telemetry cannot change delivery */ }

    if (!response.ok) {
      return {
        candidate: null,
        turns: turn - 1,
        rejections,
        stoppedBy: response.code === "budget_exceeded" ? "budget" : "provider",
      };
    }

    const extracted = extractHtmlDocument(response.text);
    const compiled = extracted === null
      ? { ok: false as const, rejections: ["no_document" as const] }
      : await compileCreativeDocument(
        extracted,
        { title: input.title, profileData: input.profileData, truncated: response.truncated, tolerateRemovals: lastTurn },
        deps,
      );

    if (compiled.ok) {
      const observed = [...rejections, ...compiled.warnings];
      return {
        candidate: {
          html: compiled.html,
          title: input.title,
          visualEngine: documentMetadata(input, compiled.html, turn, response.modelId, observed),
          source: "document",
        },
        turns: turn,
        rejections: observed,
        stoppedBy: turn === 1 ? "authored" : "repaired",
      };
    }

    rejections.push(...compiled.rejections);
    if (lastTurn) break;

    messages.push(
      { role: "assistant", content: (extracted ?? response.text).slice(0, 200_000) },
      { role: "user", content: `OpenLen could not publish that page.\n\n${repairInstruction(compiled.rejections)}\n\nSend the corrected complete document. Keep everything that already worked.` },
    );
  }

  return { candidate: null, turns: 2, rejections, stoppedBy: "rejected" };
}
