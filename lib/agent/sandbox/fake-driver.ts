// An in-memory box for tests: files in a Map, commands answered by `onRun`, and `openlen-manifest`
// answered like the template's script does (the hashes of the project's files, ./paths.ts).

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { MAX_FOLDER_FILE_BYTES } from "@/lib/agent/ficheros/folder";

import type { BoxNetwork } from "./box-network";
import type { RunResult, SandboxDriver, SandboxHandle } from "./driver";
import { isSyncedPath } from "./paths";
import { BIG_FILE_PREFIX } from "./template-files";

export type FakeRun = (
  command: string,
  files: Map<string, string>,
  o: { readonly timeoutMs: number; readonly background?: boolean },
) => Partial<RunResult> | void | Promise<Partial<RunResult> | void>;

interface FakeBox {
  readonly files: Map<string, string>;
  readonly binaries: Map<string, number>;
  readonly bytes: Map<string, Uint8Array>;
  paused: boolean;
}

export function fakeDriver(o: { readonly onRun?: FakeRun } = {}): SandboxDriver & {
  files(id: string): Map<string, string>;
  binary(id: string, path: string, size: number): void;
  /** The binary files written with `writeBytes`. */
  bytesOf(id: string): Map<string, Uint8Array>;
  paused(id: string): boolean;
  /** Every command a box ran, in order. */
  commands(id: string): string[];
  /** Every path a box was asked to read, in order. */
  reads(id: string): string[];
  /** The network a box was created or last resumed with. */
  networkOf(id: string): BoxNetwork | null;
} {
  const boxes = new Map<string, FakeBox>();
  const ran = new Map<string, string[]>();
  const read = new Map<string, string[]>();
  const networks = new Map<string, BoxNetwork | null>();
  let next = 0;

  const handle = (id: string): SandboxHandle => {
    const box = () => {
      const b = boxes.get(id);
      if (!b) throw new Error(`sandbox ${id} not found`);
      return b;
    };
    return {
      id,
      async run(command, opts) {
        const b = box();
        ran.get(id)!.push(command);
        // Like sandbox-terminal's unbundle.py: the base64 gzipped JSON bundle becomes files.
        const unbundle = /unbundle\.py (\S+)$/.exec(command);
        if (unbundle) {
          const bundle = b.files.get(unbundle[1]!);
          if (bundle === undefined) return { stdout: "", stderr: "no bundle\n", exitCode: 1, timedOut: false };
          const files = JSON.parse(gunzipSync(Buffer.from(bundle, "base64")).toString("utf8")) as Record<string, string>;
          for (const [path, text] of Object.entries(files)) b.files.set(path, text);
          b.files.delete(unbundle[1]!);
          return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        }
        if (command === "openlen-manifest" || command.endsWith("/openlen-manifest")) {
          const manifest: Record<string, string> = {};
          for (const [path, text] of b.files) {
            if (!isSyncedPath(path)) continue;
            const size = Buffer.byteLength(text, "utf8");
            // Like the template's script: a file over the cap is listed by its size, never read.
            manifest[path] = size > MAX_FOLDER_FILE_BYTES ? `${BIG_FILE_PREFIX}${size}:0` : createHash("sha256").update(text).digest("hex");
          }
          return { stdout: JSON.stringify(manifest), stderr: "", exitCode: 0, timedOut: false };
        }
        const work = Promise.resolve(o.onRun?.(command, b.files, { timeoutMs: opts.timeoutMs, background: opts.background })).then(
          (r): RunResult => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, ...(r ?? {}) }),
        );
        if (!opts.signal) return work;
        // Like the E2B driver: a stopped turn kills the process and comes back at once.
        const aborted = new Promise<RunResult>((resolve) => {
          const stop = () => resolve({ stdout: "", stderr: "", exitCode: 130, timedOut: false, aborted: true });
          if (opts.signal!.aborted) stop();
          else opts.signal!.addEventListener("abort", stop, { once: true });
        });
        return Promise.race([work, aborted]);
      },
      async write(files) {
        const b = box();
        for (const [path, text] of Object.entries(files)) {
          b.files.set(path, text);
          b.binaries.delete(path);
        }
      },
      async remove(paths) {
        const b = box();
        for (const p of paths) {
          // A folder goes with all it holds, as E2B's.
          for (const f of [...b.files.keys(), ...b.binaries.keys()]) {
            if (f !== p && !f.startsWith(`${p}/`)) continue;
            b.files.delete(f);
            b.binaries.delete(f);
            b.bytes.delete(f);
          }
        }
      },
      async writeBytes(files) {
        const b = box();
        for (const [p, data] of Object.entries(files)) {
          b.bytes.set(p, data);
          b.binaries.set(p, data.byteLength);
        }
      },
      async fileSize(path) {
        const b = box();
        const data = b.bytes.get(path);
        if (data) return data.byteLength;
        return b.files.has(path) ? new TextEncoder().encode(b.files.get(path)!).byteLength : null;
      },
      async readBytes(paths) {
        const b = box();
        const out: Record<string, Uint8Array> = {};
        for (const p of paths) {
          const data = b.bytes.get(p);
          if (data) out[p] = data;
          else if (b.files.has(p)) out[p] = new TextEncoder().encode(b.files.get(p)!);
        }
        return out;
      },
      async read(paths) {
        const b = box();
        read.get(id)!.push(...paths);
        const out: Record<string, { text: string } | { binary: true; size: number }> = {};
        for (const p of paths) {
          const size = b.binaries.get(p);
          if (size !== undefined) out[p] = { binary: true, size };
          else if (b.files.has(p)) out[p] = { text: b.files.get(p)! };
        }
        return out;
      },
      async list(dir) {
        const prefix = dir.endsWith("/") ? dir : `${dir}/`;
        return [...box().files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length));
      },
      async pause() {
        box().paused = true;
      },
      async kill() {
        boxes.delete(id);
      },
    };
  };

  return {
    async create(c) {
      const id = `fake-${++next}`;
      boxes.set(id, { files: new Map(), binaries: new Map(), bytes: new Map(), paused: false });
      ran.set(id, []);
      read.set(id, []);
      networks.set(id, c.network ?? null);
      return handle(id);
    },
    async resume(sandboxId, network) {
      const b = boxes.get(sandboxId);
      if (!b) throw new Error(`sandbox ${sandboxId} not found`);
      b.paused = false;
      if (network !== undefined) networks.set(sandboxId, network);
      return handle(sandboxId);
    },
    async kill(sandboxId) {
      boxes.delete(sandboxId);
    },
    files: (id) => boxes.get(id)!.files,
    binary: (id, path, size) => void boxes.get(id)!.binaries.set(path, size),
    bytesOf: (id) => boxes.get(id)!.bytes,
    paused: (id) => boxes.get(id)?.paused ?? false,
    commands: (id) => ran.get(id) ?? [],
    reads: (id) => read.get(id) ?? [],
    networkOf: (id) => networks.get(id) ?? null,
  };
}
