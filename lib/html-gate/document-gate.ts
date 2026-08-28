import { validateBehaviors } from "@/lib/conductas-heredadas/validate";
import type { BehaviorIssue } from "@/lib/conductas-heredadas/types";
import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta, type EnsurePageMetaOptions } from "@/lib/publish/ensure-page-meta";

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
  /**
   * Runs on the normalized document, before ensurePageMeta — the exact slot
   * `seedBrandIntoHtml` occupies in the four surfaces this seam exists for
   * (from-html, from-template, generate, finalizeComposedDocument). It is
   * NOT a general-purpose escape hatch: it runs after `sanitize`, so anything
   * it injects is unsanitized and only re-checked for the reserved marker,
   * not re-sanitized. That is safe for `seedBrandIntoHtml` specifically —
   * it HTML-escapes every user-supplied string it interpolates
   * (contact-widget.ts / platforms-band.ts's `esc()`), validates the
   * profile's accent as a strict 6-digit hex before use
   * (apply-accent.ts's `normalizeHex`), and rejects javascript:/data:/
   * vbscript: URLs before they reach an href (platforms.ts) — it emits no
   * `<script>` and no inline event handler. A future `beforeMeta` that hands
   * this seam anything else (model output, unescaped user text) needs its
   * own sanitization; do not assume this seam provides it.
   */
  readonly beforeMeta?: (html: string) => string;
}

export interface HtmlGatePolicy {
  readonly render: boolean;
  readonly seal: boolean;
  readonly behaviors: "block" | "warn";
  /** Forwarded to ensurePageMeta as-is. Omit for today's no-options call. */
  readonly meta?: EnsurePageMetaOptions;
}

export type HtmlGateResult =
  | {
      readonly ok: true;
      readonly html: string;
      readonly removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
      readonly warnings: string[];
      /**
       * Present only when behaviours were WARNED about (policy "warn" found
       * issues and kept the document). `warnings` is one bounded slug by
       * design; this is the detail behind it, for a caller that has to record
       * what was wrong and how many. Symmetric with the refusal branch — if
       * the gate saw issues it hands them back either way, so nobody has to
       * re-run validateBehaviors to recover them.
       */
      readonly issues?: readonly BehaviorIssue[];
    }
  | {
      readonly ok: false;
      readonly code: HtmlGateRefusal;
      readonly detail?: string;
      /**
       * Only on `behaviors_invalid`. `detail` is the bounded machine slug;
       * this is what a human-facing sentence is built from, via
       * `describeBehaviorIssues`. It exists because the surfaces that put
       * that prose in front of the model cannot recompute it once the gate
       * owns the decision — the canonical bytes it validated are not
       * returned on a refusal, and re-running normalize+meta caller-side to
       * get them back is the drift this gate deletes. The gate still does
       * not phrase anything; it hands back what it saw.
       */
      readonly issues?: readonly BehaviorIssue[];
      /**
       * Present on every refusal raised AFTER sanitization succeeded. What
       * sanitize removed is true regardless of which later stage said no, and
       * a caller that only hears the blocking reason will send the model back
       * with the same deleted <script> attached.
       */
      readonly removed?: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
    };

/**
 * One place a document becomes safe to keep, so a guarantee added once
 * protects every surface that adopts it. Order is part of the contract: the
 * reserved marker is refused before any pass that could rewrite it out of
 * sight.
 *
 * ADOPTED — six callers. Verified by grep, not memory; if you add one, add it
 * here or this comment starts lying again, which is the defect that shipped
 * twice already:
 *   - `lib/curate/creative-sandbox.ts`      { render: true,  seal: true,  behaviors: "block" }
 *   - `lib/curate/creative-baseline.ts`     { render: false, seal: true,  behaviors: "block" }
 *   - `app/api/projects/[id]/apply-template` { render: false, seal: false, behaviors: "block" }
 *   - `lib/agent/tools.ts` persistHtmlChange { render: false, seal: false, behaviors: "block" }
 *   - `app/api/templates/ai-design`          { render: false, seal: false, behaviors: "block" }
 *   - `app/api/templates/autofill`           { render: false, seal: false, behaviors: "block" }
 *   - `app/api/projects/from-html`           { render: false, seal: false, behaviors: "warn"  }
 *   - `app/api/projects/from-template`       { render: false, seal: false, behaviors: "warn"  }
 *     (twice — once for the home page, once per cloned subpage)
 *   - `app/api/generate`                     { render: false, seal: false, behaviors: "warn"  }
 *
 * Every adopted surface passes `seal: false` except the two curate ones:
 * nothing is served from a route that writes to the database, publishToDir
 * seals at publish time. `render: false` everywhere except the sandbox,
 * because an interactive request cannot pay a browser launch.
 *
 * `behaviors` is the fail-closed/fail-open split, and it is not a taste
 * setting. "block" where the user already HAS a page and refusing costs them
 * only the edit. "warn" where the project does not exist yet and refusing
 * would cost them the whole page — those record what was lost via
 * `collectDegradations` into `data.degradations[]` and the workspace tells
 * the user. If you add a "warn" caller without writing that record, you have
 * built a silent failure.
 *
 * NOT ADOPTED — pending on purpose, not forgotten:
 *   - `assemble` and `finalizeComposedDocument` — both sanitize AFTER
 *     `ensurePageMeta`, the reverse of this gate. Migrating either reorders
 *     the chain; that is the point, but it has to be proven on a real fixture
 *     rather than slipped in.
 *   - `publishToDir` — deliberately out of scope of this plan, not pending
 *     inside it. It sanitizes and seals per page inside a ~25-step bake loop
 *     and has its own plan.
 *
 * If your path IS on the adopted list, do not re-run sanitize/normalize/meta
 * yourself — duplicating them is how the two chains drift apart. If it is
 * NOT, you still own your own sanitization; adoption is not implied by this
 * file existing.
 */
