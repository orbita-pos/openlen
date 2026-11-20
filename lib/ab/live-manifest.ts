// WHAT THE LIVE RELEASE SAYS ABOUT AN EXPERIMENT (review: strands and reconcile).
//
// The database row and the release can disagree: a launch that died between the swap and its write, a promote whose
// recording failed after B went live, an owner's «Stop and publish» whose close failed. The release is what the edge serves,
// so it is the witness: `<release>/openlen/ab.json` of the CURRENT release of the subdomain names the experiments the edge is
// splitting. This reads it and tells the three situations apart — a manifest that names the experiment, one that doesn't (or
// none at all), and «can't tell right now»: a transient read error must NEVER be taken for «no experiment» (the row would be
// closed over a split that is still live).
import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { AB_MANIFEST_PATH } from "./layout";
import { parseAbManifest } from "./serve";

export type LiveAb =
  /** The live release carries this experiment: the edge is splitting it. */
  | { readonly kind: "live"; readonly sha: string; readonly overrides: readonly string[] }
  /** The live release carries no experiment (no manifest, or one that isn't a manifest), or there is no release at all. */
  | { readonly kind: "none"; readonly sha: string | null }
  /** The live release carries a manifest, but of other experiments only. */
  | { readonly kind: "other"; readonly sha: string }
  /** Unreadable right now: nothing may be concluded. */
  | { readonly kind: "unknown" };

export interface LiveAbIo {
  currentSha(subdomain: string): Promise<string | null>;
  /** The manifest's text, or `null` when the file isn't there; any other failure throws. */
  readManifest(subdomain: string, sha: string): Promise<string | null>;
}

const realIo: LiveAbIo = {
  currentSha: async (subdomain) => (await import("@/lib/publish/filesystem")).getCurrentReleaseSha(subdomain),
  readManifest: async (subdomain, sha) => {
    const { getPublishRoot } = await import("@/lib/publish/filesystem");
    try {
      return await readFile(path.join(getPublishRoot(), subdomain, "releases", sha, AB_MANIFEST_PATH), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT" || (err as NodeJS.ErrnoException | null)?.code === "ENOTDIR") return null;
      throw err;
    }
  },
};

export async function readLiveAb(subdomain: string, experimentId: string, io: LiveAbIo = realIo): Promise<LiveAb> {
  try {
    const sha = await io.currentSha(subdomain);
    if (!sha) return { kind: "none", sha: null };
    const raw = await io.readManifest(subdomain, sha);
    if (raw === null) return { kind: "none", sha };
    const manifest = parseAbManifest(raw);
    if (!manifest) return { kind: "none", sha };
    const named = manifest.experiments.find((e) => e.id === experimentId);
    return named ? { kind: "live", sha, overrides: [...named.overrides] } : { kind: "other", sha };
  } catch {
    return { kind: "unknown" };
  }
}
