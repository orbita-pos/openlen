// Where the modules esm.sh served live, by the sha256 of their text: memory,
// then the box's disk (1 GB, oldest out), then R2 (the uploads bucket, prefix
// esm-cache/, public and immutable — the same code esm.sh serves publicly).
// Every read checks the hash: a file that doesn't match is a miss.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStorage } from "@/lib/storage";

export interface ModuleStore {
  get(sha: string): Promise<string | null>;
  put(sha: string, contents: string): Promise<void>;
}

const SHA = /^[0-9a-f]{64}$/;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function memoryStore(): ModuleStore {
  const map = new Map<string, string>();
  return {
    async get(sha) {
      return map.get(sha) ?? null;
    },
    async put(sha, contents) {
      map.set(sha, contents);
    },
  };
}

export function diskStore(dir: string, maxBytes: number): ModuleStore {
  const fileOf = (sha: string) => path.join(dir, sha.slice(0, 2), `${sha}.txt`);
  let used: number | null = null;

  async function listFiles(): Promise<{ file: string; size: number; mtime: number }[]> {
    const out: { file: string; size: number; mtime: number }[] = [];
    for (const sub of await readdir(dir).catch(() => [] as string[])) {
      for (const name of await readdir(path.join(dir, sub)).catch(() => [] as string[])) {
        const file = path.join(dir, sub, name);
        const st = await stat(file).catch(() => null);
        if (st?.isFile()) out.push({ file, size: st.size, mtime: st.mtimeMs });
      }
    }
    return out;
  }

  async function trim(): Promise<void> {
    const files = (await listFiles()).sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= maxBytes) break;
      await unlink(f.file).catch(() => {});
      total -= f.size;
    }
    used = total;
  }

  return {
    async get(sha) {
      if (!SHA.test(sha)) return null;
      try {
        const text = await readFile(fileOf(sha), "utf8");
        return sha256Hex(text) === sha ? text : null;
      } catch {
        return null;
      }
    },
    async put(sha, contents) {
      if (!SHA.test(sha)) throw new Error(`not a sha256: ${sha}`);
      await mkdir(path.dirname(fileOf(sha)), { recursive: true });
      await writeFile(fileOf(sha), contents, "utf8");
      used ??= (await listFiles()).reduce((n, f) => n + f.size, 0) - Buffer.byteLength(contents);
      used += Buffer.byteLength(contents);
      if (used > maxBytes) await trim();
    },
  };
}

export function r2Store(): ModuleStore | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) return null;
  // lib/storage/r2.ts keeps the key as given and serves it at `${publicUrlBase}/${key}`.
  const base = (R2_PUBLIC_URL || "https://uploads.openlen.com").replace(/\/+$/, "");
  const keyOf = (sha: string) => `esm-cache/${sha}.txt`;
  return {
    async get(sha) {
      if (!SHA.test(sha)) return null;
      try {
        const res = await fetch(`${base}/${keyOf(sha)}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const text = await res.text();
        return sha256Hex(text) === sha ? text : null;
      } catch {
        return null;
      }
    },
    async put(sha, contents) {
      await getStorage().upload({ key: keyOf(sha), contentType: "text/plain; charset=utf-8", body: Buffer.from(contents, "utf8") });
    },
  };
}

export function layeredStore(stores: readonly ModuleStore[]): ModuleStore {
  return {
    async get(sha) {
      for (let i = 0; i < stores.length; i++) {
        const text = await stores[i]!.get(sha);
        if (text !== null) {
          await Promise.all(stores.slice(0, i).map((s) => s.put(sha, text).catch(() => {})));
          return text;
        }
      }
      return null;
    },
    async put(sha, contents) {
      await Promise.all(stores.map((s) => s.put(sha, contents)));
    },
  };
}

let current: ModuleStore | null = null;

export function defaultModuleStore(): ModuleStore {
  if (!current) {
    const dir = process.env.OPENLEN_ESM_CACHE_DIR || path.join(os.tmpdir(), "openlen-esm-cache");
    const r2 = r2Store();
    current = layeredStore([memoryStore(), diskStore(dir, 1024 * 1024 * 1024), ...(r2 ? [r2] : [])]);
  }
  return current;
}

export function __setModuleStoreForTest(store: ModuleStore | null): void {
  current = store;
}
