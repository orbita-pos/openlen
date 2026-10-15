// Reading a repository through its store: objects (cached, they never change), the files under a
// tree, and the history. `buildTree` makes the tree objects for a set of files.
import { GitFatal } from "./errors";
import {
  decodeCommit,
  decodeTree,
  encodeTree,
  fromUtf8,
  makeObject,
  type Commit,
  type GitObject,
  type TreeEntry,
} from "./objects";
import type { GitStore, Index } from "./store";

export class Repository {
  private readonly cache = new Map<string, GitObject>();

  constructor(readonly store: GitStore) {}

  async objects(oids: readonly string[]): Promise<Map<string, GitObject>> {
    const missing = [...new Set(oids.filter((oid) => !this.cache.has(oid)))];
    if (missing.length > 0) for (const [oid, o] of await this.store.readObjects(missing)) this.cache.set(oid, o);
    const out = new Map<string, GitObject>();
    for (const oid of oids) {
      const found = this.cache.get(oid);
      if (!found) throw new GitFatal(`fatal: bad object ${oid}\n`);
      out.set(oid, found);
    }
    return out;
  }

  async object(oid: string): Promise<GitObject> {
    return (await this.objects([oid])).get(oid)!;
  }

  async commit(oid: string): Promise<Commit> {
    const o = await this.object(oid);
    if (o.type !== "commit") throw new GitFatal(`fatal: ${oid} is not a commit\n`);
    return decodeCommit(o.content);
  }

  async text(oid: string): Promise<string> {
    return fromUtf8((await this.object(oid)).content);
  }

  /** Every file under a tree: repository path → blob oid, in git's order. */
  async files(treeOid: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const walk = async (oid: string, prefix: string): Promise<void> => {
      const entries = decodeTree((await this.object(oid)).content);
      await this.objects(entries.filter((e) => e.mode === "40000").map((e) => e.oid));
      for (const e of entries) {
        if (e.mode === "40000") await walk(e.oid, `${prefix}${e.name}/`);
        else out.set(`${prefix}${e.name}`, e.oid);
      }
    };
    await walk(treeOid, "");
    return out;
  }

  async filesOfCommit(commitOid: string): Promise<Map<string, string>> {
    return this.files((await this.commit(commitOid)).tree);
  }

  /** `from` and its ancestors, newest first. OpenLen's history is a line: one parent each. */
  async *history(from: string): AsyncGenerator<{ oid: string; commit: Commit }> {
    let oid: string | undefined = from;
    while (oid) {
      const commit = await this.commit(oid);
      yield { oid, commit };
      oid = commit.parents[0];
    }
  }
}

type Dir = Map<string, Dir | string>;

/** The tree objects for a set of files (path → blob oid). Pure. */
export function buildTree(files: Index | ReadonlyMap<string, string>): { root: string; objects: GitObject[] } {
  const root: Dir = new Map();
  const entries = files instanceof Map ? [...files] : Object.entries(files as Index);
  for (const [p, oid] of entries) {
    const parts = p.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.get(part);
      if (typeof next !== "object") {
        next = new Map();
        dir.set(part, next);
      }
      dir = next;
    }
    dir.set(parts.at(-1)!, oid);
  }
  const objects: GitObject[] = [];
  const write = (dir: Dir): string => {
    const tree: TreeEntry[] = [...dir].map(([name, v]) =>
      typeof v === "string" ? { name, mode: "100644" as const, oid: v } : { name, mode: "40000" as const, oid: write(v) },
    );
    const obj = makeObject("tree", encodeTree(tree));
    objects.push(obj);
    return obj.oid;
  };
  return { root: write(root), objects };
}
