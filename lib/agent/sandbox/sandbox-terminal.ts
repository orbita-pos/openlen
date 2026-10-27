// The real terminal: `bash` in the project's E2B box (spec local 2026-10-21-real-terminal-e2b, §5–§6).
//
// The saved copy (Postgres) stays the good one. The box is a working copy kept in step by
// manifests (path → sha256): when the turn first uses the box, what changed in the saved copy since
// the box last paused goes in, and from then on "what the box and the saved copy share" IS the saved
// copy. So after every command, anything in the box that differs from that — whether the command
// wrote it or a background job did — comes back in `ficheros`, and herramienta.ts saves it through
// Write's guards exactly as it does for today's terminal; what a guard refuses comes back through
// `poner` and is undone in the box. If both sides changed a file, the saved copy wins.
//
// The commands OpenLen answers (./bridge.ts) leave requests in the box's mailbox
// (/run/openlen/requests); while a command runs this class reads them through E2B, answers, writes
// whatever the answer changed into the box, and only then the response.

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { MAX_FOLDER_FILE_BYTES } from "@/lib/agent/ficheros/folder";
import type { TerminalBackend } from "@/lib/agent/terminal/backend";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, type SalidaDeUnComando } from "@/lib/agent/terminal/terminal";

import { backgroundFinished, backgroundStarted, movedToBackground } from "./background-text";
import { answerBridgeRequest, type BridgeHandlers, type BridgeRequest } from "./bridge";
import type { RunResult, SandboxHandle } from "./driver";
import { diffManifests, type Manifest } from "./manifest";
import { NEVER_IN_BOX, isSyncedPath } from "./paths";
import { BIG_FILE_PREFIX, BOX_BIN, BRIDGE_DIR, PLAYWRIGHT_BROWSERS, PLAYWRIGHT_DIR, PLAYWRIGHT_RESOLVER } from "./template-files";

const REQUESTS = `${BRIDGE_DIR}/requests`;
const RESPONSES = `${BRIDGE_DIR}/responses`;
const ENV_FILE = `${BRIDGE_DIR}/env`;
const CWD_FILE = `${BRIDGE_DIR}/cwd`;
const POLL_MS = 200;
/** Every command's combined output and exit code go here, so one that moves to the background already has its file. */
const JOBS_DIR = "/tmp/bash-tasks";

interface Job {
  readonly command: string;
  readonly pid?: number;
  readonly outputPath: string;
  readonly exitPath: string;
  done: boolean;
}

/** In place of the visitor data, which never enters the box (Jesús, 21/10). */
export const VISITOR_DATA_READMES: Readonly<Record<string, string>> = {
  "/.openlen/bandeja/README.txt":
    "Visitors' form submissions and chat messages are not in this terminal: read them with list_form_submissions and list_messages.\n",
  "/.openlen/resultados/README.txt": "The site's visits are not in this terminal: read them with get_visits.\n",
};

/** Where a read-only file is uploaded; the path Len reads is a read-only bind of it. */
export function readOnlySource(path: string): string {
  return `${BRIDGE_DIR}/ro${path}`;
}

/** "/.openlen/docs/a.md" → "/.openlen". */
const readOnlyRoot = (path: string) => `/${path.split("/")[1] ?? ""}`;

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

/** The tree a read-only file is in, where it is in the box: /.openlen, or where it is uploaded. */
function treeOf(at: string): string {
  const uploads = readOnlySource("");
  return at.startsWith(`${uploads}/`) ? readOnlySource(readOnlyRoot(at.slice(uploads.length))) : readOnlyRoot(at);
}

/** What is gone, in as few paths as cover it: a folder none of whose files stays goes whole —a version
 *  that rolled off, with its pages—, so no empty folder is left for Len to list (measured 21/10 in a
 *  real box); a tree's root never (it is a mount, or its source). */
export function pathsToRemove(gone: readonly string[], kept: readonly string[]): string[] {
  const keptFolders = new Set<string>();
  for (const k of kept) for (let d = parentOf(k); d; d = parentOf(d)) keptFolders.add(d);
  const tops = new Set<string>();
  for (const g of gone) {
    const tree = treeOf(g);
    let top = g;
    for (let d = parentOf(g); d.length > tree.length && !keptFolders.has(d); d = parentOf(d)) top = d;
    tops.add(top);
  }
  return [...tops].filter((p) => ![...tops].some((q) => p.startsWith(`${q}/`)));
}

