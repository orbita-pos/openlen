// Client-side SEO + a11y health check for the project's HTML. Pure
// function — pass it the page's current HTML, get back a {score, total,
// issues} report. The Properties tab's "Page health" section renders the
// result live as the user edits.
//
// Checks are deliberately opinionated but not pedantic: every issue here
// is something a marketing landing page actually benefits from fixing.
// Over-flagging is the bigger danger — users tune out a noisy linter.

export type SeoLevel = "error" | "warn";

export type SeoFixField = "title" | "description" | "ogImage" | "favicon";

export interface SeoIssue {
  level: SeoLevel;
  /** Stable identifier for the check — used as React key and for
   *  potential future per-issue documentation links. */
  code: string;
  /** Single-sentence explanation in user-facing English. */
  message: string;
  /** When set, the issue is fixable via one of the PageMeta inputs and
   *  the UI can deep-link to that field. */
  fixField?: SeoFixField;
}

export interface SeoReport {
  /** Number of checks that passed (no issue emitted). */
  score: number;
  /** Total number of checks run. */
  total: number;
  /** All issues — errors first, then warnings. Stable order across
   *  re-runs so React keys stay stable. */
  issues: SeoIssue[];
}

interface Check {
  code: string;
  run: (doc: Document) => SeoIssue | null;
}

const CHECKS: Check[] = [
  {
    code: "missing-title",
    run: (d) => {
      const t = d.querySelector("title")?.textContent?.trim() ?? "";
      return !t
        ? {
            level: "error",
            code: "missing-title",
            message: "Page is missing a <title> tag.",
            fixField: "title",
          }
        : null;
    },
  },
  {
    code: "title-length",
    run: (d) => {
      const t = d.querySelector("title")?.textContent?.trim() ?? "";
      if (!t) return null; // already flagged by missing-title
      if (t.length < 30) {
        return {
          level: "warn",
          code: "title-length",
          message: `Title is ${t.length} chars — aim for 30-60 for better SERP impact.`,
          fixField: "title",
        };
      }
      if (t.length > 60) {
        return {
          level: "warn",
          code: "title-length",
          message: `Title is ${t.length} chars — Google truncates around 60.`,
          fixField: "title",
        };
      }
      return null;
    },
  },
  {
    code: "missing-description",
    run: (d) => {
      const desc =
        d
          .querySelector("meta[name='description']")
          ?.getAttribute("content")
          ?.trim() ?? "";
      return !desc
        ? {
            level: "error",
            code: "missing-description",
            message: "Page has no meta description.",
            fixField: "description",
          }
        : null;
    },
  },
  {
    code: "description-length",
    run: (d) => {
      const desc =
        d
          .querySelector("meta[name='description']")
          ?.getAttribute("content")
          ?.trim() ?? "";
      if (!desc) return null;
      if (desc.length < 100) {
        return {
          level: "warn",
          code: "description-length",
          message: `Description is ${desc.length} chars — aim for 100-160.`,
          fixField: "description",
        };
      }
      if (desc.length > 160) {
        return {
          level: "warn",
          code: "description-length",
          message: `Description is ${desc.length} chars — search engines truncate around 160.`,
          fixField: "description",
        };
      }
      return null;
    },
  },
  {
    code: "missing-og-image",
    run: (d) => {
      const og = d
        .querySelector("meta[property='og:image']")
        ?.getAttribute("content")
        ?.trim();
      return !og
        ? {
            level: "warn",
            code: "missing-og-image",
            message: "No og:image — social shares won't have a preview card.",
            fixField: "ogImage",
          }
        : null;
    },
  },
  {
    code: "missing-og-title",
    run: (d) => {
      const og = d
        .querySelector("meta[property='og:title']")
        ?.getAttribute("content")
        ?.trim();
      return !og
        ? {
            level: "warn",
            code: "missing-og-title",
            message: "No explicit og:title — shares fall back to <title>.",
          }
        : null;
    },
  },
  {
    code: "missing-favicon",
    run: (d) => {
      const f = d
        .querySelector("link[rel*='icon']")
        ?.getAttribute("href")
        ?.trim();
      return !f
        ? {
            level: "warn",
            code: "missing-favicon",
            message: "No favicon — browser tabs will show a default icon.",
            fixField: "favicon",
          }
        : null;
    },
  },
  {
    code: "imgs-without-alt",
    run: (d) => {
      const imgs = Array.from(d.querySelectorAll("img"));
      const missing = imgs.filter(
        (img) => !(img.getAttribute("alt") ?? "").trim(),
      ).length;
      return missing > 0
        ? {
            level: "warn",
            code: "imgs-without-alt",
            message: `${missing} image${missing === 1 ? "" : "s"} missing alt text.`,
          }
        : null;
    },
  },
  {
    code: "h1-count",
    run: (d) => {
      const count = d.querySelectorAll("h1").length;
      if (count === 0) {
        return {
          level: "warn",
          code: "h1-count",
          message: "Page has no <h1> heading.",
        };
      }
      if (count > 1) {
        return {
          level: "warn",
          code: "h1-count",
          message: `Page has ${count} <h1> headings — use exactly one.`,
        };
      }
      return null;
    },
  },
  {
    code: "blank-target-no-noopener",
    run: (d) => {
      const blanks = Array.from(d.querySelectorAll("a[target='_blank']"));
      const insecure = blanks.filter((a) => {
        const rel = a.getAttribute("rel") ?? "";
        return !/\bnoopener\b/.test(rel);
      }).length;
      return insecure > 0
        ? {
            level: "warn",
            code: "blank-target-no-noopener",
            message: `${insecure} link${insecure === 1 ? "" : "s"} use target="_blank" without rel="noopener".`,
          }
        : null;
    },
  },
  {
    code: "low-word-count",
    run: (d) => {
      const body = d.body?.textContent ?? "";
      const words = body.trim().split(/\s+/).filter(Boolean).length;
      return words < 50
        ? {
            level: "error",
            code: "low-word-count",
            message: `Page has only ${words} visible words — search engines may not index it.`,
          }
        : null;
    },
  },
];

const TOTAL = CHECKS.length;

/** Parse the HTML once, run every check, sort errors before warnings.
 *  Safe to call from a useMemo with `html` as the dep — DOMParser is
 *  synchronous and fast on documents up to ~200KB. */
export function checkSeo(html: string): SeoReport {
  if (!html || typeof html !== "string") {
    return { score: 0, total: TOTAL, issues: [] };
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return { score: 0, total: TOTAL, issues: [] };
  }

  const issues: SeoIssue[] = [];
  for (const check of CHECKS) {
    const issue = check.run(doc);
    if (issue) issues.push(issue);
  }
  issues.sort((a, b) => {
    if (a.level !== b.level) return a.level === "error" ? -1 : 1;
    return a.code.localeCompare(b.code);
  });

  return {
    score: TOTAL - issues.length,
    total: TOTAL,
    issues,
  };
}
