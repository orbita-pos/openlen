import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSubdomain } from "@/lib/subdomain/validate";

// ─────────────────────────────────────────────────────────────────────────────
// Publish-to-disk primitives.
//
// nginx serves `/var/www/openlen/<sub>/index.html` per subdomain. We write
// to a tmpdir first, then atomically rename it into place so visitors never
// see a half-written index.html. The same dance handles re-publish: the
// existing directory is renamed aside, the new one is moved in, then the
// old one is rm -rf'd in the background.
//
// PUBLISH_ROOT is read from env so tests can point at a tmp dir without
// touching the real wildcard root. Default matches the systemd unit.
//
// Defense in depth: the subdomain is re-validated INSIDE every operation
// even though callers should already have done so. Never trust the caller.
// ─────────────────────────────────────────────────────────────────────────────

function getRoot(): string {
  return process.env.PUBLISH_ROOT?.trim() || "/var/www/openlen";
}

function safeJoin(root: string, sub: string): string {
  // path.join can't traverse out of root for our validated-label inputs,
  // but realpath-style normalization keeps us honest if PUBLISH_ROOT is
  // configured with a trailing dot or similar oddity.
  const joined = path.join(root, sub);
  const norm = path.normalize(joined);
  if (!norm.startsWith(path.normalize(root) + path.sep) && norm !== path.normalize(root)) {
    throw new Error(`refusing path traversal: ${joined}`);
  }
  return norm;
}

export interface PublishParams {
  subdomain: string;
  html: string;
}

/**
 * Atomically publish `html` as the new index.html for `subdomain`.
 *
 * Process:
 *   1. Validate the subdomain again (defense in depth).
 *   2. Write to `${root}/.tmp-${sub}-${uuid}/index.html`.
 *   3. If a previous live dir exists, rename it to `.old-${sub}-${uuid}/`.
 *   4. Rename the tmp dir into the live path.
 *   5. Best-effort rm -rf the .old dir.
 *
 * Either the new dir is live, or the old dir is. Never an in-between.
 */
export async function publishToDir(params: PublishParams): Promise<void> {
  const v = validateSubdomain(params.subdomain);
  if (!v.ok) {
    throw new Error(`publishToDir: invalid subdomain (${v.reason})`);
  }
  // Session 12 defense-in-depth: the workspace iframe renders editor-mode
  // HTML carrying `data-slot-path` + contenteditable spans. That payload
  // must never reach disk — a leaked publish would show outlined-on-hover
  // editable text to every visitor and ruin the page's styling. The
  // canonical `result.html` field is rendered with editorMode=false, so
  // any HTML containing this marker reflects a bug upstream of here. We
  // refuse rather than write.
  if (params.html.includes("data-slot-path=")) {
    throw new Error(
      "publishToDir: refusing to write HTML containing data-slot-path (Session 12 editor-mode leaked into publish path)",
    );
  }
  const sub = v.value;
  const root = getRoot();
  await mkdir(root, { recursive: true });

  const tmpDir = safeJoin(root, `.tmp-${sub}-${randomUUID()}`);
  const liveDir = safeJoin(root, sub);
  const oldDir = safeJoin(root, `.old-${sub}-${randomUUID()}`);

  await mkdir(tmpDir, { recursive: true });
  try {
    await writeFile(path.join(tmpDir, "index.html"), params.html, "utf8");

    // Check if a live dir already exists.
    let liveExists = false;
    try {
      await stat(liveDir);
      liveExists = true;
    } catch {
      // ENOENT — first publish.
    }

    if (liveExists) {
      await rename(liveDir, oldDir);
    }
    try {
      await rename(tmpDir, liveDir);
    } catch (err) {
      // Roll back: put the old dir back if we moved it.
      if (liveExists) {
        try {
          await rename(oldDir, liveDir);
        } catch {
          // If even the rollback fails the disk is in a bad state — surface
          // the original error, leave the .old- dir for an operator.
        }
      }
      throw err;
    }
    if (liveExists) {
      // Best-effort cleanup; if this fails cleanupStaleTmpDirs will pick
      // it up on the next sweep.
      await rm(oldDir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    // If we threw before the rename, the tmp dir is orphaned. Best-effort
    // remove. If we succeeded the rename consumed it and this is a no-op.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Remove the live dir for `subdomain`. Idempotent — safe to call when the
 * subdomain was never published (no-op).
 */
export async function unpublishDir(subdomain: string): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`unpublishDir: invalid subdomain (${v.reason})`);
  }
  const liveDir = safeJoin(getRoot(), v.value);
  await rm(liveDir, { recursive: true, force: true });
}

/**
 * Sweep `.tmp-*` and `.old-*` dirs older than 1 hour. Called once at app
 * startup (instrumentation.ts). Cheap — only lists the root dir and stat's
 * matching entries.
 */
export async function cleanupStaleTmpDirs(): Promise<void> {
  const root = getRoot();
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    // Root may not exist yet on first boot — that's fine.
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  await Promise.all(
    entries
      .filter((name) => name.startsWith(".tmp-") || name.startsWith(".old-"))
      .map(async (name) => {
        const full = path.join(root, name);
        try {
          const s = await stat(full);
          if (s.mtimeMs < cutoff) {
            await rm(full, { recursive: true, force: true });
          }
        } catch {
          // Race with another sweep or a publish — ignore.
        }
      }),
  );
}
