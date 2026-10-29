// git's smart HTTP protocol, client side (gitprotocol-http, gitprotocol-v2, gitprotocol-pack), from OpenLen's server:
// upload-pack with protocol v2 (ls-refs, fetch) and receive-pack, which has no v2 (the v0 advertisement, then the
// commands with report-status and a pack). Only the server calls it; a token never reaches the sandbox or Len.
import "server-only";

import type { GitObject } from "../objects";
import { NULL_OID } from "../objects";
import { RemoteError, failedAnswer, remoteRequest } from "./http";
import { readPack } from "./pack-read";
import { writePack } from "./pack-write";
import { DELIM, FLUSH, concat, encodePkts, lineOf, readPkts, type Pkt } from "./pkt-line";

export { RemoteError } from "./http";

export interface RemoteRef {
  readonly name: string;
  readonly oid: string;
  /** For HEAD: the branch it points at. */
  readonly symref?: string;
  /** For an annotated tag: the commit it points at. */
  readonly peeled?: string;
}

const base = (url: string) => url.replace(/\/+$/, "");
const V2 = { "Git-Protocol": "version=2" };

/** POST of a protocol-v2 command to upload-pack. */
async function uploadPack(url: string, auth: string | null, command: string, args: readonly string[]): Promise<Pkt[]> {
  const body = encodePkts([`command=${command}\n`, "agent=git/2.45.2-openlen\n", "object-format=sha1\n", DELIM, ...args.map((a) => `${a}\n`), FLUSH]);
  const answer = await remoteRequest(`${base(url)}/git-upload-pack`, {
    method: "POST",
    auth,
    headers: { ...V2, "Content-Type": "application/x-git-upload-pack-request", Accept: "application/x-git-upload-pack-result" },
    body,
  });
  if (answer.status !== 200) throw failedAnswer(url, answer);
  return [...readPkts(answer.body)];
}

/** The capability advertisement: checks the remote speaks smart HTTP (and v2, for upload-pack). */
async function advertisement(url: string, auth: string | null, service: "git-upload-pack" | "git-receive-pack"): Promise<Pkt[]> {
  const answer = await remoteRequest(`${base(url)}/info/refs?service=${service}`, { method: "GET", auth, headers: service === "git-upload-pack" ? V2 : {} });
  if (answer.status !== 200) throw failedAnswer(url, answer);
  if (!answer.contentType.startsWith(`application/x-${service}-advertisement`)) {
    throw new RemoteError("protocol", url, `the remote at '${url}' doesn't speak git's smart HTTP protocol`);
  }
  const pkts = [...readPkts(answer.body)];
  // v0 (and receive-pack) starts with "# service=<service>" and a flush.
  if (lineOf(pkts[0]!) === `# service=${service}`) return pkts.slice(2);
  return pkts;
}

/** `ls-refs` (protocol v2): HEAD, the branches and the tags, with HEAD's symref and each annotated tag peeled. */
export async function lsRefs(url: string, auth: string | null): Promise<RemoteRef[]> {
  const caps = await advertisement(url, auth, "git-upload-pack");
  if (lineOf(caps[0]!) !== "version 2") throw new RemoteError("protocol", url, `the remote at '${url}' doesn't speak protocol v2`);
  const refs: RemoteRef[] = [];
  for (const p of await uploadPack(url, auth, "ls-refs", ["peel", "symrefs", "ref-prefix HEAD", "ref-prefix refs/heads/", "ref-prefix refs/tags/"])) {
    const line = lineOf(p);
    if (line === null) continue;
    const [oid, name, ...attrs] = line.split(" ");
    if (!oid || !name || oid === "unborn") continue;
    const symref = attrs.find((a) => a.startsWith("symref-target:"))?.slice("symref-target:".length);
    const peeled = attrs.find((a) => a.startsWith("peeled:"))?.slice("peeled:".length);
    refs.push({ name, oid, ...(symref ? { symref } : {}), ...(peeled ? { peeled } : {}) });
  }
  return refs;
}

