// WHAT A PUBLISH WITH A LIVE EXPERIMENT IS MADE OF (review items 12, 13): Control = what is PUBLISHED (the project's
// published sources, never the draft), Variant B = the experiment's worktree copy. Launching builds it, and so does a
// system republish that has to keep a running split alive (`publishProject` → `resolveAbPublish`).
import "server-only";

import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { isVersionable } from "@/lib/git/worktree";
import type { PublishedSources } from "@/lib/len-watch/published-sources";
import { splitPagesForPublish } from "@/lib/projects/site-pages";
import type { ProjectData } from "@/lib/projects/types";
import type { AbPublishSpec } from "@/lib/publish/filesystem";

import type { AbExperimentRow } from "./store";
import { copySources, ensurePublishedSources, readFilesAtCommit, readPublishedFolder } from "./worktree";

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

/** Variant B as it was LAUNCHED: the copy's sources with the files of the launch commit laid over them. What the copy
 *  holds now can differ — it is a working directory — so the launched content wins: a file changed after the launch goes
 *  back, one added after it is dropped, one deleted after it comes back. What git never sees (the npm lock publishing
 *  reads) and a page's own metadata (title, gating) stay the copy's. Pure. */
export function variantBAsLaunched(
  copy: { readonly data: ProjectData; readonly folder: Readonly<Record<string, string>> },
  launched: Readonly<Record<string, string>>,
): { data: ProjectData; folder: Record<string, string> } {
  const folder: Record<string, string> = {};
  for (const [path, content] of Object.entries(copy.folder)) if (!isVersionable(path)) folder[path] = content;
  let html = "";
  const pages: NonNullable<ProjectData["pages"]> = {};
  for (const [path, content] of Object.entries(launched)) {
    const page = paginaDeRuta(path);
    if (!page) folder[path] = content;
    else if (page.page === null) html = content;
    else pages[page.page] = { ...(copy.data.pages?.[page.page] ?? {}), html: content } as NonNullable<ProjectData["pages"]>[string];
  }
  return { data: { ...copy.data, html, pages }, folder };
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

/** `null` when the experiment can't be rebuilt (no copy left, nothing published, or the commit Variant B was launched
 *  from can't be read): the caller refuses rather than publish a release that would end it or ship a B nobody launched. */
export async function buildLiveAbPublish(exp: AbExperimentRow, ownerId: string): Promise<LiveAbPublish | null> {
  if (!exp.copyProjectId || !exp.variantBCommitOid) return null;
  const control = await loadControlSources(exp.projectId, ownerId);
  if (!control) return null;
  const copy = await copySources(exp.copyProjectId).catch(() => null);
  if (!copy) return null;
  // B is what was LAUNCHED (its commit), not whatever the copy holds now (G1+G3 review, item 18).
  const launched = await readFilesAtCommit(exp.projectId, exp.variantBCommitOid).catch(() => null);
  if (!launched) return null;
  const variantB = variantBAsLaunched(copy, launched);
  return {
    experiment: exp,
    sourcesOverride: { data: control.data, folder: control.folder },
    abExperiment: abSpecOf(exp, variantB),
    protectReleaseShas: exp.controlReleaseSha ? [exp.controlReleaseSha] : [],
  };
}
