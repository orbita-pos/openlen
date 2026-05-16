import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageAdapter, UploadArgs, UploadResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// FilesystemStorage — writes under `rootDir` (default `./public/uploads/`)
// and returns a relative URL Next.js serves out of /public.
//
// Sufficient for local dev, single-node deployments, and Hetzner self-host
// with a Docker volume. Not safe for horizontally-scaled / serverless: there
// the operator should set R2_* env vars to swap in the R2 adapter.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilesystemStorageOptions {
  rootDir: string;
  publicUrlBase: string;
}

export class FilesystemStorage implements StorageAdapter {
  constructor(private opts: FilesystemStorageOptions) {}

  async upload({ key, body }: UploadArgs): Promise<UploadResult> {
    // Guard against `..` in the key escaping rootDir. /api/upload generates
    // keys server-side from random hex, but a future caller might not — better
    // to enforce here than rely on every caller getting it right.
    if (key.includes("..") || key.startsWith("/")) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const filepath = join(this.opts.rootDir, key);
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, body);
    const stats = await stat(filepath);
    const publicBase = this.opts.publicUrlBase.replace(/\/+$/, "");
    return {
      url: `${publicBase}/${key}`,
      size: stats.size,
    };
  }

  async delete(key: string): Promise<void> {
    if (key.includes("..") || key.startsWith("/")) return;
    const filepath = join(this.opts.rootDir, key);
    await unlink(filepath).catch(() => {
      // File may already be gone — idempotent delete.
    });
  }
}
