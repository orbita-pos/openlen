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

import { MAX_FOLDER_FILE_BYTES } from "@/lib/agent/ficheros/folder";
import type { TerminalBackend } from "@/lib/agent/terminal/backend";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, type SalidaDeUnComando } from "@/lib/agent/terminal/terminal";

import { answerBridgeRequest, type BridgeHandlers, type BridgeRequest } from "./bridge";
import type { RunResult, SandboxHandle } from "./driver";
import { diffManifests, type Manifest } from "./manifest";
import { NEVER_IN_BOX, isSyncedPath } from "./paths";
import { BOX_BIN, BRIDGE_DIR } from "./template-files";

const REQUESTS = `${BRIDGE_DIR}/requests`;
const RESPONSES = `${BRIDGE_DIR}/responses`;
const ENV_FILE = `${BRIDGE_DIR}/env`;
const CWD_FILE = `${BRIDGE_DIR}/cwd`;
const POLL_MS = 200;

/** In place of the visitor data, which never enters the box (Jesús, 21/10). */
export const VISITOR_DATA_READMES: Readonly<Record<string, string>> = {
  "/.openlen/bandeja/README.txt":
    "Visitors' form submissions and chat messages are not in this terminal: read them with list_form_submissions and list_messages.\n",
  "/.openlen/resultados/README.txt": "The site's visits are not in this terminal: read them with get_visits.\n",
};

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
  /** When the box was created or resumed for this turn (ms). */
  readonly startedAt: number;
  /** The turn's: the owner's ■. */
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

type NotSaved = { readonly ruta: string; readonly motivo: "binary" | "too_large" };

export class SandboxTerminal implements TerminalBackend {
  private tree: Record<string, string>;
  private synced: Record<string, string> = {};
  private cwd = "/";
  private opened: Promise<void> | null = null;
  private notes: string[] = [];
  private pausedAt: number | null = null;
  private readonly answered = new Set<string>();

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
    await box.run(`sudo mkdir -p ${REQUESTS} ${RESPONSES} && sudo chown -R "$(id -u)" ${BRIDGE_DIR}`, { timeoutMs: 30_000 });
    const inBox = await this.boxManifest();
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
    await box.write(writes);
    await box.remove(removes);
    await this.uploadReadOnly();
    this.synced = saved;
  }

  private async uploadReadOnly(): Promise<void> {
    const files: Record<string, string> = {};
    for (const [path, text] of Object.entries(await this.o.readOnly())) if (!NEVER_IN_BOX.test(path)) files[path] = text;
    await this.o.handle.write({ ...files, ...VISITOR_DATA_READMES });
  }

  private async boxManifest(): Promise<Record<string, string>> {
    const r = await this.o.handle.run(`${BOX_BIN}/openlen-manifest`, { timeoutMs: 60_000 });
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
    const read = await this.o.handle.read(changes.filter((c) => c.kind !== "deleted").map((c) => c.path));
    const tree = { ...this.tree };
    const notSaved: NotSaved[] = [];
    const changed: Record<string, string | null> = {};
    for (const c of changes) {
      if (c.kind === "deleted") {
        delete tree[c.path];
        changed[c.path] = null;
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

  private wrap(command: string): string {
    return [
      `export PATH=${BOX_BIN}:$PATH`,
      `[ -f ${ENV_FILE} ] && . ${ENV_FILE}`,
      `cd ${quote(this.cwd)} 2>/dev/null || cd /`,
      command,
      `__openlen_rc=$?`,
      `export -p > ${ENV_FILE} 2>/dev/null; pwd > ${CWD_FILE} 2>/dev/null`,
      `exit $__openlen_rc`,
    ].join("\n");
  }

  /** Answers the box's requests until `stop` fires. */
  private async serveBridge(stop: AbortSignal): Promise<void> {
    const box = this.o.handle;
    while (!stop.aborted) {
      for (const name of await box.list(REQUESTS)) {
        if (!name.endsWith(".json") || this.answered.has(name)) continue;
        this.answered.add(name);
        const raw = (await box.read([`${REQUESTS}/${name}`]))[`${REQUESTS}/${name}`];
        if (!raw || "binary" in raw) continue;
        const req = JSON.parse(raw.text) as BridgeRequest;
        const { tree } = await this.look();
        const answer = await answerBridgeRequest(req, this.o.bridge, tree, { signal: this.o.signal });
        let response: Record<string, unknown> = { passthrough: true };
        if (!("passthrough" in answer)) {
          const writes: Record<string, string> = {};
          const removes: string[] = [];
          for (const [p, c] of Object.entries(answer.files)) (c === null ? removes.push(p) : (writes[p] = c));
          await box.write(writes);
          await box.remove(removes);
          response = { stdout: answer.stdout, stderr: answer.stderr, exitCode: answer.exitCode };
        }
        await box.write({ [`${RESPONSES}/${req.id}.json`]: JSON.stringify(response) });
        await box.remove([`${REQUESTS}/${name}`]);
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_MS);
        stop.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    }
  }

  async ejecutar(command: string, o: { readonly timeoutMs?: number; readonly background?: boolean } = {}): Promise<SalidaDeUnComando> {
    await this.open();
    const timeoutMs = Math.min(Math.max(o.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
    const stop = new AbortController();
    const serving = this.serveBridge(stop.signal).catch(() => undefined);
    let r: RunResult;
    try {
      r = await this.o.handle.run(this.wrap(command), { timeoutMs, signal: this.o.signal });
    } finally {
      stop.abort();
      await serving;
    }
    const notes = this.notes.splice(0).map((n) => `${n}\n`).join("");
    const stderr = r.stderr + notes;
    if (r.aborted) return { stdout: r.stdout, stderr, exitCode: r.exitCode, ficheros: null };
    const cwd = (await this.o.handle.read([CWD_FILE]))[CWD_FILE];
    if (cwd && "text" in cwd && cwd.text.trim().startsWith("/")) this.cwd = cwd.text.trim();
    const seen = await this.look();
    this.tree = seen.tree;
    this.synced = seen.box;
    return {
      stdout: r.stdout,
      stderr,
      exitCode: r.timedOut ? 143 : r.exitCode,
      ficheros: { ...seen.tree },
      ...(seen.notSaved.length > 0 ? { noGuardados: seen.notSaved } : {}),
    };
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
