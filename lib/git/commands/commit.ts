// `git commit`: what's staged (or -a, or only the named paths), the message cleaned up like -m,
// the person as author and committer, and git's summary. Never --amend (spec §4).
import { blobForContent } from "../content";
import path from "node:path";
import { signatureOf, type Command, type CommandContext } from "../command";
import { abbrev, fileDiff, summaryLine } from "../diff";
import { GitFatal, INDEX_LOCKED, notAvailable, pathspecDidNotMatch } from "../errors";
import { cleanupMessage, subjectOf, withSignoff } from "../format";
import { compareNames, encodeCommit, makeObject, type GitObject } from "../objects";
import { parseOptions } from "../options";
import { matchesPathspec, quotePath, resolveFromCwd } from "../paths";
import { buildTree } from "../repository";
import { changedFiles } from "../sources";
import type { Index } from "../store";
import { unmergedFiles } from "./merge";
import { REWRITE } from "./reset";
import { longStatus, readStatus } from "./status";

/** `authorDate`: git's sequencer (revert) adds " Date: <author date>" under the subject. */
export async function commitSummary(ctx: CommandContext, before: ReadonlyMap<string, string>, after: Index, oid: string, message: string, authorDate?: string): Promise<string> {
  const text = (_p: string, o: string) => ctx.repo.text(o);
  const files = await changedFiles({ files: before, text }, { files: new Map(Object.entries(after)), text });
  const entries = files.map((f) => {
    const d = fileDiff(f.from, f.to);
    return { path: f.path, added: d.added, deleted: d.deleted };
  });
  let out = `[${ctx.state.branch} ${abbrev(oid)}] ${subjectOf(message)}\n`;
  if (authorDate !== undefined) out += ` Date: ${authorDate}\n`;
  if (entries.length > 0) out += `${summaryLine(entries)}\n`;
  for (const f of files) {
    if (f.from.oid === null) out += ` create mode 100644 ${quotePath(f.path)}\n`;
    else if (f.to.oid === null) out += ` delete mode 100644 ${quotePath(f.path)}\n`;
  }
  return out;
}

