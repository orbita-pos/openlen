// What fetch, pull and push share (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §8): which URLs a remote may
// have, the credentials (the server's, per request, never stored), fetching a remote into its remote-tracking
// branches, how far a branch is from its upstream, which objects a push sends, and git's words for each failure.
import { isBinaryBytes, BLOB_PREFIX } from "@/lib/files/blob-pointer";
import { decideEgress } from "@/lib/security/egress-proxy";

import type { CommandContext } from "./command";
import { abbrev } from "./diff";
import { GitFatal } from "./errors";
import { decodeTree, type GitObject } from "./objects";
import { RemoteError } from "./remote/http";
import { fetchPack, lsRefs, type RemoteRef } from "./remote/smart-http";
import type { Remote } from "./store";

/** Why OpenLen won't keep `raw` as a remote's URL, or null if it will. https only (http only for a loopback origin the
 *  server let through, which is what the tests are); no credentials inside it; no private or internal address. */
export async function refusedRemoteUrl(raw: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `fatal: '${raw}' is not a URL OpenLen's git can use: remotes are https:// addresses (https://github.com/<owner>/<repo>.git)\n`;
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "127.0.0.1")) {
    return `fatal: OpenLen's git talks to remotes over https:// only, not ${u.protocol.replace(/:$/, "")}: ${raw}\n`;
  }
  if (u.username || u.password) return "fatal: a remote's URL can't carry credentials here; connect GitHub instead (Publish → Export → Connect GitHub).\n";
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!(await decideEgress(u.hostname, port)).ok) return `fatal: OpenLen's server doesn't connect to private or internal addresses: ${u.hostname}\n`;
  return null;
}

/** git's "From <url>" drops a trailing ".git" and slashes. */
export function displayUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.git$/, "");
}

/** Where the owner connects GitHub, for the messages that need it. */
export const CONNECT_GITHUB = "To connect GitHub: Publish → Export → Connect GitHub (the project's owner).\n";

const isGitHub = (url: string) => {
  try {
    return new URL(url).hostname === "github.com";
  } catch {
    return false;
  }
};

/** A RemoteError in git's words (with GIT_TERMINAL_PROMPT=0, as a sandbox has no terminal to ask in). */
export function remoteFatal(e: unknown, url: string, hadAuth: boolean): GitFatal {
  if (!(e instanceof RemoteError)) throw e;
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  })();
  const connect = isGitHub(url) ? CONNECT_GITHUB : "";
  switch (e.kind) {
    case "auth":
      return new GitFatal(hadAuth ? `fatal: Authentication failed for '${url}/'\n${connect}` : `fatal: could not read Username for '${origin}': terminal prompts disabled\n${connect}`);
    case "not-found":
      return new GitFatal(`fatal: repository '${url}/' not found\n`);
    case "blocked":
      return new GitFatal(`fatal: unable to access '${url}/': OpenLen's server doesn't connect to private or internal addresses\n`);
    case "network":
    case "http":
      return new GitFatal(`fatal: unable to access '${url}/': ${e.message}\n`);
    default:
      return new GitFatal(`fatal: ${e.message}\n`);
  }
}

/** git's error for a remote name that isn't configured. */
export function noSuchRemote(name: string): GitFatal {
  return new GitFatal(
    `fatal: '${name}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n`,
  );
}

export async function credentials(ctx: CommandContext, url: string): Promise<string | null> {
  return (await ctx.remoteAuth?.(url)) ?? null;
}

/** The remote's branches and tags, or git's error. */
export async function remoteRefs(ctx: CommandContext, url: string): Promise<RemoteRef[]> {
  const auth = await credentials(ctx, url);
  try {
    return await lsRefs(url, auth);
  } catch (e) {
    throw remoteFatal(e, url, auth !== null);
  }
}

/** A fetched blob as OpenLen keeps it: a binary goes to storage and stays as an external blob, like the folder's. */
async function stored(o: GitObject): Promise<GitObject> {
  if (o.type !== "blob" || o.external) return o;
  const binary = isBinaryBytes(o.content) || new TextDecoder().decode(o.content.subarray(0, BLOB_PREFIX.length)) === BLOB_PREFIX;
  if (!binary) return o;
  const { putBlob } = await import("@/lib/files/blob");
  const ref = await putBlob(o.content);
  if (ref.gitOid !== o.oid) throw new GitFatal(`fatal: the blob ${o.oid} doesn't hash to its id\n`);
  return { oid: o.oid, type: "blob", content: new Uint8Array(0), external: ref };
}

/** Which of `oids` the repository has. */
export async function present(ctx: CommandContext, oids: readonly string[]): Promise<Set<string>> {
  return new Set((await ctx.repo.store.readObjects([...new Set(oids)])).keys());
}

/** One line of a fetch, as git aligns them: code, summary (17 wide), the remote's branch (10 wide at least). */
function fetchLine(code: string, summary: string, from: string, width: number, to: string, suffix = ""): string {
  return ` ${code} ${summary.padEnd(17)} ${from.padEnd(width)} -> ${to}${suffix}\n`;
}

export interface Fetched {
  /** What git prints on stderr (nothing when nothing changed). */
  readonly stderr: string;
  /** The remotes with this one's remote-tracking branches updated: what to save. */
  readonly remotes: Readonly<Record<string, Remote>>;
}

/** git fetch <name>: the remote's branches into refs/remotes/<name>/*, their objects into the repository. `explicit`:
 *  the branch `git pull <remote> <branch>` named, which git lists as `-> FETCH_HEAD`. Tags are not fetched. */
