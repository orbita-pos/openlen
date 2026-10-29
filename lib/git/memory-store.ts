// A GitStore in memory, for tests and for the differential harness.
import type { GitObject } from "./objects";
import { applyChanges, type GitStore, type Index, type RepoChanges, type RepoState } from "./store";

export function memoryStore(): GitStore & { readonly objects: ReadonlyMap<string, GitObject> } {
  const objects = new Map<string, GitObject>();
  let repo: RepoState | null = null;
  return {
    objects,
    async readRepo() {
      return repo;
    },
    async createRepo(head: string, index: Index) {
      repo ??= { head, index, version: 0, branch: "main", refs: { main: head }, merge: null, remotes: {}, upstreams: {} };
      return repo;
    },
    async readObjects(oids: readonly string[]) {
      const out = new Map<string, GitObject>();
      for (const oid of oids) {
        const found = objects.get(oid);
        if (found) out.set(oid, found);
      }
      return out;
    },
    async writeObjects(list: readonly GitObject[]) {
      for (const o of list) objects.set(o.oid, o);
    },
    async findByPrefix(prefix: string) {
      return [...objects.keys()].filter((oid) => oid.startsWith(prefix)).slice(0, 2);
    },
    async updateRepo(expectedVersion: number, head: string, index: Index, changes?: RepoChanges) {
      if (!repo || repo.version !== expectedVersion) return null;
      repo = applyChanges(repo, head, index, expectedVersion + 1, changes);
      return repo;
    },
  };
}
