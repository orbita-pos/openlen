// `git revert <commit>...`: a new commit that undoes one, with a three-way merge per file. Where
// git would stop with conflict markers, ours changes nothing and says so (spec §4).
import { blobForContent } from "../content";
import { merge as diff3Merge } from "node-diff3";
import { signatureOf, type Command } from "../command";
import { abbrev, records } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable } from "../errors";
import { formatDate, subjectOf } from "../format";
import { compareNames, encodeCommit, makeObject, type GitObject } from "../objects";
import { parseOptions } from "../options";
import { toAbsolute } from "../paths";
import { buildTree } from "../repository";
import { resolveCommit } from "../revisions";
import { commitSummary } from "./commit";
import { longStatus, readStatus } from "./status";
import { onlyChanged } from "./writes";

export const REVERT_CONFLICT_NOTE =
  "Nothing was changed: OpenLen's git does not leave conflict markers. Edit the files by hand, or bring a version back with git checkout <commit> -- <path>.\n";

type Merged = { readonly conflict: false; readonly text: string | null } | { readonly conflict: "content" | "modify/delete" };

function merge3(ours: string | null, base: string | null, theirs: string | null): Merged {
  if (ours === base) return { conflict: false, text: theirs };
  if (theirs === base) return { conflict: false, text: ours };
  if (ours === theirs) return { conflict: false, text: ours };
  if (ours === null || theirs === null || base === null) return { conflict: "modify/delete" };
  const r = diff3Merge(records(ours), records(base), records(theirs), { excludeFalseConflicts: true });
  return r.conflict ? { conflict: "content" } : { conflict: false, text: r.result.join("") };
}

export const revert: Command = async (ctx, args) => {
  const o = parseOptions(args, { flags: ["-n", "--no-commit", "--no-edit", "-e", "--edit", "-s", "--signoff", "--continue", "--abort", "--skip", "--quit"], values: ["-m", "--mainline"] });
  for (const f of ["--continue", "--abort", "--skip", "--quit"]) if (o.has(f)) return notAvailable(`revert ${f}`, "a revert here never stops halfway: it is done, or nothing changed.");
  if (o.positional.length === 0) throw new GitFatal("usage: git revert [<options>] <commit-ish>...\n", 129);
  const noCommit = o.has("-n") || o.has("--no-commit");
  const headFiles = await ctx.repo.filesOfCommit(ctx.state.head);
  const staged = Object.keys(ctx.state.index).length !== headFiles.size || [...headFiles].some(([p, oid]) => ctx.state.index[p] !== oid);
  if (!noCommit && staged) throw new GitFatal("error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed\n");

  let index: Record<string, string> = { ...ctx.state.index };
  let head = ctx.state.head;
  const objects: GitObject[] = [];
  const write: Record<string, string | null> = {};
  const made: { before: ReadonlyMap<string, string>; after: Record<string, string>; oid: string; message: string }[] = [];
  let stdout = "";
  for (const spec of o.positional) {
    const oid = await resolveCommit(ctx, spec);
    const c = await ctx.repo.commit(oid);
    const theirs = c.parents[0] ? await ctx.repo.filesOfCommit(c.parents[0]) : new Map<string, string>();
    const base = await ctx.repo.files(c.tree);
    const touched = [...new Set([...theirs.keys(), ...base.keys()])].filter((p) => theirs.get(p) !== base.get(p)).sort(compareNames);
    const dirty = touched.filter((p) => {
      const content = ctx.tree.files.get(p);
      return (content === undefined ? undefined : blobForContent(content).oid) !== index[p];
    });
    if (dirty.length > 0) {
      throw new GitFatal(`error: Your local changes to the following files would be overwritten by merge:\n${dirty.map((p) => `\t${p}`).join("\n")}\nPlease commit your changes or stash them before you merge.\nAborting\nfatal: revert failed\n`);
    }
    const text = async (m: ReadonlyMap<string, string>, p: string) => (m.has(p) ? ctx.repo.text(m.get(p)!) : null);
    const next: Record<string, string> = { ...index };
    const conflicts: string[] = [];
    for (const p of touched) {
      const ours = index[p] === undefined ? null : await ctx.repo.text(index[p]!);
      const b = await text(base, p);
      const t = await text(theirs, p);
      if (ours !== null && b !== null && t !== null && ours !== b && t !== b && ours !== t) stdout += `Auto-merging ${p}\n`;
      const r = merge3(ours, b, t);
      if (r.conflict !== false) {
        conflicts.push(
          r.conflict === "content"
            ? `CONFLICT (content): Merge conflict in ${p}\n`
            : `CONFLICT (modify/delete): ${p} deleted in parent of ${abbrev(oid)} (${subjectOf(c.message)}) and modified in HEAD.  Version HEAD of ${p} left in tree.\n`,
        );
      } else if (r.text === null) {
        delete next[p];
        write[toAbsolute(p)] = null;
      } else {
        const blob = blobForContent(r.text);
        objects.push(blob);
        next[p] = blob.oid;
        write[toAbsolute(p)] = r.text;
      }
    }
    if (conflicts.length > 0) {
      return { stdout: stdout + conflicts.join(""), stderr: `error: could not revert ${abbrev(oid)}... ${subjectOf(c.message)}\n${REVERT_CONFLICT_NOTE}`, exitCode: 1 };
    }
    // A deletion the terminal would refuse (a page): refuse the whole revert, or the history would
    // say the file is gone while the project keeps it.
    for (const p of touched) {
      if (index[p] === undefined || next[p] !== undefined) continue;
      const why = ctx.undeletable?.(toAbsolute(p));
      if (why) {
        return { stdout, stderr: `error: could not revert ${abbrev(oid)}... ${subjectOf(c.message)}\nNothing was changed: reverting it would delete ${p}, and ${why}\n`, exitCode: 1 };
      }
    }
    if (!noCommit) {
      const message = `Revert "${subjectOf(c.message)}"\n\nThis reverts commit ${oid}.\n`;
      const { root, objects: trees } = buildTree(next);
      // Already undone: like git, nothing to commit — the status, and exit 1.
      if (root === (await ctx.repo.commit(head)).tree) {
        const withIndex = { ...ctx, state: { ...ctx.state, index: next } };
        return { stdout: stdout + longStatus(withIndex, await readStatus(withIndex)), stderr: "", exitCode: 1 };
      }
      const sig = signatureOf(ctx.identity, ctx.now);
      const created = makeObject("commit", encodeCommit({ tree: root, parents: [head], author: sig, committer: sig, message }));
      objects.push(...trees, created);
      made.push({ before: head === ctx.state.head ? headFiles : new Map(Object.entries(index)), after: next, oid: created.oid, message });
      head = created.oid;
    }
    index = next;
  }
  await ctx.repo.store.writeObjects(objects);
  if (!(await ctx.save(head, index))) throw new GitFatal(INDEX_LOCKED);
  const date = formatDate(signatureOf(ctx.identity, ctx.now), "default", ctx.now);
  for (const m of made) stdout += await commitSummary(ctx, m.before, m.after, m.oid, m.message, date);
  const changed = onlyChanged(ctx, write);
  return { stdout, stderr: "", exitCode: 0, ...(changed ? { write: changed } : {}) };
};