/** The platform's variables for every command (plan local 2026-10-21-playwright-in-the-box). In the user's
 *  home, never synced (only ~/.len is). */
export const BASE_ENV_FILE = "/home/user/.openlen-base.env";
const E2B_CA = "/usr/local/share/ca-certificates/e2b-ca.crt";

function baseEnvScript(turn: Readonly<Record<string, string>>): string {
  const fixed: Record<string, string> = {
    PLAYWRIGHT_BROWSERS_PATH: PLAYWRIGHT_BROWSERS,
    // Tests import "@playwright/test": the template's, wherever they are.
    NODE_PATH: `${PLAYWRIGHT_DIR}/node_modules`,
    // Python's requests trusts the system's store, which has E2B's authority.
    REQUESTS_CA_BUNDLE: "/etc/ssl/certs/ca-certificates.crt",
  };
  const lines = Object.entries({ ...fixed, ...turn }).map(([k, v]) => `export ${k}=${quote(v)}`);
  // Node only if the file is there: a missing one makes every `node` print a warning.
  lines.push(`[ -f ${E2B_CA} ] && export NODE_EXTRA_CA_CERTS=${E2B_CA}`);
  // The template's Playwright for a project's ESM too (template-files.ts); once, after what the shell
  // already carries (its own NODE_OPTIONS included), and only if the template has the file: a
  // missing --require stops every `node`.
  const require = `--require=${PLAYWRIGHT_RESOLVER}`;
  lines.push(`[ -f ${PLAYWRIGHT_RESOLVER} ] && case " $NODE_OPTIONS " in *" ${require} "*) ;; *) export NODE_OPTIONS="\${NODE_OPTIONS:+$NODE_OPTIONS }${require}" ;; esac`);
  return `${lines.join("\n")}\n`;
}

/** E2B's proxy authority (it differs per box, measured 21/10) into Chromium's own store (NSS), so a
 *  browser in the box trusts the hosts whose requests E2B rewrites; again only when its fingerprint changed. */
const TRUST_E2B_IN_CHROMIUM = [
  `[ -f ${E2B_CA} ] && command -v certutil >/dev/null`,
  `F=$(sha256sum ${E2B_CA} | cut -c1-64)`,
  `[ "$(cat ${BRIDGE_DIR}/e2b-ca.sha 2>/dev/null)" != "$F" ]`,
  `mkdir -p $HOME/.pki/nssdb`,
  `{ certutil -d sql:$HOME/.pki/nssdb -L >/dev/null 2>&1 || certutil -d sql:$HOME/.pki/nssdb -N --empty-password; }`,
  `{ certutil -d sql:$HOME/.pki/nssdb -D -n e2b-proxy >/dev/null 2>&1; true; }`,
  `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n e2b-proxy -i ${E2B_CA}`,
  `echo "$F" > ${BRIDGE_DIR}/e2b-ca.sha`,
].join(" && ");

/** What the box already has of the read-only files, across turns; outside what Len sees. */
const UPLOADED_FILE = `${BRIDGE_DIR}/ro/.uploaded.json`;
const UNBUNDLE_SCRIPT = `${BRIDGE_DIR}/unbundle.py`;
const BUNDLE_FILE = `${BRIDGE_DIR}/bundle.b64`;
/** Over this many files or bytes, the read-only files go up in one compressed bundle. */
const BUNDLE_OVER_FILES = 20;
const BUNDLE_OVER_BYTES = 256 * 1024;
/** Run with sudo (an unmounted root is root's); what it writes is given to the user who ran it. */
export const UNBUNDLE_PY = `import base64, gzip, json, os, sys
uid = int(os.environ.get("SUDO_UID", os.getuid()))
gid = int(os.environ.get("SUDO_GID", os.getgid()))
files = json.loads(gzip.decompress(base64.b64decode(open(sys.argv[1], "rb").read())).decode("utf-8"))
for path, text in files.items():
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    os.chown(folder, uid, gid)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    os.chown(path, uid, gid)
os.remove(sys.argv[1])
`;

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function manifestOf(tree: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(tree)) if (isSyncedPath(path)) out[path] = sha256(text);
  return out;
}