export async function passHtmlGate(
  html: string,
  deps: HtmlGateDeps,
  policy: HtmlGatePolicy,
): Promise<HtmlGateResult> {
  if (html.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker" };

  const sanitized = deps.sanitize(html);
  if (sanitized.html === null) return { ok: false, code: "sanitization_failed" };
  // Every refusal from here down carries this: sanitize already ran, and what
  // it removed stays true no matter which later stage says no.
  const removed = {
    scripts: sanitized.removed.scripts,
    eventHandlers: sanitized.removed.eventHandlers,
    iframes: sanitized.removed.iframes,
    dangerousUrls: sanitized.removed.dangerousUrls,
  };

  // The Agent ran these three and the creative sandbox did not, so a page
  // created with AI was born without the normalization every ingested page
  // gets. The gate is the union of what the surfaces enforced, not the set
  // one of them happened to have.
  const normalized = normalizeBornCanonical(sanitized.html);
  const seeded = deps.beforeMeta ? deps.beforeMeta(normalized) : normalized;
  // beforeMeta runs after the one marker check above, on bytes deps.sanitize
  // never saw — the guarantee that never bends has to be re-proven here too.
  if (seeded.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker", removed };
  const canonical = ensurePageMeta(seeded, policy.meta);

  const behaviorIssues = validateBehaviors(canonical);
  const warnings: string[] = [];
  let warnedIssues: readonly BehaviorIssue[] | undefined;
  if (behaviorIssues.length > 0) {
    if (policy.behaviors === "block") {
      return { ok: false, code: "behaviors_invalid", detail: behaviorSlug(behaviorIssues), issues: behaviorIssues, removed };
    }
    warnings.push(behaviorSlug(behaviorIssues));
    warnedIssues = behaviorIssues;
  }

  let output = canonical;
  if (policy.seal) {
    if (!deps.seal) return { ok: false, code: "seal_failed", detail: "sealer_unavailable", removed };
    const sealed = deps.seal(canonical);
    if (!sealed.sealed) return { ok: false, code: "seal_failed", removed };
    output = sealed.html;
  }

  if (policy.render) {
    if (!deps.render) return { ok: false, code: "render_failed", detail: "renderer_unavailable", removed };
    const rendered = await deps.render(output);
    if (!rendered) return { ok: false, code: "render_failed", detail: "render_unavailable", removed };
    if (rendered.mobileOverflow) return { ok: false, code: "render_failed", detail: "mobile_overflow", removed };
    if (rendered.invalidGeometry) return { ok: false, code: "render_failed", detail: "invalid_geometry", removed };
  }

  return { ok: true, html: output, removed, warnings, issues: warnedIssues };
}

/** Keeps the reason bounded by construction: a slug or nothing. The prose
 *  from describeBehaviorIssues (lib/conductas-heredadas/validate.ts) is for a user,
 *  not for a refusal code — `BehaviorIssue.behavior` is already a
 *  lowercase `BehaviorName` slug ("countdown", "lightbox", …), so the regex
 *  fallback below only fires if that type ever stops being a plain slug. */
function behaviorSlug(issues: BehaviorIssue[]): string {
  const raw = typeof issues[0]?.behavior === "string" ? issues[0].behavior : "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z][a-z0-9_]{0,39}$/.test(slug) ? slug : "behavior_issue";
}
