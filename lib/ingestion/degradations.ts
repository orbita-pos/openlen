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
export function collectDegradations(input: {
  surface: Degradation["surface"];
  removed?: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
  behaviorIssues?: readonly BehaviorIssue[];
  /** `TransformReport.fallback` — present means the page was NOT transformed. */
  transformFallback?: string;
}): Degradation[] {
  const { surface, removed, behaviorIssues, transformFallback } = input;
  const out: Degradation[] = [];

  // First, because it happens first and because it is the one the user is
  // most likely to SEE: content the page builds with JS never got baked, and
  // the JS that would have built it is about to be stripped.
  if (transformFallback) {
    out.push({ surface, stage: "transform", code: "dynamic_content", count: 1 });
  }

  if (removed) {
    // Two counters, one lived experience — the interactive bits are gone.
    const js = removed.scripts + removed.eventHandlers;
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