export const commit: Command = async (ctx, args) => {
  const o = parseOptions(args, {
    flags: ["-a", "--all", "-q", "--quiet", "-v", "--verbose", "--allow-empty", "--amend", "-n", "--no-verify", "-s", "--signoff", "--no-edit", "-e", "--edit", "--dry-run", "--no-gpg-sign"],
    values: ["-m", "--message", "-F", "--file", "--author", "--date", "--cleanup", "-C", "-c", "--fixup", "--squash"],
    repeated: ["-m", "--message"],
  });
  if (o.has("--amend")) return notAvailable("commit --amend", REWRITE);
  if (o.has("--author")) return notAvailable("commit --author", "the author is always the person who asked for the commit.");
  for (const opt of ["-C", "-c", "--fixup", "--squash", "--date"]) if (o.has(opt)) return notAvailable(`commit ${opt}`, 'commit with -m "<message>".');

  const head = await ctx.repo.filesOfCommit(ctx.state.head);
  const nextIndex: Record<string, string> = { ...ctx.state.index };
  const blobs: GitObject[] = [];
  const typed = [...o.positional, ...(o.afterDashDash ?? [])];
  const merging = ctx.state.merge;
  if (merging) {
    if (typed.length > 0) throw new GitFatal("fatal: cannot do a partial commit during a merge.\n");
    // -a stages every tracked file, which resolves them; otherwise each unmerged path needs its git add first.
    const unmerged = o.has("-a") || o.has("--all") ? [] : Object.keys(merging.conflicts).sort(compareNames);
    if (unmerged.length > 0) throw new GitFatal(unmergedFiles("Committing"), 128, unmerged.map((p) => `U\t${p}\n`).join(""));
  }
  let committed: Record<string, string>;
  if (typed.length > 0) {
    // Only the named tracked paths, as they are in the working tree; other staged changes stay staged.
    committed = Object.fromEntries(head);
    for (const arg of typed) {
      const spec = resolveFromCwd(ctx.cwd, arg);
      let matched = false;
      for (const p of new Set([...Object.keys(nextIndex), ...head.keys()])) {
        if (!matchesPathspec(spec, p)) continue;
        matched = true;
        const content = ctx.tree.files.get(p);
        if (content === undefined) {
          delete committed[p];
          delete nextIndex[p];
        } else {
          const blob = blobForContent(content);
          blobs.push(blob);
          committed[p] = blob.oid;
          nextIndex[p] = blob.oid;
        }
      }
      if (!matched) throw pathspecDidNotMatch(arg);
    }
  } else {
    if (o.has("-a") || o.has("--all")) {
      for (const p of Object.keys(nextIndex)) {
        const content = ctx.tree.files.get(p);
        if (content === undefined) delete nextIndex[p];
        else {
          const blob = blobForContent(content);
          if (blob.oid !== nextIndex[p]) {
            blobs.push(blob);
            nextIndex[p] = blob.oid;
          }
        }
      }
    }
    committed = nextIndex;
  }

  const { root, objects } = buildTree(committed);
  const withIndex = { ...ctx, state: { ...ctx.state, index: nextIndex } };
  if (o.has("--dry-run")) return { stdout: longStatus(withIndex, await readStatus(withIndex)), stderr: "", exitCode: 0 };
  // A merge commit can keep HEAD's tree: it records that the other side is in.
  if (!merging && root === (await ctx.repo.commit(ctx.state.head)).tree && !o.has("--allow-empty")) {
    // Nothing to commit: git prints the status and exits 1 — before it looks at the message.
    return { stdout: longStatus(withIndex, await readStatus(withIndex)), stderr: "", exitCode: 1 };
  }

  let text: string;
  const messages = [...o.all("-m"), ...o.all("--message")];
  const file = o.value("-F") ?? o.value("--file");
  if (messages.length > 0) text = messages.join("\n\n");
  else if (file !== undefined) {
    if (file === "-") return notAvailable("commit -F -", "pass the message with -m (a heredoc works).");
    const content = ctx.absoluteFiles[path.posix.resolve("/", ctx.cwd, file)];
    if (content === undefined) throw new GitFatal(`fatal: could not read log file '${file}': No such file or directory\n`);
    text = content;
  } else if (merging && o.has("--no-edit")) {
    // git's MERGE_MSG, cleaned up like -m: its "# Conflicts:" lines stay, as they do in git without an editor.
    text = merging.message;
  } else {
    return { stdout: "", stderr: "error: there is no editor here.\nPlease supply the message using either -m or -F option.\n", exitCode: 1 };
  }
  let message = cleanupMessage(text);
  if (message && (o.has("-s") || o.has("--signoff"))) message = withSignoff(message, ctx.identity);
  if (!message) return { stdout: "", stderr: "Aborting commit due to empty commit message.\n", exitCode: 1 };

  const sig = signatureOf(ctx.identity, ctx.now);
  const parents = merging ? [ctx.state.head, merging.theirs] : [ctx.state.head];
  const created = makeObject("commit", encodeCommit({ tree: root, parents, author: sig, committer: sig, message }));
  await ctx.repo.store.writeObjects([...blobs, ...objects, created]);
  if (!(await ctx.save(created.oid, nextIndex, undefined, merging ? null : undefined))) throw new GitFatal(INDEX_LOCKED);
  if (o.has("-q") || o.has("--quiet")) return { stdout: "", stderr: "", exitCode: 0 };
  // git shows no diff for a merge commit: only its line.
  if (merging) return { stdout: `[${ctx.state.branch} ${abbrev(created.oid)}] ${subjectOf(message)}\n`, stderr: "", exitCode: 0 };
  return { stdout: await commitSummary(ctx, head, committed, created.oid, message), stderr: "", exitCode: 0 };
};
