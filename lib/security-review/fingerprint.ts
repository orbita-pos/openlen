// lib/security-review/fingerprint.ts — WHAT A REVIEW IS OF. One sha256 over
// everything that can change the verdict:
//   · the reviewed files: what reaches the browser, /.env and /supabase;
//   · the pages;
//   · the production variables;
//   · the draft schema;
//   · the review's own version.
// Same fingerprint, same review: the result is reused instead of paid for twice.

import { createHash } from "node:crypto";

import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";

import type { ReviewInputs } from "./types";

/** Raise it when the prompt or the rules change: every project gets reviewed again. */
export const REVIEW_VERSION = 2;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export function isReviewedPath(path: string): boolean {
  return path === "/.env" || path.startsWith("/supabase/") || isPublishableFolderPath(path);
}

/** Path → text of what the review looks at; the pages under their published paths. It is also the copy a published
 *  version keeps, so the next review can be a diff against it. */
export function reviewedTexts(i: ReviewInputs): Record<string, string> {
  const out: Record<string, string> = { "/index.html": i.homeHtml };
  for (const [slug, html] of Object.entries(i.pages)) out[`/${slug}/index.html`] = html;
  for (const [path, content] of Object.entries(i.files)) if (isReviewedPath(path)) out[path] = content;
  return out;
}

/** Path → sha256 of what the review looks at. */
export function fileHashes(i: ReviewInputs): Record<string, string> {
  return Object.fromEntries(Object.entries(reviewedTexts(i)).map(([path, text]) => [path, sha(text)]));
}

export function fingerprintOf(i: ReviewInputs, version: number = REVIEW_VERSION): string {
  const files = fileHashes(i);
  const lines = [
    `v${version}`,
    ...Object.keys(files).sort().map((p) => `file ${p} ${files[p]}`),
    ...Object.keys(i.productionEnv).sort().map((n) => `env ${n} ${sha(i.productionEnv[n]!)}`),
    // The dump comes ordered from SQL and built field by field: its JSON is stable.
    `schema ${sha(JSON.stringify(i.schema))}`,
  ];
  return sha(lines.join("\n"));
}

