// Isolated Variant B git worktree for OpenLen Edge A/B Testing (Plan 3).
// Reuses Len Watch's hidden child-project worktree architecture (`lib/len-watch/worktree.ts`)
// and three-way merge (`lib/len-watch/bring.ts`) over branch `ab/<expId>`, so the owner's
// draft and production are never corrupted while Len builds Variant B.
import "server-only";

import { eq } from "drizzle-orm";

import { paginaDeRuta } from "@/lib/agent/ficheros/sitio";
import { oneAtATime } from "@/lib/agent/subagents/worktree";
import { listProjectFiles } from "@/lib/backend/files";
import { db, schema } from "@/lib/db";
import { toAbsolute } from "@/lib/git/paths";
import { postgresStore } from "@/lib/git/postgres-store";
import { Repository } from "@/lib/git/repository";
import { draftFiles, draftTree, planBring } from "@/lib/len-watch/bring";
import {
  readPublishedSources,
  recordPublishedSources,
  type PublishedSources,
} from "@/lib/len-watch/published-sources";
import {
  branchTip,
  commitLeftovers,
  copySources,
  deleteBranch,
  removeWorktree,
  setBranch,
  type Worktree,
} from "@/lib/len-watch/worktree";
import { folderFingerprint } from "@/lib/projects/files-hash";
import type { ProjectData } from "@/lib/projects/types";

const CHUNK = 500;

export const abBranchName = (experimentId: string): string => `ab/${experimentId}`;

/** Ensure `projectPublishedSources` exists for a published project — projects
 *  published before Len Watch / A/B Testing existed get seeded cleanly from
 *  their published HTML + current pages/folder on first A/B draft creation. */
