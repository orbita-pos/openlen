// THE FIX'S WORKTREE (spec local 2026-10-30-len-watch, §5.5): `git worktree add` for Len Watch. The branch
// `len-watch/<incident>` is cut from what was published (lib/len-watch/published-sources.ts) in the project's own
// repository, and its working copy is a hidden project, child of the real one: every tool of Len goes by `projectId`,
// so in the copy they all work unchanged, and its git is the parent's (lib/git/worktree-store.ts). The owner's draft
// is never touched here; bringing the fix into it is theirs to decide (lib/len-watch/bring.ts).
import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";

import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { listProjectFiles } from "@/lib/backend/files";
import { db, schema } from "@/lib/db";
import { toAbsolute, toRepoPath } from "@/lib/git/paths";
import { gitStoreFor, postgresStore } from "@/lib/git/postgres-store";
import { Repository } from "@/lib/git/repository";
import { runGit } from "@/lib/git/run";
import { identityOf } from "@/lib/git/service";
import type { GitStore } from "@/lib/git/store";
import { folderFingerprint } from "@/lib/projects/files-hash";
import type { ProjectData } from "@/lib/projects/types";

import { readPublishedSources, snapshotFiles } from "./published-sources";

export interface Worktree {
  readonly copyId: string;
  readonly branch: string;
  /** The published commit the branch was cut from. */
  readonly base: string;
}

const RETRIES = 5;
const CHUNK = 500;

export const branchName = (incidentId: string): string => `len-watch/${incidentId}`;

/** Moves (or, with `oid` null, deletes) a branch of a repository, compare-and-swap with retries. */
async function setBranch(store: GitStore, branch: string, oid: string | null): Promise<void> {
  for (let i = 0; i < RETRIES; i++) {
    const r = await store.readRepo();
    if (!r) throw new Error("the project has no repository");
    const refs: Record<string, string> = { ...r.refs };
    if (oid === null) delete refs[branch];
    else refs[branch] = oid;
    if (await store.updateRepo(r.version, r.head, r.index, { refs })) return;
  }
  throw new Error(`the branch ${branch} could not be moved`);
}

/** The worktree of a fix, or null when nothing published was kept (a project published before this existed). */
export async function addWorktree(p: { parentId: string; ownerId: string; incidentId: string }): Promise<Worktree | null> {
  const src = await readPublishedSources(p.parentId);
  if (!src) return null;
  const [parent] = await db.select({ title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, p.parentId)).limit(1);
  if (!parent) return null;

  const parentStore = postgresStore(p.parentId);
  const repo = new Repository(parentStore);
  const tree = await repo.files((await repo.commit(src.commitOid)).tree);
  await repo.objects([...tree.values()]);
  // The site's pages come in `data`; the folder is everything else in the commit, plus what git never sees.
  const folder: Record<string, string> = { ...src.extraFiles };
  for (const [path, oid] of tree) {
    const abs = toAbsolute(path);
    if (!paginaDeRuta(abs)) folder[abs] = await repo.text(oid);
  }

  const branch = branchName(p.incidentId);
  const copyId = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id: copyId,
    userId: p.ownerId,
    title: parent.title,
    brief: "",
    data: src.data,
    parentProjectId: p.parentId,
    filesHash: folderFingerprint(folder),
  });
  try {
    const rows = Object.entries(folder).map(([path, content]) => ({ projectId: copyId, path, content }));
    for (let i = 0; i < rows.length; i += CHUNK) await db.insert(schema.projectFiles).values(rows.slice(i, i + CHUNK));
    await setBranch(parentStore, branch, src.commitOid);
    // The worktree's own HEAD and index, on its branch (its own `refs` are never read: the parent's are).
    const own = postgresStore(copyId);
    const born = await own.createRepo(src.commitOid, Object.fromEntries(tree));
    await own.updateRepo(born.version, born.head, born.index, { branch });
  } catch (err) {
    await removeWorktree(copyId).catch(() => undefined);
    throw err;
  }
  return { copyId, branch, base: src.commitOid };
}

/** What publishing the branch reads: the copy's data and folder. */
export async function copySources(copyId: string): Promise<{ data: ProjectData; folder: Record<string, string> }> {
  const [row] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, copyId)).limit(1);
  if (!row) throw new Error(`no worktree ${copyId}`);
  return { data: row.data, folder: await listProjectFiles(copyId) };
}

/** What Len left without a commit in the copy goes in one on its branch (the fix's branch, never the owner's): what
 *  is published and what is brought are the same thing, the branch tip. Returns the tip. */
export async function commitLeftovers(copyId: string, ownerId: string, message: string): Promise<string> {
  const { data, folder } = await copySources(copyId);
  const store = await gitStoreFor(copyId);
  const who = await identityOf(ownerId);
  const input = { store, files: snapshotFiles(data, folder).versioned, cwd: "/", identity: who, owner: who, now: () => new Date() };
  if ((await runGit(input, ["status", "--short"])).stdout.trim()) {
    await runGit(input, ["add", "-A"]);
    const done = await runGit(input, ["commit", "-m", message]);
    if (done.exitCode !== 0) throw new Error(`the fix could not be committed: ${done.stderr.trim()}`);
  }
  const r = await store.readRepo();
  if (!r) throw new Error(`no worktree ${copyId}`);
  return r.head;
}

export async function branchTip(parentId: string, branch: string): Promise<string | null> {
  return (await postgresStore(parentId).readRepo())?.refs[branch] ?? null;
}

/** Did the branch change anything under `prefix` (an absolute folder: "/supabase/migrations/") since `base`? */
export async function branchTouches(parentId: string, base: string, tip: string, prefix: string): Promise<boolean> {
  const repo = new Repository(postgresStore(parentId));
  const [a, b] = await Promise.all([repo.commit(base), repo.commit(tip)]);
  const [before, after] = await Promise.all([repo.files(a.tree), repo.files(b.tree)]);
  const under = toRepoPath(prefix);
  for (const path of new Set([...before.keys(), ...after.keys()])) if (path.startsWith(under) && before.get(path) !== after.get(path)) return true;
  return false;
}

export async function deleteBranch(parentId: string, branch: string): Promise<void> {
  await setBranch(postgresStore(parentId), branch, null);
}

/** The copy goes (its rows cascade); the branch stays, as `git worktree remove` leaves it. Only ever a copy. */
export async function removeWorktree(copyId: string): Promise<void> {
  await db.delete(schema.projects).where(and(eq(schema.projects.id, copyId), isNotNull(schema.projects.parentProjectId)));
}
