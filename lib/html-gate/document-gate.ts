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
  readonly seal?: (html: string) => { html: string; sealed: boolean };
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
}

export interface HtmlGatePolicy {
  readonly render: boolean;
  readonly seal: boolean;
  readonly behaviors: "block" | "warn";
}

export type HtmlGateResult =
  | { readonly ok: true; readonly html: string; readonly removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number }; readonly warnings: string[] }
  | { readonly ok: false; readonly code: HtmlGateRefusal; readonly detail?: string };

/**
 * One place a document becomes safe to keep, so a guarantee added once
 * protects every surface that adopts it. Order is part of the contract: the
 * reserved marker is refused before any pass that could rewrite it out of
 * sight.
 *
 * Adopted so far: the creative sandbox (applyPatch/adopt) and the creative
 * baseline. The other write paths — publishToDir, from-html, from-template,
 * generate, ai-design, the Agent's persistHtmlChange, assemble, autofill —
 * still run their own subsets and are migrated in later steps of the plan.
 * Do NOT skip your own sanitization on the assumption this already covers
 * you; check that your path is on the list above first.
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
  const warnings: string[] = [];
  if (behaviorIssues.length > 0) {
    if (policy.behaviors === "block") {
      return { ok: false, code: "behaviors_invalid", detail: behaviorSlug(behaviorIssues) };
    }
    warnings.push(behaviorSlug(behaviorIssues));
  }

  let output = canonical;
  if (policy.seal) {
    if (!deps.seal) return { ok: false, code: "seal_failed", detail: "sealer_unavailable" };
    const sealed = deps.seal(canonical);
    if (!sealed.sealed) return { ok: false, code: "seal_failed" };
    output = sealed.html;
  }

  if (policy.render) {
    if (!deps.render) return { ok: false, code: "render_failed", detail: "renderer_unavailable" };
    const rendered = await deps.render(output);
    if (!rendered) return { ok: false, code: "render_failed", detail: "render_unavailable" };
    if (rendered.mobileOverflow) return { ok: false, code: "render_failed", detail: "mobile_overflow" };
    if (rendered.invalidGeometry) return { ok: false, code: "render_failed", detail: "invalid_geometry" };
  }

  return {
    ok: true,
    html: output,
    removed: {
      scripts: sanitized.removed.scripts,
      eventHandlers: sanitized.removed.eventHandlers,
      iframes: sanitized.removed.iframes,
      dangerousUrls: sanitized.removed.dangerousUrls,
    },
    warnings,
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
