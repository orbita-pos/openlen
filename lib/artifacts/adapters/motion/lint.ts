/**
 * Deterministic static linter for motion (GSAP) artifact sources (A4).
 *
 * Pure and advisory: inspects authored HTML/CSS/JS/TS files before render to surface
 * concrete, seek-determinism and choreography facts without evaluating authored code
 * and without blocking valid renders.
 */

export type MotionLintCode = "gsap_css_transform_conflict" | "layout_read_in_tween" | "dead_timeline_warning";

export interface MotionLintWarning {
  readonly code: MotionLintCode;
  readonly file: string;
  readonly detail: string;
}

export interface MotionLintResult {
  readonly warnings: readonly MotionLintWarning[];
  readonly stats: {
    readonly tweens: number;
    readonly animatedDurationEstimate: number;
  };
}

const CSS_TRANSFORM_ANIM = /(?:transition(?:-property)?\s*:[^;{}]*\b(?:transform|all)\b|@keyframes\b[\s\S]{0,600}?\btransform\s*:)/i;
const GSAP_TRANSFORM_CALL = /\.(?:to|from|fromTo|set)\s*\([^;]{0,400}?\b(?:x|y|xPercent|yPercent|scale|scaleX|scaleY|rotation|rotate|skewX|skewY)\s*:/;
const LAYOUT_READ_IN_ONUPDATE = /\bonUpdate\s*:\s*(?:async\s+)?(?:function\b[^{]*|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{[^}]{0,600}?\b(?:getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight|scrollHeight|scrollWidth)\b/;
const GSAP_TWEEN_CALL = /\.(?:fromTo|to|from|set)\s*\(/g;
const DURATION_FIELD = /\bduration\s*:\s*(\d+(?:\.\d+)?)/g;

const isCodeFile = (path: string) => /\.(?:[cm]?[jt]sx?|html?)$/i.test(path);
const isStyleOrHtml = (path: string) => /\.(?:css|html?)$/i.test(path);

/** Inspects authored motion sources for common GSAP determinism and choreography pitfalls. */
export function lintMotionSources(files: Readonly<Record<string, string>>, durationSeconds: number): MotionLintResult {
  const warnings: MotionLintWarning[] = [];
  let cssTransformFile: string | null = null;
  let gsapTransformFile: string | null = null;
  let tweens = 0;
  let animatedDurationEstimate = 0;

  for (const [file, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof content !== "string") continue;
    if (isStyleOrHtml(file) && cssTransformFile === null && CSS_TRANSFORM_ANIM.test(content)) {
      cssTransformFile = file;
    }
    if (!isCodeFile(file)) continue;
    if (gsapTransformFile === null && GSAP_TRANSFORM_CALL.test(content)) {
      gsapTransformFile = file;
    }
    if (LAYOUT_READ_IN_ONUPDATE.test(content)) {
      warnings.push({
        code: "layout_read_in_tween",
        file,
        detail: "Reads DOM layout geometry (e.g. getBoundingClientRect/offsetWidth) inside a GSAP onUpdate callback; cache measurements before building the timeline.",
      });
    }
    const matches = content.match(GSAP_TWEEN_CALL);
    if (matches) tweens += matches.length;
    for (const m of content.matchAll(DURATION_FIELD)) {
      const d = Number(m[1]);
      if (Number.isFinite(d) && d > 0) animatedDurationEstimate += d;
    }
  }

  if (cssTransformFile !== null && gsapTransformFile !== null) {
    warnings.push({
      code: "gsap_css_transform_conflict",
      file: cssTransformFile,
      detail: `CSS animates or transitions transform in ${cssTransformFile} while GSAP animates transform properties in ${gsapTransformFile}; CSS transitions fight deterministic seek().`,
    });
  }

  if (durationSeconds >= 3 && (tweens === 0 || (animatedDurationEstimate > 0 && animatedDurationEstimate < durationSeconds * 0.4))) {
    warnings.push({
      code: "dead_timeline_warning",
      file: "motion.json",
      detail:
        tweens === 0
          ? `No GSAP tweens detected for a ${durationSeconds}s motion composition.`
          : `Estimated GSAP tween durations (${animatedDurationEstimate.toFixed(1)}s across ${tweens} tween(s)) cover under 40% of the ${durationSeconds}s timeline.`,
    });
  }

  return { warnings, stats: { tweens, animatedDurationEstimate: Number(animatedDurationEstimate.toFixed(2)) } };
}
