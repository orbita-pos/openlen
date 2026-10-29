// Revisions as git reads them: HEAD, @, a branch, a remote-tracking branch (origin/main), a hash prefix (4+), ~N and
// ^ suffixes, a..b and a...b; and which arguments are revisions and which are paths.
import type { CommandContext } from "./command";
import { GitFatal, unknownRevision } from "./errors";
import { matchesPathspec, resolveFromCwd } from "./paths";

const HEAD_NAMES = new Set(["HEAD", "@"]);

/** A branch by its name, `heads/<name>` or `refs/heads/<name>`; then a remote-tracking one, `origin/main`,
 *  `remotes/origin/main` or `refs/remotes/origin/main`. */
export function branchOf(state: CommandContext["state"], name: string): string | null {
  const bare = name.replace(/^(?:refs\/)?heads\//, "");
  if (Object.hasOwn(state.refs, bare)) return state.refs[bare]!;
  return remoteBranchOf(state, name);
}

/** A remote-tracking branch (`origin/main`, `remotes/origin/main`, `refs/remotes/origin/main`), or null. */
export function remoteBranchOf(state: CommandContext["state"], name: string): string | null {
  const m = /^(?:(?:refs\/)?remotes\/)?([^/]+)\/(.+)$/.exec(name);
  if (!m) return null;
  const refs = state.remotes[m[1]!]?.refs;
  return refs && Object.hasOwn(refs, m[2]!) ? refs[m[2]!]! : null;
}

type Ctx = Pick<CommandContext, "repo" | "state">;

/** The commit a revision names, or null. */
export async function resolveRevision(ctx: Ctx, spec: string): Promise<string | null> {
  const m = /^(.+?)((?:[~^]\d*)*)$/.exec(spec);
  if (!m) return null;
  const base = m[1]!;
  let oid: string | null = null;
  if (HEAD_NAMES.has(base)) oid = ctx.state.head;
  else if (branchOf(ctx.state, base)) oid = branchOf(ctx.state, base);
  else if (/^[0-9a-fA-F]{4,40}$/.test(base)) {
    const found = await ctx.repo.store.findByPrefix(base.toLowerCase());
    if (found.length === 1 && (await ctx.repo.object(found[0]!)).type === "commit") oid = found[0]!;
  }
  for (const op of m[2]!.match(/[~^]\d*/g) ?? []) {
    if (!oid) return null;
    const n = op.length > 1 ? Number(op.slice(1)) : 1;
    if (op[0] === "^") {
      if (n === 0) continue;
      if (n > 1) return null;
      oid = (await ctx.repo.commit(oid)).parents[0] ?? null;
    } else {
      for (let k = 0; k < n && oid; k++) oid = (await ctx.repo.commit(oid)).parents[0] ?? null;
    }
  }
  return oid;
}

export async function resolveCommit(ctx: Ctx, spec: string): Promise<string> {
  const oid = await resolveRevision(ctx, spec);
  if (!oid) throw unknownRevision(spec);
  return oid;
}

export type Revision =
  | { readonly kind: "single"; readonly oid: string }
  | { readonly kind: "range"; readonly from: string; readonly to: string; readonly symmetric: boolean };

async function parseRevision(ctx: Ctx, arg: string): Promise<Revision | null> {
  const range = /^(.*?)(\.\.\.?)(.*)$/.exec(arg);
  if (range && (range[1] || range[3])) {
    const from = range[1] ? await resolveRevision(ctx, range[1]) : ctx.state.head;
    const to = range[3] ? await resolveRevision(ctx, range[3]) : ctx.state.head;
    return from && to ? { kind: "range", from, to, symmetric: range[2] === "..." } : null;
  }
  const oid = await resolveRevision(ctx, arg);
  return oid ? { kind: "single", oid } : null;
}

/** An existing file or folder (or "."): git takes it as a path without "--". */
function isPath(ctx: CommandContext, arg: string): boolean {
  const p = resolveFromCwd(ctx.cwd, arg);
  if (p === "") return true;
  for (const f of ctx.tree.files.keys()) if (matchesPathspec(p, f)) return true;
  for (const f of Object.keys(ctx.state.index)) if (matchesPathspec(p, f)) return true;
  return false;
}

export async function revisionsAndPaths(
  ctx: CommandContext,
  positional: readonly string[],
  afterDashDash: readonly string[] | null,
): Promise<{ revisions: Revision[]; paths: string[] }> {
  const revisions: Revision[] = [];
  const paths: string[] = [];
  for (let i = 0; i < positional.length; i++) {
    const arg = positional[i]!;
    const rev = await parseRevision(ctx, arg);
    if (rev) {
      revisions.push(rev);
      continue;
    }
    if (afterDashDash !== null) throw new GitFatal(`fatal: bad revision '${arg}'\n`);
    const bad = positional.slice(i).find((a) => !isPath(ctx, a));
    if (bad !== undefined) throw unknownRevision(bad);
    paths.push(...positional.slice(i).map((a) => resolveFromCwd(ctx.cwd, a)));
    break;
  }
  for (const a of afterDashDash ?? []) paths.push(resolveFromCwd(ctx.cwd, a));
  return { revisions, paths };
}

/** git merge-base of two commits (every project's history starts at one "Initial commit", so there always is one). */
export async function mergeBase(ctx: Ctx, a: string, b: string): Promise<string> {
  return (await ctx.repo.mergeBase(a, b)) ?? b;
}
