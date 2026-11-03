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

import type { CambioDeLaTerminal } from "@/lib/agent/terminal/ficheros";
import { listProjectFiles } from "@/lib/backend/files";
import { db, schema, inTransaction } from "@/lib/db";
import { toAbsolute } from "@/lib/git/paths";
import { postgresStore } from "@/lib/git/postgres-store";
import { Repository } from "@/lib/git/repository";
import { identityOf } from "@/lib/git/service";
import { draftTree, planBring } from "@/lib/len-watch/bring";
import { commitDetached, snapshotFiles } from "@/lib/len-watch/published-sources";
import { commitLeftovers, deleteBranch, removeWorktree, setBranch } from "@/lib/len-watch/worktree";
import { folderFingerprint } from "@/lib/projects/files-hash";

import type { WorktreeOutcome } from "./notice";

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

export async function addAgentWorktree(p: { parentId: string; ownerId: string; runId: string; register?: (w: AgentWorktree) => Promise<void> }): Promise<AgentWorktree> {
  return inTransaction(() => createAgentWorktree(p));
}

async function createAgentWorktree(p: { parentId: string; ownerId: string; runId: string; register?: (w: AgentWorktree) => Promise<void> }): Promise<AgentWorktree> {
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
  const w = { copyId, branch, base };
  await p.register?.(w);
  return w;
}

/** Writes the merge into the draft through `Write`'s guards (`guardarLoDeLaTerminal`, with the launching turn's
 *  session): `rechazado` when a guard refused part of it. */
export type SaveIntoDraft = (cambios: readonly CambioDeLaTerminal[], draft: Readonly<Record<string, string>>) => Promise<{ rechazado: boolean; retry?: boolean }>;

export interface FinishedWorktree {
  readonly outcome: WorktreeOutcome;
  /** What the draft had and has now in the files it wrote, for its undo. */
  readonly changes: { before: Record<string, string>; after: Record<string, string> } | null;
}

const TRIES = 3;

/**
 * The copy comes back (spec §4.3): what it left without a commit goes in one on its branch (`commitLeftovers`), and
 * Len Watch's three-way merge (base = the draft at launch, ours = the draft now, theirs = the branch tip) writes what
 * it changed into the draft — all of it or nothing. It doesn't wait for Len's turn: if Len wrote a planned file
 * meanwhile, the merge is planned again. The copy always goes; the branch goes when everything entered.
 * `onPlanned` is a test seam, called after planning and before writing.
 */
export async function finishAgentWorktree(p: {
  parentId: string;
  ownerId: string;
  w: AgentWorktree;
  description: string;
  save: SaveIntoDraft;
  previous?: WorktreeOutcome;
  onPlanned?: () => Promise<void>;
  onRechecked?: () => Promise<void>;
}): Promise<FinishedWorktree> {
  const { parentId, w } = p;
  const clean = () => inTransaction(async () => { await deleteBranch(parentId, w.branch); await removeWorktree(w.copyId); });
  if (p.previous?.state === "brought" && p.previous.copyId) {
    try {
      await clean();
      return { outcome: { state: "brought", files: p.previous.files }, changes: null };
    } catch { return { outcome: p.previous, changes: null }; }
  }
  let recoverable = false;
  const kept = async (): Promise<FinishedWorktree> => {
    if (!recoverable) return { outcome: { state: "kept", branch: w.branch, copyId: w.copyId }, changes: null };
    try { await removeWorktree(w.copyId); }
    catch { return { outcome: { state: "kept", branch: w.branch, copyId: w.copyId }, changes: null }; }
    return { outcome: { state: "kept", branch: w.branch }, changes: null };
  };
  const gone = async (): Promise<FinishedWorktree> => {
    await clean();
    return { outcome: { state: "nothing" }, changes: null };
  };
  try {
    const tip = await commitLeftovers(w.copyId, p.ownerId, `${p.description}\n`);
    // The worktree store retries parent-ref updates, but an exhausted retry must never strand dirty work.
    await setBranch(postgresStore(parentId), w.branch, tip);
    recoverable = true;
    if (tip === w.base) return await gone();
    const repo = new Repository(postgresStore(parentId));
    const absolute = (m: ReadonlyMap<string, string>) => new Map([...m].map(([path, oid]) => [toAbsolute(path), oid]));
    const [baseFiles, theirFiles] = await Promise.all([
      repo.commit(w.base).then((c) => repo.files(c.tree)),
      repo.commit(tip).then((c) => repo.files(c.tree)),
    ]);
    for (let i = 0; i < TRIES; i++) {
      const ours = await draftTree(parentId);
      const plan = await planBring(absolute(baseFiles), ours.oids, absolute(theirFiles), async (oid) => ours.texts.get(oid) ?? repo.text(oid));
      if (plan.kind === "nothing") return await gone();
      if (plan.kind === "conflict") {
        await removeWorktree(w.copyId);
        return { outcome: { state: "conflict", files: plan.paths, branch: w.branch }, changes: null };
      }
      await p.onPlanned?.();
      const paths = [...plan.writes.keys()].sort();
      const now = await draftTree(parentId);
      if (paths.some((path) => now.oids.get(path) !== ours.oids.get(path))) continue;
      await p.onRechecked?.();
      const draft = Object.fromEntries([...ours.oids].map(([path, oid]) => [path, ours.texts.get(oid)!]));
      const cambios: CambioDeLaTerminal[] = paths.map((ruta) => {
        const contenido = plan.writes.get(ruta);
        return contenido === null || contenido === undefined ? { tipo: "borrado", ruta } : { tipo: "escrito", ruta, contenido, crea: !Object.hasOwn(draft, ruta) };
      });
      const saved = await p.save(cambios, draft);
      if (saved.retry) continue;
      if (saved.rechazado) {
        await removeWorktree(w.copyId);
        return { outcome: { state: "conflict", files: paths, branch: w.branch }, changes: null };
      }
      const before: Record<string, string> = {};
      const after: Record<string, string> = {};
      for (const c of cambios) {
        if (Object.hasOwn(draft, c.ruta)) before[c.ruta] = draft[c.ruta]!;
        if (c.tipo === "escrito") after[c.ruta] = c.contenido;
      }
      try {
        await clean();
        return { outcome: { state: "brought", files: paths }, changes: { before, after } };
      } catch {
        // The merge already committed: a cleanup failure must not erase its undo or pretend it never landed.
        return { outcome: { state: "brought", files: paths, copyId: w.copyId }, changes: { before, after } };
      }
    }
    return await kept();
  } catch (err) {
    console.warn(`[subagents] the copy ${w.copyId} could not be brought back`, err);
    return kept();
  }
}