export async function fetchRemote(ctx: CommandContext, name: string, explicit?: string): Promise<Fetched> {
  const remote = ctx.state.remotes[name];
  if (!remote) throw noSuchRemote(name);
  const auth = await credentials(ctx, remote.url);
  let refs: RemoteRef[];
  try {
    refs = await lsRefs(remote.url, auth);
  } catch (e) {
    throw remoteFatal(e, remote.url, auth !== null);
  }
  const heads = new Map(refs.filter((r) => r.name.startsWith("refs/heads/")).map((r) => [r.name.slice("refs/heads/".length), r.oid]));
  if (explicit !== undefined && !heads.has(explicit)) throw new GitFatal(`fatal: couldn't find remote ref ${explicit}\n`);
  const have = await present(ctx, [...heads.values()]);
  const wants = [...new Set([...heads.values()].filter((oid) => !have.has(oid)))];
  if (wants.length > 0) {
    const ours = [...Object.values(ctx.state.refs), ...Object.values(remote.refs)];
    const haves = [...(await present(ctx, ours))];
    let objects: GitObject[];
    try {
      objects = await fetchPack(remote.url, auth, { wants, haves, have: async (oid) => (await ctx.repo.store.readObjects([oid])).get(oid) });
    } catch (e) {
      throw remoteFatal(e, remote.url, auth !== null);
    }
    const keep: GitObject[] = [];
    for (const o of objects) keep.push(await stored(o));
    await ctx.repo.store.writeObjects(keep);
  }
  const width = Math.max(10, ...[...heads.keys()].map((b) => b.length));
  let lines = explicit !== undefined ? fetchLine("*", "branch", explicit, width, "FETCH_HEAD") : "";
  for (const [branch, oid] of [...heads].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const old = remote.refs[branch];
    const to = `${name}/${branch}`;
    if (old === oid) continue;
    if (old === undefined) lines += fetchLine("*", "[new branch]", branch, width, to);
    else if (await ctx.repo.isAncestor(old, oid)) lines += fetchLine(" ", `${abbrev(old)}..${abbrev(oid)}`, branch, width, to);
    else lines += fetchLine("+", `${abbrev(old)}...${abbrev(oid)}`, branch, width, to, "  (forced update)");
  }
  const remotes = { ...ctx.state.remotes, [name]: { url: remote.url, refs: { ...remote.refs, ...Object.fromEntries(heads) } } };
  return { stderr: lines ? `From ${displayUrl(remote.url)}\n${lines}` : "", remotes };
}

/** How many commits `a` has that `b` hasn't, and the other way round. */
export async function aheadBehind(ctx: CommandContext, a: string, b: string): Promise<{ ahead: number; behind: number }> {
  const fromA = new Set<string>();
  for await (const { oid } of ctx.repo.walk([a])) fromA.add(oid);
  const fromB = new Set<string>();
  for await (const { oid } of ctx.repo.walk([b])) fromB.add(oid);
  let ahead = 0;
  let behind = 0;
  for (const oid of fromA) if (!fromB.has(oid)) ahead++;
  for (const oid of fromB) if (!fromA.has(oid)) behind++;
  return { ahead, behind };
}

/** A branch's upstream and where it stands, for status and branch -vv; null without one. `gone`: the remote-tracking
 *  branch isn't there. */
export async function tracking(ctx: CommandContext, branch: string): Promise<{ upstream: string; ahead: number; behind: number; gone: boolean } | null> {
  const up = ctx.state.upstreams[branch];
  if (!up) return null;
  const upstream = `${up.remote}/${up.branch}`;
  const theirs = ctx.state.remotes[up.remote]?.refs[up.branch];
  const local = ctx.state.refs[branch];
  if (theirs === undefined || local === undefined) return { upstream, ahead: 0, behind: 0, gone: true };
  return { upstream, ...(await aheadBehind(ctx, local, theirs)), gone: false };
}

/** Every object `tip` needs that `known` (commits the remote has, as far as we know) don't: what a push packs, with an
 *  external blob's bytes read back from storage. */
export async function objectsToPush(ctx: CommandContext, tip: string, known: readonly string[]): Promise<GitObject[]> {
  const knownCommits = new Set<string>();
  for await (const { oid } of ctx.repo.walk([...(await present(ctx, known))])) knownCommits.add(oid);
  const seen = new Set<string>();
  const markTree = async (oid: string): Promise<void> => {
    if (seen.has(oid)) return;
    seen.add(oid);
    for (const e of decodeTree((await ctx.repo.object(oid)).content)) {
      if (e.mode === "40000") await markTree(e.oid);
      else seen.add(e.oid);
    }
  };
  for (const oid of knownCommits) await markTree((await ctx.repo.commit(oid)).tree);
  const out: GitObject[] = [];
  const collect = async (oid: string): Promise<void> => {
    if (seen.has(oid)) return;
    seen.add(oid);
    const o = await ctx.repo.object(oid);
    out.push(o);
    if (o.type === "tree") for (const e of decodeTree(o.content)) if (e.mode !== "160000") await collect(e.oid);
  };
  for await (const { oid, commit } of ctx.repo.walk([tip], knownCommits)) {
    out.push(await ctx.repo.object(oid));
    await collect(commit.tree);
  }
  const { getBlob } = await import("@/lib/files/blob");
  return Promise.all(out.map(async (o) => (o.external ? { oid: o.oid, type: o.type, content: await getBlob(o.external) } : o)));
}
