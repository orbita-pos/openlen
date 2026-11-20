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

/** Purges all of it. Soft-failing like every purge: the experiment's own work is done; a stale edge flushes on its own. */
export async function purgeExperimentEdge(subdomain: string, exp: EdgeExperiment, languages: readonly string[]): Promise<void> {
  await purgeSubdomain(subdomain, experimentEdgePaths(exp, languages)).catch(() => undefined);
}