/** `fetch` (protocol v2) of `wants`, telling the remote what we already have: the objects it sends, deltas resolved
 *  (against `have` for a thin pack's bases — we never ask for one, so none should need it). */
export async function fetchPack(url: string, auth: string | null, p: { readonly wants: readonly string[]; readonly haves: readonly string[]; readonly have?: (oid: string) => Promise<GitObject | undefined> }): Promise<GitObject[]> {
  if (p.wants.length === 0) return [];
  const args = ["ofs-delta", "no-progress", ...p.wants.map((w) => `want ${w}`), ...p.haves.map((h) => `have ${h}`), "done"];
  const pkts = await uploadPack(url, auth, "fetch", args);
  const pack: Uint8Array[] = [];
  let inPack = false;
  for (const pk of pkts) {
    if (!inPack) {
      if (lineOf(pk) === "packfile") inPack = true;
      continue;
    }
    if (pk.kind !== "data") break;
    // Side band: 1 the pack, 2 progress, 3 a fatal error.
    const band = pk.data[0];
    if (band === 1) pack.push(pk.data.subarray(1));
    else if (band === 3) throw new RemoteError("protocol", url, `remote error: ${new TextDecoder().decode(pk.data.subarray(1)).trim()}`);
  }
  if (!inPack) throw new RemoteError("protocol", url, `the remote at '${url}' sent no packfile`);
  return readPack(concat(pack), p.have ?? (async () => undefined));
}

export interface RefUpdate {
  readonly ref: string;
  /** What the remote has now (NULL_OID if the ref is new). */
  readonly old: string;
  /** What it gets (NULL_OID deletes it). */
  readonly new: string;
}

/** `receive-pack`: the updates and a pack of `objects`; each ref's status as the remote reports it ("ok", or why not:
 *  "non-fast-forward", "fetch first"…). */
export async function receivePack(url: string, auth: string | null, p: { readonly updates: readonly RefUpdate[]; readonly objects: readonly GitObject[] }): Promise<{ ok: boolean; refs: { ref: string; status: string }[] }> {
  const adv = await advertisement(url, auth, "git-receive-pack");
  const first = adv[0]?.kind === "data" ? new TextDecoder().decode(adv[0].data) : "";
  const caps = new Set((first.split("\0")[1] ?? "").trim().split(" "));
  if (!caps.has("report-status")) throw new RemoteError("protocol", url, `the remote at '${url}' doesn't report push status`);
  const wanted = ["report-status", ...(caps.has("delete-refs") ? ["delete-refs"] : []), "agent=git/2.45.2-openlen"].join(" ");
  const commands = p.updates.map((u, i) => `${u.old} ${u.new} ${u.ref}${i === 0 ? `\0${wanted}` : ""}\n`);
  const onlyDeletes = p.updates.every((u) => u.new === NULL_OID);
  const body = concat([encodePkts([...commands, FLUSH]), ...(onlyDeletes ? [] : [writePack(p.objects)])]);
  const answer = await remoteRequest(`${base(url)}/git-receive-pack`, {
    method: "POST",
    auth,
    headers: { "Content-Type": "application/x-git-receive-pack-request", Accept: "application/x-git-receive-pack-result" },
    body,
  });
  if (answer.status !== 200) throw failedAnswer(url, answer);
  const refs: { ref: string; status: string }[] = [];
  let unpack = "";
  for (const pk of readPkts(answer.body)) {
    const line = lineOf(pk);
    if (line === null) continue;
    if (line.startsWith("unpack ")) unpack = line.slice("unpack ".length);
    else if (line.startsWith("ok ")) refs.push({ ref: line.slice(3), status: "ok" });
    else if (line.startsWith("ng ")) {
      const rest = line.slice(3);
      const space = rest.indexOf(" ");
      refs.push({ ref: rest.slice(0, space), status: rest.slice(space + 1) });
    }
  }
  if (unpack !== "ok") throw new RemoteError("protocol", url, `remote unpack failed: ${unpack || "no answer"}`);
  return { ok: refs.length === p.updates.length && refs.every((r) => r.status === "ok"), refs };
}
