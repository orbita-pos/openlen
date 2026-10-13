// The esm.sh URL of a package (spec 2026-10-13). Exact version, `target=es2022`
// always (without it esm.sh picks one from the User-Agent), `&dev` for the
// canvas and the eyes. `external` only for what the package itself declares:
// measured on 2026-10-13, any `external` changes the built path, so three asked
// with `external=react,react-dom` lived at another URL than the three that
// @react-three/fiber imports — two copies of three in one app.
import { esmOrigin } from "./paths";
import type { PackumentVersion } from "./registry";

export type EsmMode = "development" | "production";

export interface EsmRequest {
  readonly name: string;
  readonly version: string;
  readonly subpath: string;
  readonly mode: EsmMode;
  readonly externals: readonly string[];
}

export function esmUrl(req: EsmRequest, origin = esmOrigin()): string {
  const params = ["target=es2022"];
  if (req.externals.length > 0) params.push(`external=${[...req.externals].sort().join(",")}`);
  if (req.mode === "development") params.push("dev");
  return `${origin}/${req.name}@${req.version}${req.subpath ? `/${req.subpath}` : ""}?${params.join("&")}`;
}

export function rawUrl(name: string, version: string, subpath: string, origin = esmOrigin()): string {
  return `${origin}/${name}@${version}/${subpath}?raw`;
}

/** React (one copy, the catalog's) and the app's own esm.sh packages, when the package declares them. */
export function externalsFor(
  manifest: Pick<PackumentVersion, "dependencies" | "peerDependencies" | "optionalDependencies">,
  appEsmPackages: ReadonlySet<string>,
): string[] {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  return [...declared].filter((d) => d === "react" || d === "react-dom" || appEsmPackages.has(d)).sort();
}
