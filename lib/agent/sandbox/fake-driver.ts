// An in-memory box for tests: files in a Map, commands answered by `onRun`, and `openlen-manifest`
// answered like the template's script does (the hashes of the project's files, ./paths.ts).

import { createHash } from "node:crypto";

import type { RunResult, SandboxDriver, SandboxHandle } from "./driver";
import { isSyncedPath } from "./paths";

export type FakeRun = (
  command: string,
  files: Map<string, string>,
  o: { readonly timeoutMs: number; readonly background?: boolean },
) => Partial<RunResult> | Promise<Partial<RunResult>> | void;

interface FakeBox {
  readonly files: Map<string, string>;
  readonly binaries: Map<string, number>;
  paused: boolean;
}

export function fakeDriver(o: { readonly onRun?: FakeRun } = {}): SandboxDriver & {
  files(id: string): Map<string, string>;
  binary(id: string, path: string, size: number): void;
  paused(id: string): boolean;
  /** Every command a box ran, in order. */
  commands(id: string): string[];
} {
  const boxes = new Map<string, FakeBox>();
  const ran = new Map<string, string[]>();
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
        if (command === "openlen-manifest") {
          const manifest: Record<string, string> = {};
          for (const [path, text] of b.files) if (isSyncedPath(path)) manifest[path] = createHash("sha256").update(text).digest("hex");
          return { stdout: JSON.stringify(manifest), stderr: "", exitCode: 0, timedOut: false };
        }
        const r = (await o.onRun?.(command, b.files, { timeoutMs: opts.timeoutMs, background: opts.background })) ?? {};
        return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...r };
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
          b.files.delete(p);
          b.binaries.delete(p);
        }
      },
      async read(paths) {
        const b = box();
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
    async create() {
      const id = `fake-${++next}`;
      boxes.set(id, { files: new Map(), binaries: new Map(), paused: false });
      ran.set(id, []);
      return handle(id);
    },
    async resume(sandboxId) {
      const b = boxes.get(sandboxId);
      if (!b) throw new Error(`sandbox ${sandboxId} not found`);
      b.paused = false;
      return handle(sandboxId);
    },
    async kill(sandboxId) {
      boxes.delete(sandboxId);
    },
    files: (id) => boxes.get(id)!.files,
    binary: (id, path, size) => void boxes.get(id)!.binaries.set(path, size),
    paused: (id) => boxes.get(id)?.paused ?? false,
    commands: (id) => ran.get(id) ?? [],
  };
}
