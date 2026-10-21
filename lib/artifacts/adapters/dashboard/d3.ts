import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { ArtifactError } from "../../types";

/**
 * d3 v7, the global `d3` of every dashboard, as in Claude's dashboards: one frozen file
 * (public/artifact-vendor/d3-7.9.0/, from the npm package's dist/d3.min.js, ISC), checked by its hash before
 * it runs. No CDN and no network: the page is offline.
 */
export const D3_VERSION = "7.9.0";
const D3_SHA256 = "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539";
let cached: Promise<string> | null = null;

export function d3Runtime(root = process.env.OPENLEN_ARTIFACT_VENDOR_DIR?.trim() || path.join(process.cwd(), "public/artifact-vendor")): Promise<string> {
  return cached ??= (async () => {
    const dir = path.join(root, `d3-${D3_VERSION}`), file = path.join(dir, "d3.min.js");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || !(await realpath(file)).startsWith(await realpath(dir) + path.sep)) throw new Error("invalid d3 file");
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== D3_SHA256) throw new Error("d3 hash mismatch");
    return bytes.toString("utf8");
  })().catch((error) => {
    cached = null;
    throw new ArtifactError("artifact_package_unavailable", `d3 ${D3_VERSION} is missing or changed (${error instanceof Error ? error.message : "unreadable"}); restore public/artifact-vendor/d3-${D3_VERSION}/d3.min.js`);
  });
}