export interface SandboxTerminalOptions {
  readonly handle: SandboxHandle;
  /** The project's files as saved now (what today's terminal loads). */
  readonly projectFiles: Readonly<Record<string, string>>;
  /** What the box and the saved copy had in common when the box last paused ({} for a new box). */
  readonly syncedManifest: Manifest;
  readonly bridge: BridgeHandlers;
  /** /.openlen's read-only files to put in the box (visitor data is dropped here anyway). */
  readonly readOnly: () => Promise<Readonly<Record<string, string>>>;
  /** /.openlen's read-only BINARY files: what the person attached (spec local 2026-10-26-len-skills). */
  readonly readOnlyBytes?: () => Promise<Readonly<Record<string, Uint8Array>>>;
  /** When the box was created or resumed for this turn (ms). */
  readonly startedAt: number;
  /** The turn's: the owner's ■. */
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  /** How long the first sync took, phase by phase (the spec's latency goal, §5). */
  readonly logFirstSync?: (timings: string) => void;
  /** The box was just created from the template: nothing of the project is in it yet. */
  readonly fresh?: boolean;
  /** Variables of this turn for every command, on top of the platform's (BASE_URL: the draft for the tests). */
  readonly baseEnv?: Readonly<Record<string, string>>;
}

type NotSaved = { readonly ruta: string; readonly motivo: "binary" | "too_large" };

