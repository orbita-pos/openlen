// A GitStore in memory, for tests and for the differential harness.
import type { GitObject } from "./objects";
import type { Branching, GitStore, Index, RepoState } from "./store";

export function memoryStore(): GitStore & { readonly objects: ReadonlyMap<string, GitObject> } {
  const objects = new Map<string, GitObject>();
  let repo: RepoState | null = null;
  return {
    objects,
    async readRepo() {
      return repo;
    },
    async createRepo(head: string, index: Index) {
      repo ??= { head, index, version: 0, branch: "main", refs: { main: head } };
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
    async updateRepo(expectedVersion: number, head: string, index: Index, branching?: Branching) {
      if (!repo || repo.version !== expectedVersion) return null;
      const branch = branching?.branch ?? repo.branch;
      repo = { head, index, version: expectedVersion + 1, branch, refs: { ...(branching?.refs ?? repo.refs), [branch]: head } };
      return repo;
    },
  };
}
