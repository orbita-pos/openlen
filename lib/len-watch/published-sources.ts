// WHAT A PUBLISH KEEPS OF ITSELF (spec local 2026-10-30-len-watch, §5.5 step 1): the exact sources it published, so
// Len Watch can cut a worktree from them. They are a git commit in the project's repository that hangs off its
// history (its parent is HEAD) and that no branch points at — like `git stash`, neither `git branch` nor the log of a
// branch shows it, so it isn't an automatic commit in the owner's history. Objects are shared and deduplicated, so a
// publish almost equal to the one before costs almost nothing.
//
// Only what git sees goes in the commit (`isVersionable`): the folder's other files that publishing reads (the npm
// lock under /.openlen) are kept apart, in `extraFiles`. In the commit they would show up in the worktree's
// `git status` as deleted, and its leftovers commit would delete them.
import { blobForContent } from "@/lib/git/content";
import { signatureOf, type GitIdentity } from "@/lib/git/command";
import { encodeCommit, makeObject, type GitObject } from "@/lib/git/objects";
import { buildTree } from "@/lib/git/repository";
import { ensureRepository } from "@/lib/git/run";
import type { GitStore } from "@/lib/git/store";
import { isVersionable, workingTree } from "@/lib/git/worktree";
import { ficherosDelSitio, leerFichero, sinOpIds, type SitioDeDatos } from "@/lib/agent/ficheros/sitio";
import type { ProjectData } from "@/lib/projects/types";

export interface Snapshot {
  /** Absolute path → content, what git sees: the site's pages and the folder's versionable files. */
  readonly versioned: Record<string, string>;
  /** The folder's files git never sees but publishing reads. */
  readonly extra: Record<string, string>;
}

export function snapshotFiles(data: SitioDeDatos, folder: Readonly<Record<string, string>>): Snapshot {
  const versioned: Record<string, string> = {};
  const extra: Record<string, string> = {};
  for (const ruta of ficherosDelSitio(data)) versioned[ruta] = sinOpIds(leerFichero(data, ruta) ?? "");
  for (const [ruta, content] of Object.entries(folder)) (isVersionable(ruta) ? versioned : extra)[ruta] = content;
  return { versioned, extra };
}

/** The commit of `files` (absolute paths), its parent the repository's HEAD; no branch moves. With no repository yet,
 *  it is first created with an "Initial commit", as git does on first use. Returns the commit's oid. */
export async function commitPublished(store: GitStore, files: Readonly<Record<string, string>>, owner: GitIdentity, now: Date): Promise<string> {
  const tree = workingTree(files);
  const repo = await ensureRepository(store, tree, owner, now);
  const index: Record<string, string> = {};
  const blobs: GitObject[] = [];
  // Every versionable file, ignored ones too: publishing doesn't read .gitignore.
  for (const [p, content] of tree.files) {
    const blob = blobForContent(content);
    blobs.push(blob);
    index[p] = blob.oid;
  }
  const { root, objects } = buildTree(index);
  const sig = signatureOf(owner, now);
  const commit = makeObject("commit", encodeCommit({ tree: root, parents: [repo.head], author: sig, committer: sig, message: "Published\n" }));
  await store.writeObjects([...blobs, ...objects, commit]);
  return commit.oid;
}

export interface PublishedSources {
  readonly commitOid: string;
  /** The project's data as published, whole: a page is more than its HTML (its title, its metadata), and the
   *  settings (forms, chat, analytics) count as unpublished changes too. A worktree is born from it. */
  readonly data: ProjectData;
  readonly extraFiles: Record<string, string>;
}

/** After a publish: what it published, kept. Fail-soft — a publish never fails for this. */
export async function recordPublishedSources(p: { projectId: string; ownerId: string; data: ProjectData; folder: Record<string, string> }): Promise<void> {
  try {
    const [{ db, schema }, { postgresStore }, { identityOf }] = await Promise.all([import("@/lib/db"), import("@/lib/git/postgres-store"), import("@/lib/git/service")]);
    const snap = snapshotFiles(p.data, p.folder);
    const commitOid = await commitPublished(postgresStore(p.projectId), snap.versioned, await identityOf(p.ownerId), new Date());
    const row = { commitOid, data: p.data, extraFiles: snap.extra, publishedAt: new Date() };
    await db
      .insert(schema.projectPublishedSources)
      .values({ projectId: p.projectId, ...row })
      .onConflictDoUpdate({ target: schema.projectPublishedSources.projectId, set: row });
  } catch (err) {
    console.warn("[len-watch] could not keep what was published", err);
  }
}

export async function readPublishedSources(projectId: string): Promise<PublishedSources | null> {
  const [{ eq }, { db, schema }] = await Promise.all([import("drizzle-orm"), import("@/lib/db")]);
  const [row] = await db.select().from(schema.projectPublishedSources).where(eq(schema.projectPublishedSources.projectId, projectId)).limit(1);
  if (!row) return null;
  return { commitOid: row.commitOid, data: row.data, extraFiles: row.extraFiles ?? {} };
}
