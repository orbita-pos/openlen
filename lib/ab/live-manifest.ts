// WHAT THE LIVE RELEASE SAYS ABOUT AN EXPERIMENT (review: strands and reconcile).
//
// The database row and the release can disagree: a launch that died between the swap and its write, a promote whose
// recording failed after B went live, an owner's «Stop and publish» whose close failed. The release is what the edge serves,
// so it is the witness: `<release>/openlen/ab.json` of the CURRENT release of the subdomain names the experiments the edge is
// splitting. This reads it and tells the three situations apart — a manifest that names the experiment, one that doesn't (or
// none at all), and «can't tell right now»: a transient read error must NEVER be taken for «no experiment» (the row would be
// closed over a split that is still live).
import "server-only";

import { readFile, readlink } from "node:fs/promises";
import path from "node:path";

import { AB_MANIFEST_PATH } from "./layout";
import { parseAbManifest } from "./serve";

export type LiveAb =
  /** The live release carries this experiment: the edge is splitting it. */
  | { readonly kind: "live"; readonly sha: string; readonly overrides: readonly string[]; readonly splitBps: number }
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

const absent = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** The sha `<root>/<sub>/current` points at. `null` ONLY when there is no such link (ENOENT/ENOTDIR: never published, or
 *  unpublished); any other failure THROWS, so `readLiveAb` says «unknown» — `getCurrentReleaseSha` swallows every error into
 *  null, and an EIO there would read as «no experiment» (round 3, D). */
async function readCurrentSha(subdomain: string): Promise<string | null> {
  const { getPublishRoot } = await import("@/lib/publish/filesystem");
  if (!subdomain || subdomain !== path.basename(subdomain)) throw new Error("not a subdomain");
  const currentPath = path.join(getPublishRoot(), subdomain, "current");
  try {
    const target = await readlink(currentPath);
    const m = target.match(/(?:^|[\\/])releases[\\/](.+)$/);
    return m ? m[1]! : null;
  } catch (err) {
    if (absent(err)) return null;
    // Not a link: the marker file the Windows test environment writes instead (EINVAL is «this isn't a symlink»).
    if ((err as NodeJS.ErrnoException | null)?.code !== "EINVAL") throw err;
  }
  try {
    const trimmed = (await readFile(currentPath, "utf8")).trim();
    return /^[a-f0-9]{1,64}$/.test(trimmed) ? trimmed : null;
  } catch (err) {
    if (absent(err)) return null;
    throw err;
  }
}

const realIo: LiveAbIo = {
  currentSha: readCurrentSha,
  readManifest: async (subdomain, sha) => {
    const { getPublishRoot } = await import("@/lib/publish/filesystem");
    try {
      return await readFile(path.join(getPublishRoot(), subdomain, "releases", sha, AB_MANIFEST_PATH), "utf8");
    } catch (err) {
      if (absent(err)) return null;
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
    return named ? { kind: "live", sha, overrides: [...named.overrides], splitBps: named.splitBps } : { kind: "other", sha };
  } catch {
    return { kind: "unknown" };
  }
}
