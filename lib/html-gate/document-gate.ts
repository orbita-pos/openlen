import { validateBehaviors } from "@/lib/behaviors/validate";
import type { BehaviorIssue } from "@/lib/behaviors/types";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta } from "@/lib/publish/ensure-page-meta";

const RESERVED_MARKER = "data-slot-path=";

export type HtmlGateRefusal =
  | "reserved_marker"
  | "sanitization_failed"
  | "behaviors_invalid"
  | "seal_failed"
  | "render_failed";

export interface HtmlGateDeps {
  readonly sanitize: (html: string) => { html: string | null; errors: string[]; removed: { scripts: number; eventHandlers: number; dangerousUrls: number; iframes: number; metaRefresh: number } };
  readonly seal: (html: string) => { html: string; sealed: boolean };
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
}

export interface HtmlGatePolicy {
  readonly render: boolean;
}

export type HtmlGateResult =
  | { readonly ok: true; readonly html: string; readonly removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number } }
  | { readonly ok: false; readonly code: HtmlGateRefusal; readonly detail?: string };

/**
 * The only place a document becomes safe to keep. Every surface that changes
 * page HTML passes through here, so a guarantee added once protects all of
 * them. Order is part of the contract: the reserved marker is refused before
 * any pass that could rewrite it out of sight.
 */
export async function passHtmlGate(
  html: string,
  deps: HtmlGateDeps,
  policy: HtmlGatePolicy,
): Promise<HtmlGateResult> {
  if (html.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker" };

  const sanitized = deps.sanitize(html);
  if (sanitized.html === null) return { ok: false, code: "sanitization_failed" };

  // The Agent ran these three and the creative sandbox did not, so a page
  // created with AI was born without the normalization every ingested page
  // gets. The gate is the union of what the surfaces enforced, not the set
  // one of them happened to have.
  const canonical = ensurePageMeta(normalizeBornCanonical(sanitized.html));

  const behaviorIssues = validateBehaviors(canonical);
  if (behaviorIssues.length > 0) {
    return { ok: false, code: "behaviors_invalid", detail: behaviorSlug(behaviorIssues) };
  }

  const sealed = deps.seal(canonical);
  if (!sealed.sealed) return { ok: false, code: "seal_failed" };

  if (policy.render) {
    if (!deps.render) return { ok: false, code: "render_failed", detail: "renderer_unavailable" };
    const rendered = await deps.render(sealed.html);
    if (!rendered) return { ok: false, code: "render_failed", detail: "render_unavailable" };
    if (rendered.mobileOverflow) return { ok: false, code: "render_failed", detail: "mobile_overflow" };
    if (rendered.invalidGeometry) return { ok: false, code: "render_failed", detail: "invalid_geometry" };
  }

  return {
    ok: true,
    html: sealed.html,
    removed: {
      scripts: sanitized.removed.scripts,
      eventHandlers: sanitized.removed.eventHandlers,
      iframes: sanitized.removed.iframes,
      dangerousUrls: sanitized.removed.dangerousUrls,
    },
  };
}

/** Keeps the reason bounded by construction: a slug or nothing. The prose
 *  from describeBehaviorIssues (lib/behaviors/validate.ts) is for a user,
 *  not for a refusal code — `BehaviorIssue.behavior` is already a
 *  lowercase `BehaviorName` slug ("countdown", "lightbox", …), so the regex
 *  fallback below only fires if that type ever stops being a plain slug. */
function behaviorSlug(issues: BehaviorIssue[]): string {
  const raw = typeof issues[0]?.behavior === "string" ? issues[0].behavior : "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z][a-z0-9_]{0,39}$/.test(slug) ? slug : "behavior_issue";
}