export class SandboxTerminal implements TerminalBackend {
  private tree: Record<string, string>;
  private synced: Record<string, string> = {};
  /** The read-only files the box has, by where they are in it → hash (kept in the box, UPLOADED_FILE). */
  private uploaded: Record<string, string> = {};
  private uploadedRead = false;
  /** Read-only roots (/.openlen, an app's /node_modules): whether the read-only mount took. */
  private readonly mounted = new Map<string, boolean>();
  private cwd = "/";
  private opened: Promise<void> | null = null;
  private notes: string[] = [];
  private pausedAt: number | null = null;
  private readonly answered = new Set<string>();
  private nextJob = 0;
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly o: SandboxTerminalOptions) {
    this.tree = { ...o.projectFiles };
  }

  get arrancada(): boolean {
    return this.opened !== null;
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private open(): Promise<void> {
    return (this.opened ??= this.firstSync());
  }

  private async firstSync(): Promise<void> {
    const box = this.o.handle;
    const prepare = `sudo mkdir -p ${REQUESTS} ${RESPONSES} && sudo chown -R "$(id -u)" ${BRIDGE_DIR} && { ${TRUST_E2B_IN_CHROMIUM} || true; }`;
    const t0 = this.now();
    // A box just created from the template has nothing of the project: its manifest would be empty,
    // and reading it is the slowest thing a cold box does (measured 1.4 s, 21/10). A resumed one
    // prepares the mailbox and reads its manifest in one command.
    const preparing = this.o.fresh ? box.run(prepare, { timeoutMs: 30_000 }) : null;
    const inBox = this.o.fresh ? {} : await this.boxManifest(prepare);
    const t1 = this.now();
    const saved = manifestOf(this.tree);
    const base = this.o.syncedManifest;
    const boxChanged = new Set(diffManifests(base, inBox).map((c) => c.path));
    const writes: Record<string, string> = {};
    const removes: string[] = [];
    for (const c of diffManifests(base, saved)) {
      if (boxChanged.has(c.path) && inBox[c.path] !== saved[c.path]) this.notes.push(`${c.path}: kept the saved version; the box's change was dropped`);
      if (c.kind === "deleted") removes.push(c.path);
      else writes[c.path] = this.tree[c.path]!;
    }
    // The base environment rides along with the project's files: rewritten each turn (BASE_URL may change).
    writes[BASE_ENV_FILE] = baseEnvScript(this.o.baseEnv ?? {});
    // The project's files and /.openlen go up at the same time.
    let uploaded = t1;
    let readOnly = t1;
    await Promise.all([
      (async () => {
        await box.write(writes);
        await box.remove(removes);
        uploaded = this.now();
      })(),
      this.uploadReadOnly().then(() => void (readOnly = this.now())),
      preparing,
    ]);
    const t2 = this.now();
    this.synced = saved;
    this.o.logFirstSync?.(
      `ms=${t2 - t0} (prepare ${this.o.fresh ? t2 - t0 : 0} · manifest ${this.o.fresh ? 0 : t1 - t0} · upload ${uploaded - t1} · read-only ${readOnly - t1})`,
    );
  }

  /** /.openlen in the box, and an app's /node_modules (1,268 files and 7.8 MB of types, measured 21/10):
   *  only what the box doesn't have yet — what went up is remembered IN the box, across turns — and
   *  a large set in one compressed bundle. */
  /** A file's bytes as the box has it now, or null (not there, or a folder). Reading a file of the box
   *  starts it as a command would: Claude Code's Read reads a disk that is always there (spec local
   *  2026-10-27-len-pdf-skill), and a file an earlier turn left must not "not exist" until then. */
  async readFileBytes(path: string): Promise<Uint8Array | null> {
    if (!this.o.handle.readBytes) return null;
    await this.open();
    const got = await this.o.handle.readBytes([path]).catch(() => ({}) as Record<string, Uint8Array>);
    return got[path] ?? null;
  }

  /** A regular file's size without reading it, or null; starts the box like `readFileBytes`. */
  async fileSize(path: string): Promise<number | null> {
    if (!this.o.handle.fileSize) return null;
    await this.open();
    return this.o.handle.fileSize(path);
  }

  private async uploadReadOnly(): Promise<void> {
    const files: Record<string, string> = { ...VISITOR_DATA_READMES };
    for (const [path, text] of Object.entries(await this.o.readOnly())) if (!NEVER_IN_BOX.test(path)) files[path] = text;
    const binaries: Record<string, Uint8Array> = {};
    if (this.o.handle.writeBytes) {
      for (const [path, data] of Object.entries((await this.o.readOnlyBytes?.()) ?? {})) if (!NEVER_IN_BOX.test(path)) binaries[path] = data;
    }
    for (const root of new Set([...Object.keys(files), ...Object.keys(binaries)].map(readOnlyRoot))) await this.mountReadOnly(root);
    if (!this.uploadedRead) {
      this.uploadedRead = true;
      // Keyed by where each file is in the box, so a mount that took or didn't changes the keys.
      const kept = this.o.fresh ? null : await this.readText(UPLOADED_FILE).catch(() => null);
      try {
        if (kept) this.uploaded = JSON.parse(kept) as Record<string, string>;
      } catch {
        this.uploaded = {};
      }
    }
    const inBox = (path: string) => (this.mounted.get(readOnlyRoot(path)) ? readOnlySource(path) : path);
    const hashes: Record<string, string> = {};
    const writes: Record<string, string> = {};
    let bytes = 0;
    for (const [path, text] of Object.entries(files)) {
      const at = inBox(path);
      hashes[at] = sha256(text);
      if (this.uploaded[at] !== hashes[at]) {
        writes[at] = text;
        bytes += text.length;
      }
    }
    // The binary ones (attachments) go as bytes, with the same remembered hashes.
    const binaryWrites: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(binaries)) {
      const at = inBox(path);
      hashes[at] = createHash("sha256").update(data).digest("hex");
      if (this.uploaded[at] !== hashes[at]) binaryWrites[at] = data;
    }
    const removes = Object.keys(this.uploaded).filter((at) => !(at in hashes));
    if (Object.keys(writes).length > BUNDLE_OVER_FILES || bytes > BUNDLE_OVER_BYTES) await this.unbundle(writes);
    else await this.o.handle.write(writes);
    if (Object.keys(binaryWrites).length > 0) await this.o.handle.writeBytes!(binaryWrites);
    await this.o.handle.remove(pathsToRemove(removes, Object.keys(hashes)));
    if (Object.keys(writes).length > 0 || Object.keys(binaryWrites).length > 0 || removes.length > 0) await this.o.handle.write({ [UPLOADED_FILE]: JSON.stringify(hashes) });
    this.uploaded = hashes;
  }

  /** Many files in one round trip: gzipped JSON, unpacked by Python in the box. */
  private async unbundle(writes: Record<string, string>): Promise<void> {
    const bundle = gzipSync(Buffer.from(JSON.stringify(writes), "utf8")).toString("base64");
    await this.o.handle.write({ [UNBUNDLE_SCRIPT]: UNBUNDLE_PY, [BUNDLE_FILE]: bundle });
    const r = await this.o.handle.run(`sudo python3 ${UNBUNDLE_SCRIPT} ${BUNDLE_FILE}`, { timeoutMs: 60_000 });
    if (r.exitCode !== 0) throw new Error(`unpacking the read-only files failed (${r.exitCode}): ${r.stderr.slice(0, 300)}`);
  }

  /** What Len only reads is a read-only bind of where it is uploaded, as Claude Code's sandbox does
   *  with its ro-bind: a write there fails with the system's own "Read-only file system", like today's
   *  EROFS. Once per root and turn; the mount outlives the pause. A box that refuses it gets the files
   *  where Len reads them, as before. */
  private async mountReadOnly(root: string): Promise<void> {
    if (this.mounted.has(root)) return;
    const source = readOnlySource(root);
    const r = await this.o.handle.run(
      // Its own sudo mkdir/chown: it runs alongside the mailbox's preparation, not after it.
      `sudo mkdir -p ${source} ${root} && sudo chown -R "$(id -u)" ${source} && (mountpoint -q ${root} || (sudo mount --bind ${source} ${root} && sudo mount -o remount,bind,ro ${root}))`,
      { timeoutMs: 30_000 },
    );
    this.mounted.set(root, r.exitCode === 0);
  }

  /** `before`: a command to run first, in the same round trip. */
  private async boxManifest(before?: string): Promise<Record<string, string>> {
    const r = await this.o.handle.run(`${before ? `${before} && ` : ""}${BOX_BIN}/openlen-manifest`, { timeoutMs: 60_000 });
    if (r.exitCode !== 0) throw new Error(`openlen-manifest failed (${r.exitCode}): ${r.stderr.slice(0, 300)}`);
    const all = JSON.parse(r.stdout) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [path, hash] of Object.entries(all)) if (isSyncedPath(path)) out[path] = hash;
    return out;
  }

  /** The box's project files now, against what was last synced, without changing anything. */
  private async look(): Promise<{ tree: Record<string, string>; box: Record<string, string>; notSaved: NotSaved[]; changed: Record<string, string | null> }> {
    const box = await this.boxManifest();
    const changes = diffManifests(this.synced, box);
    // A file over the cap is never downloaded into this process (one of gigabytes would take it down): the manifest says its size.
    const isBig = (path: string) => box[path]?.startsWith(BIG_FILE_PREFIX) ?? false;
    const read = await this.o.handle.read(changes.filter((c) => c.kind !== "deleted" && !isBig(c.path)).map((c) => c.path));
    const tree = { ...this.tree };
    const notSaved: NotSaved[] = [];
    const changed: Record<string, string | null> = {};
    for (const c of changes) {
      if (c.kind === "deleted") {
        delete tree[c.path];
        changed[c.path] = null;
        continue;
      }
      if (isBig(c.path)) {
        notSaved.push({ ruta: c.path, motivo: "too_large" });
        continue;
      }
      const f = read[c.path];
      if (!f) continue; // gone between the manifest and the read
      if ("binary" in f) notSaved.push({ ruta: c.path, motivo: "binary" });
      else if (Buffer.byteLength(f.text, "utf8") > MAX_FOLDER_FILE_BYTES) notSaved.push({ ruta: c.path, motivo: "too_large" });
      else {
        tree[c.path] = f.text;
        changed[c.path] = f.text;
      }
    }
    return { tree, box, notSaved, changed };
  }

  private wrap(command: string, job: { readonly outputPath: string; readonly exitPath: string }): string {
    return [
      `mkdir -p ${JOBS_DIR}`,
      "{",
      // OpenLen's wrappers first; then what pip and npm -g install for the box's user (the template).
      `export PATH=${BOX_BIN}:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH`,
      `[ -f ${ENV_FILE} ] && . ${ENV_FILE}`,
      // After the shell's carried variables: the platform's (BASE_URL, Playwright's) are the ones that count.
      `[ -f ${BASE_ENV_FILE} ] && . ${BASE_ENV_FILE}`,
      `cd ${quote(this.cwd)} 2>/dev/null || cd /`,
      command,
      `__openlen_rc=$?`,
      `export -p > ${ENV_FILE} 2>/dev/null; pwd > ${CWD_FILE} 2>/dev/null`,
      `echo $__openlen_rc > ${job.exitPath}`,
      `exit $__openlen_rc`,
      `} > ${job.outputPath} 2>&1`,
    ].join("\n");
  }

  private async readText(path: string): Promise<string | null> {
    const f = (await this.o.handle.read([path]))[path];
    return f && "text" in f ? f.text : null;
  }

  /** Answers the box's requests until `stop` fires. */
  private async serveBridge(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      await this.serveOnce();
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        stop.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    }
  }

  /** One pass over the mailbox: answers what is waiting. A request that can't be read or answered
   *  gets its error as its own command's output, like a tool that fails; the next ones are still served. */
  private async serveOnce(): Promise<void> {
    const box = this.o.handle;
    for (const name of await box.list(REQUESTS)) {
      if (!name.endsWith(".json") || this.answered.has(name)) continue;
      this.answered.add(name);
      // The bridge script names the file after its id, so even an unreadable one can be answered.
      let id = name.slice(0, -".json".length);
      let program = "openlen-bridge";
      let response: Record<string, unknown>;
      try {
        const raw = (await box.read([`${REQUESTS}/${name}`]))[`${REQUESTS}/${name}`];
        let req: BridgeRequest;
        try {
          req = JSON.parse(raw && "text" in raw ? raw.text : "") as BridgeRequest;
        } catch {
          throw new Error("unreadable request");
        }
        id = req.id;
        program = req.program;
        const { tree } = await this.look();
        const answer = await answerBridgeRequest(req, this.o.bridge, tree, { signal: this.o.signal });
        response = { passthrough: true };
        if ("readLine" in answer) response = { readLine: true };
        else if (!("passthrough" in answer)) {
          const writes: Record<string, string> = {};
          const removes: string[] = [];
          for (const [p, c] of Object.entries(answer.files)) (c === null ? removes.push(p) : (writes[p] = c));
          await box.write(writes);
          await box.remove(removes);
          response = { stdout: answer.stdout, stderr: answer.stderr, exitCode: answer.exitCode };
        }
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") throw e;
        response = { stdout: "", stderr: `${program}: ${e instanceof Error ? e.message : String(e)}\n`, exitCode: 1 };
      }
      await box.write({ [`${RESPONSES}/${id}.json`]: JSON.stringify(response) });
      await box.remove([`${REQUESTS}/${name}`]);
    }
  }

  async ejecutar(command: string, o: { readonly timeoutMs?: number; readonly background?: boolean } = {}): Promise<SalidaDeUnComando> {
    await this.open();
    const timeoutMs = Math.min(Math.max(o.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    const id = `b${++this.nextJob}`;
    const job = { command, outputPath: `${JOBS_DIR}/${id}.output`, exitPath: `${JOBS_DIR}/${id}.exit` };
    const script = this.wrap(command, job);
    const notes = () => this.notes.splice(0).map((n) => `${n}\n`).join("");

    if (o.background) {
      const r = await this.o.handle.run(script, { timeoutMs, signal: this.o.signal, background: true });
      this.jobs.set(id, { ...job, pid: r.pid, done: false });
      return { stdout: backgroundStarted(id, job.outputPath), stderr: notes(), exitCode: 0, ficheros: await this.syncBack() };
    }

    const stop = new AbortController();
    const serving = this.serveBridge(stop.signal).catch(() => undefined);
    let r: RunResult;
    try {
      r = await this.o.handle.run(script, { timeoutMs, signal: this.o.signal });
    } finally {
      stop.abort();
      await serving;
    }
    // The box's combined output is in the job's file; a driver that doesn't redirect (the tests') gives it directly.
    const written = await this.readText(job.outputPath);
    const stdout = written ?? r.stdout;
    const stderr = (written === null ? r.stderr : "") + notes();
    if (r.aborted) return { stdout, stderr, exitCode: r.exitCode, ficheros: null };
    const cwd = await this.readText(CWD_FILE);
    if (cwd?.trim().startsWith("/")) this.cwd = cwd.trim();
    let moved = "";
    if (r.timedOut) {
      this.jobs.set(id, { ...job, pid: r.pid, done: false });
      moved = `${stdout === "" || stdout.endsWith("\n") ? "" : "\n"}${movedToBackground(timeoutMs, id, job.outputPath)}`;
    }
    const seen = await this.look();
    this.tree = seen.tree;
    this.synced = seen.box;
    return {
      stdout: stdout + moved,
      stderr,
      exitCode: r.timedOut ? 0 : r.exitCode,
      ficheros: { ...seen.tree },
      ...(seen.notSaved.length > 0 ? { noGuardados: seen.notSaved } : {}),
    };
  }

  private async syncBack(): Promise<Record<string, string>> {
    const seen = await this.look();
    this.tree = seen.tree;
    this.synced = seen.box;
    return { ...seen.tree };
  }

  /** What finished in the background since the last look, said once each; answers its bridge requests too. */
  async finishedBackground(): Promise<string[]> {
    const running = [...this.jobs.entries()].filter(([, j]) => !j.done);
    if (running.length === 0) return [];
    await this.serveOnce().catch(() => undefined);
    const notices: string[] = [];
    for (const [id, job] of running) {
      const exit = await this.readText(job.exitPath);
      let exitCode: number | null;
      if (exit !== null) exitCode = Number.parseInt(exit.trim(), 10);
      else if (job.pid !== undefined && (await this.o.handle.run(`kill -0 ${job.pid} 2>/dev/null`, { timeoutMs: 10_000 })).exitCode !== 0) exitCode = null;
      else continue;
      job.done = true;
      notices.push(backgroundFinished({ id, command: job.command, exitCode: Number.isFinite(exitCode) ? exitCode : null, outputPath: job.outputPath }));
    }
    return notices;
  }

  /** Stops what still runs in the background (the turn is closing); killed jobs are not announced. */
  async killBackground(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.done) continue;
      job.done = true;
      if (job.pid !== undefined) {
        await this.o.handle
          .run(`kill -TERM -- -${job.pid} 2>/dev/null; kill -TERM ${job.pid} 2>/dev/null; true`, { timeoutMs: 10_000 })
          .catch(() => undefined);
      }
    }
  }

  async poner(ficheros: Readonly<Record<string, string | null>>): Promise<void> {
    await this.open();
    const writes: Record<string, string> = {};
    const removes: string[] = [];
    for (const [path, text] of Object.entries(ficheros)) {
      if (text === null) {
        removes.push(path);
        delete this.tree[path];
        delete this.synced[path];
      } else {
        writes[path] = text;
        if (isSyncedPath(path)) {
          this.tree[path] = text;
          this.synced[path] = sha256(text);
        }
      }
    }
    await this.o.handle.write(writes);
    await this.o.handle.remove(removes);
  }

  async refrescarPerezosos(): Promise<void> {
    if (this.opened) await this.uploadReadOnly();
  }

  async cerrar(): Promise<void> {
    if (this.pausedAt !== null) return;
    this.pausedAt = this.now();
    await this.o.handle.pause();
  }

  /** Seconds of box this turn: from create/resume to the pause. */
  runningSeconds(): number {
    return Math.max(0, ((this.pausedAt ?? this.now()) - this.o.startedAt) / 1000);
  }

  /** What the box changed since the last command and is not saved yet, without running anything. */
  async pendingChanges(): Promise<Readonly<Record<string, string | null>>> {
    await this.open();
    return (await this.look()).changed;
  }

  syncedManifest(): Manifest {
    return { ...this.synced };
  }
}
