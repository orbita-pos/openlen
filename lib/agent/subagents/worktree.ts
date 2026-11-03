/**
 * AN ISOLATED CHILD'S COPY (spec local 2026-11-02-subagentes-de-len-fase-4, §4.2–§4.4): Claude Code's
 * `isolation: "worktree"` on Len Watch's worktree (lib/len-watch/worktree.ts). The copy is a hidden project, child of
 * the real one, on its own branch `worktree-agent-<id>` of the parent's repository; every tool of Len goes by
 * `projectId`, so in the copy they all work unchanged.
 *
 * On purpose unlike Claude Code, which cuts the worktree from HEAD: here the draft almost never has commits (Len
 * commits only when asked), so HEAD is not what Len sees and often doesn't exist. The copy is the draft as it is at
 * launch, kept as a commit no branch points at (like `refs/stash`, as Len Watch keeps what was published).
 *
 * Cache effect: none; nothing here reaches the model.
 */
import "server-only";
import { eq } from "drizzle-orm";

import { listProjectFiles } from "@/lib/backend/files";
import { db, schema } from "@/lib/db";
import { postgresStore } from "@/lib/git/postgres-store";
import { Repository } from "@/lib/git/repository";
import { identityOf } from "@/lib/git/service";
import { commitDetached, snapshotFiles } from "@/lib/len-watch/published-sources";
import { removeWorktree, setBranch } from "@/lib/len-watch/worktree";
import { folderFingerprint } from "@/lib/projects/files-hash";

export interface AgentWorktree {
  readonly copyId: string;
  readonly branch: string;
  /** The draft at launch: the commit the branch was cut from, and the merge's base when it comes back. */
  readonly base: string;
}

const CHUNK = 500;

/** Claude Code's `worktree-<slug>`, with `agent-<id>` as the slug; `-2`, `-3`… when taken. */
export function agentBranchName(id: string, taken: ReadonlySet<string>): string {
  const first = `worktree-agent-${id}`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) if (!taken.has(`${first}-${n}`)) return `${first}-${n}`;
}

export async function addAgentWorktree(p: { parentId: string; ownerId: string; runId: string }): Promise<AgentWorktree> {
  const [parent] = await db
    .select({ title: schema.projects.title, data: schema.projects.data, userBrief: schema.projects.userBrief })
    .from(schema.projects)
    .where(eq(schema.projects.id, p.parentId))
    .limit(1);
  if (!parent) throw new Error(`no project ${p.parentId}`);
  const folder = await listProjectFiles(p.parentId);
  const snap = snapshotFiles(parent.data, folder);
  const parentStore = postgresStore(p.parentId);
  const base = await commitDetached(parentStore, snap.versioned, await identityOf(p.ownerId), new Date(), `Draft when subagent ${p.runId} started\n`);
  const repo = new Repository(parentStore);
  const tree = await repo.files((await repo.commit(base)).tree);
  const taken = new Set(Object.keys((await parentStore.readRepo())?.refs ?? {}));
  const branch = agentBranchName(p.runId, taken);

  const copyId = crypto.randomUUID();
  await db.insert(schema.projects).values({
    id: copyId,
    userId: p.ownerId,
    title: parent.title,
    brief: "",
    data: parent.data,
    userBrief: parent.userBrief,
    parentProjectId: p.parentId,
    filesHash: folderFingerprint(folder),
  });
  try {
    const rows = Object.entries(folder).map(([path, content]) => ({ projectId: copyId, path, content }));
    for (let i = 0; i < rows.length; i += CHUNK) await db.insert(schema.projectFiles).values(rows.slice(i, i + CHUNK));
    await setBranch(parentStore, branch, base);
    // The copy's own HEAD and index, on its branch (its own `refs` are never read: the parent's are).
    const own = postgresStore(copyId);
    const born = await own.createRepo(base, Object.fromEntries(tree));
    await own.updateRepo(born.version, born.head, born.index, { branch });
  } catch (err) {
    await removeWorktree(copyId).catch(() => undefined);
    throw err;
  }
  return { copyId, branch, base };
}