export async function ensurePublishedSources(
  projectId: string,
  ownerId: string,
): Promise<PublishedSources | null> {
  const existing = await readPublishedSources(projectId);
  if (existing) return existing;

  const [project] = await db
    .select({
      data: schema.projects.data,
      publishedHtml: schema.projects.publishedHtml,
      subdomain: schema.projects.subdomain,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);

  if (!project || !project.subdomain || !project.data) return null;

  const seededData: ProjectData = {
    ...project.data,
    html: project.publishedHtml?.trim() ? project.publishedHtml : project.data.html,
  };
  const folder = await listProjectFiles(projectId);
  await recordPublishedSources({ projectId, ownerId, data: seededData, folder });
  return readPublishedSources(projectId);
}

/** Reconstruct the complete published folder (versioned files from `commitOid` + `extraFiles`). */
export async function readPublishedFolder(
  projectId: string,
  src: PublishedSources,
): Promise<Record<string, string>> {
  const repo = new Repository(postgresStore(projectId));
  const tree = await repo.files((await repo.commit(src.commitOid)).tree);
  await repo.objects([...tree.values()]);
  const folder: Record<string, string> = { ...src.extraFiles };
  for (const [repoPath, oid] of tree) {
    const abs = toAbsolute(repoPath);
    if (!paginaDeRuta(abs)) folder[abs] = await repo.text(oid);
  }
  return folder;
}

/** Every file of a commit, as text, by absolute path: what a commit of this project's repository held. Throws when the commit
 *  or one of its objects can't be read. Variant B's launch commit is read this way when a republish re-emits the split. */
export async function readFilesAtCommit(projectId: string, commitOid: string): Promise<Record<string, string>> {
  const repo = new Repository(postgresStore(projectId));
  const tree = await repo.files((await repo.commit(commitOid)).tree);
  await repo.objects([...tree.values()]);
  const out: Record<string, string> = {};
  for (const [repoPath, oid] of tree) out[toAbsolute(repoPath)] = await repo.text(oid);
  return out;
}

/** Create an isolated hidden worktree project cut from `projectPublishedSources`
 *  on branch `ab/<experimentId>`. Serialized per project via `oneAtATime`. */
export async function createAbWorktree(p: {
  parentId: string;
  ownerId: string;
  experimentId: string;
}): Promise<Worktree | null> {
  return oneAtATime(p.parentId, async () => {
    const src = await ensurePublishedSources(p.parentId, p.ownerId);
    if (!src) return null;

    const [parent] = await db
      .select({ title: schema.projects.title })
      .from(schema.projects)
      .where(eq(schema.projects.id, p.parentId))
      .limit(1);
    if (!parent) return null;

    const parentStore = postgresStore(p.parentId);
    const repo = new Repository(parentStore);
    const tree = await repo.files((await repo.commit(src.commitOid)).tree);
    await repo.objects([...tree.values()]);

    const folder: Record<string, string> = { ...src.extraFiles };
    for (const [repoPath, oid] of tree) {
      const abs = toAbsolute(repoPath);
      if (!paginaDeRuta(abs)) folder[abs] = await repo.text(oid);
    }

    const branch = abBranchName(p.experimentId);
    const copyId = crypto.randomUUID();
    await db.insert(schema.projects).values({
      id: copyId,
      userId: p.ownerId,
      title: `${parent.title} (A/B)`,
      brief: "",
      data: src.data,
      parentProjectId: p.parentId,
      filesHash: folderFingerprint(folder),
    });

    try {
      const rows = Object.entries(folder).map(([filePath, content]) => ({
        projectId: copyId,
        path: filePath,
        content,
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(schema.projectFiles).values(rows.slice(i, i + CHUNK));
      }
      await setBranch(parentStore, branch, src.commitOid);
      const own = postgresStore(copyId);
      const born = await own.createRepo(src.commitOid, Object.fromEntries(tree));
      await own.updateRepo(born.version, born.head, born.index, { branch });
    } catch (err) {
      await removeWorktree(copyId).catch(() => undefined);
      throw err;
    }

    return { copyId, branch, base: src.commitOid };
  });
}

export async function commitAbWorktree(
  copyId: string,
  ownerId: string,
  experimentId: string,
): Promise<string> {
  return commitLeftovers(copyId, ownerId, `A/B Variant B (${experimentId})`);
}

export async function cleanupAbWorktree(p: {
  parentId: string;
  copyProjectId: string | null;
  branch: string | null;
}): Promise<void> {
  if (p.copyProjectId) {
    await removeWorktree(p.copyProjectId).catch(() => undefined);
  }
  if (p.branch) {
    await deleteBranch(p.parentId, p.branch).catch(() => undefined);
  }
}

export type AbBringResult =
  | { readonly kind: "brought" }
  | { readonly kind: "nothing" }
  /** A Len turn is live in the project: it would be editing the very files being merged, so nothing was touched. */
  | { readonly kind: "busy" }
  | { readonly kind: "conflict"; readonly paths: readonly string[] };

/** Three-way merge Variant B's branch (`base` -> `tip`) into the owner's draft
 *  without touching unrelated in-progress edits. Never leaves conflict markers. While Len has a turn live in the project
 *  it merges NOTHING (`busy`): two writers on the same files is what the draft's compare-and-swap exists to catch, and
 *  a merge that loses that race half-applies (review item 26). Like Len Watch's «Traer el arreglo», the caller waits. */
export async function mergeWinnerIntoDraft(p: {
  projectId: string;
  ownerId: string;
  actorId: string;
  baseCommitOid: string;
  branch: string;
}): Promise<AbBringResult> {
  const { hayTurnoVivoEnElProyecto } = await import("@/lib/agent/direcciones");
  if (hayTurnoVivoEnElProyecto(p.projectId)) return { kind: "busy" };
  const tip = await branchTip(p.projectId, p.branch);
  if (!tip) return { kind: "nothing" };

  const repo = new Repository(postgresStore(p.projectId));
  const [baseCommit, tipCommit] = await Promise.all([
    repo.commit(p.baseCommitOid),
    repo.commit(tip),
  ]);
  const [baseFiles, theirFiles] = await Promise.all([
    repo.files(baseCommit.tree),
    repo.files(tipCommit.tree),
  ]);
  const toAbsMap = (m: ReadonlyMap<string, string>) =>
    new Map([...m].map(([repoPath, oid]) => [toAbsolute(repoPath), oid]));
  const ours = await draftTree(p.projectId);
  const plan = await planBring(
    toAbsMap(baseFiles),
    ours.oids,
    toAbsMap(theirFiles),
    async (oid) => ours.texts.get(oid) ?? repo.text(oid),
  );

  if (plan.kind === "nothing") return { kind: "nothing" };
  if (plan.kind === "conflict") return { kind: "conflict", paths: plan.paths };

  const draft = await draftFiles(p.projectId);
  const [{ guardarLoDeLaTerminal }, { realDeps }] = await Promise.all([
    import("@/lib/agent/herramientas-de-ficheros"),
    import("@/lib/agent/tools"),
  ]);
  const session = {
    projectId: p.projectId,
    userId: p.ownerId,
    ...(p.actorId !== p.ownerId ? { personId: p.actorId } : {}),
    autor: "usuario" as const,
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
  const cambios = [...plan.writes].map(([ruta, contenido]) =>
    contenido === null
      ? { tipo: "borrado" as const, ruta }
      : { tipo: "escrito" as const, ruta, contenido, crea: !Object.hasOwn(draft, ruta) },
  );
  const saved = await guardarLoDeLaTerminal(session, realDeps(), cambios, draft);
  if (saved.rechazado) {
    return { kind: "conflict", paths: [...plan.writes.keys()] };
  }
  return { kind: "brought" };
}

export { branchTip, copySources, deleteBranch, removeWorktree };
