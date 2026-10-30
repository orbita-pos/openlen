// A project's repository in Postgres (spec §2). Objects are immutable, so they're cached in
// memory by (project, oid); `main` and the index are written with compare-and-swap.
import "server-only";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { makePointer, parsePointer } from "@/lib/files/blob-pointer";
import { ObjectCache } from "./object-cache";
import type { GitObject, ObjectType } from "./objects";
import { applyChanges, type GitStore, type Index, type MergeState, type Remote, type RepoState, type Upstream } from "./store";
import { worktreeStore } from "./worktree-store";
import { rootProject } from "@/lib/projects/root-project";

/** 64 MB for the whole process: a page can weigh half a megabyte, and the box has 3.8 GB. */
const cache = new ObjectCache(64 * 1024 * 1024);
const key = (projectId: string, oid: string) => `${projectId}\0${oid}`;

function remember(projectId: string, o: GitObject): void {
  cache.set(key(projectId, o.oid), o);
}

/** A project's repository: its own, or — for the hidden working copy of a Len Watch fix (`parentProjectId`) — a
 *  worktree of its parent's (lib/git/worktree-store.ts). */
export async function gitStoreFor(projectId: string): Promise<GitStore> {
  const root = await rootProject(projectId);
  return root !== projectId ? worktreeStore(postgresStore(root), postgresStore(projectId)) : postgresStore(projectId);
}

export function postgresStore(projectId: string): GitStore {
  const readRepo = async (): Promise<RepoState | null> => {
    const [r] = await db.select().from(schema.projectGitRepos).where(eq(schema.projectGitRepos.projectId, projectId)).limit(1);
    if (!r) return null;
    const branch = r.currentBranch || "main";
    const refs = r.refs && Object.keys(r.refs).length > 0 ? r.refs : { [branch]: r.head };
    return {
      head: r.head,
      index: r.index as Index,
      version: r.version,
      branch,
      refs,
      merge: (r.mergeState as MergeState | null) ?? null,
      remotes: (r.remotes as Record<string, Remote> | null) ?? {},
      upstreams: (r.upstreams as Record<string, Upstream> | null) ?? {},
    };
  };
  return {
    readRepo,
    async createRepo(head, index) {
      await db.insert(schema.projectGitRepos).values({ projectId, head, index: { ...index }, version: 0, refs: { main: head }, currentBranch: "main" }).onConflictDoNothing();
      const repo = await readRepo();
      if (!repo) throw new Error("the repository could not be created");
      return repo;
    },
    async readObjects(oids) {
      const out = new Map<string, GitObject>();
      const missing: string[] = [];
      for (const oid of oids) {
        const hit = cache.get(key(projectId, oid));
        if (hit) out.set(oid, hit);
        else missing.push(oid);
      }
      for (let i = 0; i < missing.length; i += 500) {
        const rows = await db
          .select({ oid: schema.projectGitObjects.oid, type: schema.projectGitObjects.type, content: schema.projectGitObjects.content, blobPointer: schema.projectGitObjects.blobPointer })
          .from(schema.projectGitObjects)
          .where(and(eq(schema.projectGitObjects.projectId, projectId), inArray(schema.projectGitObjects.oid, missing.slice(i, i + 500))));
        for (const r of rows) {
          const external = r.blobPointer ? parsePointer(r.blobPointer) : null;
          const o: GitObject = { oid: r.oid, type: r.type as ObjectType, content: new Uint8Array(r.content), ...(external ? { external } : {}) };
          remember(projectId, o);
          out.set(r.oid, o);
        }
      }
      return out;
    },
    async writeObjects(objects) {
      const unique = [...new Map(objects.map((o) => [o.oid, o])).values()];
      for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        if (chunk.length === 0) continue;
        await db
          .insert(schema.projectGitObjects)
          .values(chunk.map((o) => ({ projectId, oid: o.oid, type: o.type, content: o.content, blobPointer: o.external ? makePointer(o.external) : null })))
          .onConflictDoNothing();
        for (const o of chunk) remember(projectId, o);
      }
    },
    async findByPrefix(prefix) {
      const rows = await db
        .select({ oid: schema.projectGitObjects.oid })
        .from(schema.projectGitObjects)
        .where(and(eq(schema.projectGitObjects.projectId, projectId), like(schema.projectGitObjects.oid, `${prefix}%`)))
        .limit(2);
      return rows.map((r) => r.oid);
    },
    async updateRepo(expectedVersion, head, index, changes) {
      const before = await readRepo();
      if (!before || before.version !== expectedVersion) return null;
      const next = applyChanges(before, head, index, expectedVersion + 1, changes);
      const rows = await db
        .update(schema.projectGitRepos)
        .set({
          head,
          index: { ...index },
          refs: next.refs,
          currentBranch: next.branch,
          mergeState: next.merge,
          remotes: next.remotes,
          upstreams: next.upstreams,
          version: sql`${schema.projectGitRepos.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.projectGitRepos.projectId, projectId), eq(schema.projectGitRepos.version, expectedVersion)))
        .returning({ version: schema.projectGitRepos.version });
      return rows[0] ? { ...next, version: rows[0].version } : null;
    },
  };
}
