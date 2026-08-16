import type { BehaviorIssue } from "@/lib/behaviors/types";
import type { Degradation } from "@/lib/projects/types";

/**
 * Turns what the gate already measured into the record we keep on the row.
 *
 * Machine codes only. The user-facing sentence is built in the surface from
 * i18n — "12 scripts removed" is our vocabulary, not a creator's, and the one
 * thing this record must never become is a log nobody reads.
 *
 * A loss with no user-facing phrasing is deliberately NOT recorded: if we
 * cannot say what stopped working in the user's language, we are not ready to
 * interrupt them about it. That is why `metaRefresh` is absent — the gate does
 * not report it, and "a meta refresh was stripped" has no honest creator-facing
 * sentence anyway.
 */
/**
 * Whether the incoming document carried script for the transform to bake.
 * `<script>` specifically, not inline handlers: the transform exists to bake
 * content JS BUILDS on load, and an `onclick` builds nothing.
 */
export function hadScript(html: string): boolean {
  return /<script[\s>]/i.test(html);
}

export function collectDegradations(input: {
  surface: Degradation["surface"];
  removed?: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
  behaviorIssues?: readonly BehaviorIssue[];
  /** `TransformReport.fallback` — present means the page was NOT transformed. */
  transformFallback?: string;
  /** Whether the incoming document actually carried script to bake. */
  hadScripts?: boolean;
}): Degradation[] {
  const { surface, removed, behaviorIssues, transformFallback, hadScripts } = input;
  const out: Degradation[] = [];

  // First, because it happens first and because it is the one the user is
  // most likely to SEE: content the page builds with JS never got baked, and
  // the JS that would have built it is about to be stripped.
  //
  // Gated on the page having had script at all. A fallback means "we did not
  // transform", which is also what we get when the kill switch is off or when
  // Chrome dies — a recurring failure on the dev box and a plausible one in
  // prod. Reporting it unconditionally would warn on every paste during an
  // outage, about dynamic content the page may never have had.
  if (transformFallback && hadScripts) {
    out.push({ surface, stage: "transform", code: "dynamic_content", count: 1 });
  }

  if (removed) {
    // Two counters, one lived experience — the interactive bits are gone.
    //
    // Not for a curated template: 152 of 172 carry a decorative script
    // (a `js` class toggle, an IntersectionObserver reveal) that lib/transform
    // bakes and the sanitizer then strips, so nothing visibly broke. Saying
    // "your page had parts built with JavaScript" on ~88% of clones is the
    // noise this notice exists to avoid — and it was never the user's page.
    // A template whose dynamic content genuinely went missing still reports:
    // that is the `dynamic_content` code above, which fires when the bake
    // did not happen.
    const js = surface === "from-template" ? 0 : removed.scripts + removed.eventHandlers;
    if (js > 0) out.push({ surface, stage: "sanitize", code: "scripts", count: js });
    if (removed.iframes > 0) {
      out.push({ surface, stage: "sanitize", code: "embeds", count: removed.iframes });
    }
    if (removed.dangerousUrls > 0) {
      out.push({ surface, stage: "sanitize", code: "unsafe_links", count: removed.dangerousUrls });
    }
  }

  if (behaviorIssues && behaviorIssues.length > 0) {
    out.push({
      surface,
      stage: "behaviors",
      code: "broken_controls",
      count: behaviorIssues.length,
    });
  }

  return out;
}
