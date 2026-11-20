// WHAT A PUBLISH WITH A LIVE EXPERIMENT IS MADE OF (review items 12, 13): Control = what is PUBLISHED (the project's
// published sources, never the draft), Variant B = the experiment's worktree copy. Launching builds it, and so does a
// system republish that has to keep a running split alive (`publishProject` → `resolveAbPublish`).
import "server-only";

import type { PublishedSources } from "@/lib/len-watch/published-sources";
import { splitPagesForPublish } from "@/lib/projects/site-pages";
import type { ProjectData } from "@/lib/projects/types";
import type { AbPublishSpec } from "@/lib/publish/filesystem";

import type { AbExperimentRow } from "./store";
import { copySources, ensurePublishedSources, readPublishedFolder } from "./worktree";

/** Control A: the published sources and their complete folder. */
export interface ControlSources {
  readonly published: PublishedSources;
  readonly data: ProjectData;
  readonly folder: Record<string, string>;
}

export async function loadControlSources(projectId: string, ownerId: string): Promise<ControlSources | null> {
  const published = await ensurePublishedSources(projectId, ownerId);
  if (!published) return null;
  return { published, data: published.data, folder: await readPublishedFolder(projectId, published) };
}

/** The experiment as `publishToDir` takes it, from the copy's sources. */
export function abSpecOf(
  exp: Pick<AbExperimentRow, "id" | "targetPath" | "salt" | "includeLocales" | "splitBps">,
  variantB: { readonly data: ProjectData; readonly folder: Readonly<Record<string, string>> },
  splitBps: number = exp.splitBps,
): AbPublishSpec {
  const { publicPages } = splitPagesForPublish(variantB.data);
  return {
    id: exp.id,
    targetPath: exp.targetPath,
    splitBps,
    salt: exp.salt,
    includeLocales: exp.includeLocales,
    variantB: {
      html: variantB.data.html,
      pages: publicPages,
      files: Object.entries(variantB.folder).map(([path, content]) => ({ path, content })),
    },
  };
}

/** The params that keep a running experiment alive through another publish: the same Variant B and manifest, a new
 *  control. */
export interface LiveAbPublish {
  readonly experiment: AbExperimentRow;
  readonly sourcesOverride: { readonly data: ProjectData; readonly folder: Record<string, string> };
  readonly abExperiment: AbPublishSpec;
  readonly protectReleaseShas: readonly string[];
}

/** `null` when the experiment can't be rebuilt (no copy left, nothing published): the caller refuses rather than
 *  publish a release that would end it. */
export async function buildLiveAbPublish(exp: AbExperimentRow, ownerId: string): Promise<LiveAbPublish | null> {
  if (!exp.copyProjectId) return null;
  const control = await loadControlSources(exp.projectId, ownerId);
  if (!control) return null;
  const variantB = await copySources(exp.copyProjectId).catch(() => null);
  if (!variantB) return null;
  return {
    experiment: exp,
    sourcesOverride: { data: control.data, folder: control.folder },
    abExperiment: abSpecOf(exp, variantB),
    protectReleaseShas: exp.controlReleaseSha ? [exp.controlReleaseSha] : [],
  };
}
