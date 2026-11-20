// WHAT CLOUDFLARE KEEPS OF AN EXPERIMENT (edge review): `purgeSubdomain` purges `/` and `/index.html` plus what it is told.
// A target page other than `/` stays cached up to an hour (+ stale-while-revalidate) after a launch or an end, and an asset
// that Variant B overrides — a stylesheet or script, immutable-class by extension — up to thirty days, serving one
// variant's bytes after the other was decided. At the launch and at EVERY end (promote, keep A, stop, harm stop, cancel)
// the target page (with its language variants when the experiment covers them) and every path in the experiment's
// `overrides` are purged — through the existing helper; there is no Cloudflare code of the experiment's own.
import "server-only";

import { purgeSubdomain } from "@/lib/publish/cache-purge";

export interface EdgeExperiment {
  readonly targetPath: string;
  readonly includeLocales: boolean;
  /** The asset paths (leading slash) whose bytes differ between B and control: `AbManifestExperiment.overrides`. */
  readonly overridePaths?: readonly string[] | null;
}

/** The URL paths (beyond the `/` and `/index.html` every purge carries) that hold the experiment's variants. Pure. */
export function experimentEdgePaths(exp: EdgeExperiment, languages: readonly string[]): string[] {
  const out = new Set<string>();
  const slug = exp.targetPath === "/" ? "" : exp.targetPath.replace(/^\/+|\/+$/g, "");
  // The target page itself: as a document (`/pricing`, `/pricing/`, `/pricing/index.html`) — the home is purged anyway.
  if (slug) for (const p of [`/${slug}`, `/${slug}/`, `/${slug}/index.html`]) out.add(p);
  // Its language variants, when the experiment covers them (B has them, and the edge buckets them).
  if (exp.includeLocales) {
    for (const loc of languages) {
      const base = slug ? `/${loc}/${slug}` : `/${loc}`;
      for (const p of [base, `${base}/`, `${base}/index.html`]) out.add(p);
    }
  }
  // What Variant B overrides: the assets whose bytes the edge serves from B's tree for a B visitor.
  for (const p of exp.overridePaths ?? []) if (typeof p === "string" && p.startsWith("/")) out.add(p);
  return [...out];
}

/** The most URLs one Cloudflare purge call takes (30 historically, 100 on non-Enterprise plans now: the lower one is safe on both).
 *  A call over the cap is rejected WHOLE — the home with it — and the soft-fail would hide that. */
export const PURGE_URLS_PER_CALL = 30;
/** `purgeSubdomain` always adds the home (`/` and `/index.html`) to the paths it is given. */
const PURGE_ALWAYS_THERE = 2;
/** The paths of an experiment per call: ten languages × three forms, the target and a few overrides can pass thirty. */
export const PURGE_PATHS_PER_CALL = PURGE_URLS_PER_CALL - PURGE_ALWAYS_THERE;

/** Purges all of it, in batches the edge accepts, through the existing helper. Soft-failing like every purge: the experiment's
 *  own work is done and a stale edge flushes on its own — and one batch that fails doesn't stop the next. */
export async function purgeExperimentEdge(subdomain: string, exp: EdgeExperiment, languages: readonly string[]): Promise<void> {
  const paths = experimentEdgePaths(exp, languages);
  // Always at least one call: even with nothing of its own to purge, the home goes.
  for (let i = 0; i === 0 || i < paths.length; i += PURGE_PATHS_PER_CALL) {
    await purgeSubdomain(subdomain, paths.slice(i, i + PURGE_PATHS_PER_CALL)).catch(() => undefined);
  }
}
