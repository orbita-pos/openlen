import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { validateSubdomain } from "@/lib/subdomain/validate";
import { detectSlotPath } from "@/lib/html-engine";
import { optimizeHtmlForProduction } from "@/lib/publish/optimize-html";
import { consolidateUnsplashCredits } from "@/lib/publish/credits";
import { wirePublishedForms } from "@/lib/publish/forms";
import { injectAnalyticsSnippet } from "@/lib/analytics/snippet";
import { injectLogoIntoHtml } from "@/lib/branding/inject-logo";
import type { FormConfig } from "@/lib/projects/types";

// ─────────────────────────────────────────────────────────────────────────────
// Publish-to-disk primitives — versioned releases + `current` symlink.
//
// Layout per subdomain:
//
//   /var/www/openlen/<sub>/
//     releases/
//       <sha-12>/
//         index.html
//       <sha-12>/
//         index.html
//     current -> releases/<sha-12>   (symlink)
//
// nginx `root` is `<sub>/current` (set in infra/nginx/openlen.conf), so the
// live site is whatever the symlink points at. Publishing a new release:
//
//   1. Compute sha256 of the optimized HTML (12 chars stable).
//   2. If `releases/<sha>/` already exists, no write — content is identical.
//   3. Otherwise write to `.tmp-<sha>-<uuid>/index.html`, then atomically
//      `rename(tmp, releases/<sha>)`.
//   4. Atomically flip the `current` symlink: `symlink(releases/<sha>, current.new)`
//      then `rename(current.new, current)`.
//   5. Best-effort cleanup of releases beyond the last 10 (by mtime).
//
// Rollback: `rollbackToSha(sub, sha)` validates that `releases/<sha>/` exists
// and just flips the symlink. No re-render, no orchestrator call.
//
// PUBLISH_ROOT env var is honored so tests can point at a tmp dir without
// touching the real wildcard root.
// ─────────────────────────────────────────────────────────────────────────────

const RELEASES_KEEP = 10;
const SHA_LEN = 12;

function getRoot(): string {
  return process.env.PUBLISH_ROOT?.trim() || "/var/www/openlen";
}

function safeJoin(root: string, ...parts: string[]): string {
  const joined = path.join(root, ...parts);
  const norm = path.normalize(joined);
  const rootNorm = path.normalize(root);
  if (!norm.startsWith(rootNorm + path.sep) && norm !== rootNorm) {
    throw new Error(`refusing path traversal: ${joined}`);
  }
  return norm;
}

function computeSha(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, SHA_LEN);
}

export class ReleaseNotFoundError extends Error {
  constructor(public readonly subdomain: string, public readonly sha: string) {
    super(`release ${sha} for ${subdomain} not found`);
    this.name = "ReleaseNotFoundError";
  }
}

export interface PublishParams {
  subdomain: string;
  html: string;
  /** When provided AND the HTML references `/api/projects/<projectId>/assets/<filename>`
   *  URLs (LocalFs upload backend), each referenced file is copied from the
   *  upload dir to `<sub>/assets/<filename>` and the URL is rewritten to
   *  `/assets/<filename>` so nginx serves the asset directly off disk —
   *  no Node round-trip per image on the published page. */
  projectId?: string;
  /** Per-form config from ProjectData.settings.forms, keyed by document-
   *  order form index. Baked into the published forms by wirePublishedForms. */
  formConfigs?: Record<string, FormConfig>;
  /** Inject the analytics tracker snippet at publish time? Defaults to true.
   *  Set to false when the project's settings.analyticsDisabled is true so
   *  the user can opt out without losing the rest of publish-time HTML rewrites. */
  analyticsEnabled?: boolean;
  /** Per-project favicon / brand mark URL. When provided, publishToDir
   *  rewrites any existing <link rel="icon"> to point at it AND adds an
   *  og:image meta if the document doesn't already declare one. Null /
   *  undefined leaves the HTML's existing head untouched. */
  logoUrl?: string | null;
}

const ASSET_URL_RE_FOR =
  // Built per-call because we interpolate the projectId. Captures the
  // hash-based filename, e.g. `/api/projects/<id>/assets/abc123.webp`.
  (projectId: string) =>
    new RegExp(
      // eslint-disable-next-line no-useless-escape
      `/api/projects/${escapeForRegex(projectId)}/assets/([A-Za-z0-9._-]+)`,
      "g",
    );

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getUploadDir(): string {
  return (
    process.env.OPENLEN_UPLOAD_DIR ?? path.join(process.cwd(), "uploads")
  );
}

/** Find LocalFs asset URLs in the HTML, copy each referenced file to the
 *  subdomain's `assets/` dir (shared across releases — hash-based filenames
 *  make this safe), and rewrite the URLs to be subdomain-relative.
 *
 *  Returns the rewritten HTML. Best-effort on failures: if a file can't be
 *  copied, the URL is left as-is so the page still renders via the API
 *  fallback (slower but functional). */
async function migrateLocalAssets(params: {
  html: string;
  projectId: string;
  subDir: string;
}): Promise<string> {
  const { html, projectId, subDir } = params;
  const re = ASSET_URL_RE_FOR(projectId);
  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.add(m[1]);
  }
  if (matches.size === 0) return html;

  const uploadDir = getUploadDir();
  const targetDir = safeJoin(subDir, "assets");
  await mkdir(targetDir, { recursive: true });

  const failed = new Set<string>();
  await Promise.all(
    Array.from(matches).map(async (filename) => {
      // Filename is hash-based but defend against traversal anyway.
      if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes("..")) {
        failed.add(filename);
        return;
      }
      const src = path.join(uploadDir, projectId, filename);
      const dst = path.join(targetDir, filename);
      try {
        await stat(dst);
        return; // already present from a prior publish — hash-based, idempotent
      } catch {
        /* not there yet — copy below */
      }
      try {
        await copyFile(src, dst);
      } catch {
        failed.add(filename);
      }
    }),
  );

  // Rewrite URLs we successfully migrated to subdomain-relative paths.
  // Anything in `failed` stays as the original API URL so it still works
  // via the Node fallback (just slower).
  return html.replace(
    ASSET_URL_RE_FOR(projectId),
    (full, filename: string) => {
      if (failed.has(filename)) return full;
      return `/assets/${filename}`;
    },
  );
}

// Match Unsplash CDN URLs in any HTML/CSS context. The exclude set stops
// the match at quote / whitespace / `)` (for `url(...)` in CSS) / `<` `>`
// (for tag boundaries). `&` and `=` are allowed so query strings survive.
const UNSPLASH_URL_RE = /https?:\/\/images\.unsplash\.com\/[^"'\s)<>]+/g;

const UNSPLASH_FETCH_TIMEOUT_MS = 15_000;
const UNSPLASH_MAX_BYTES = 20 * 1024 * 1024; // 20 MB upper bound per photo

/** Decode the common HTML entities we'd find inside an `<img src>` URL.
 *  Conservative — only what realistically appears in URLs. */
function decodeHtmlEntitiesInUrl(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

/** Cache-on-publish for Unsplash hotlinks. Downloads each unique Unsplash
 *  URL in the HTML, runs it through sharp (resize + WebP), saves to the
 *  subdomain's shared `assets/` dir by content hash, and rewrites URLs in
 *  the HTML. Best-effort: any failure leaves the original hotlink intact
 *  so the published page degrades gracefully to the Unsplash CDN.
 *
 *  Why on publish (not on pick): edit-time stays fast (free Unsplash CDN),
 *  but the published page becomes self-contained — no external dependency
 *  for hero images. Reliability of the user's landing page is the priority. */
async function migrateUnsplashAssets(params: {
  html: string;
  subDir: string;
}): Promise<string> {
  const { html, subDir } = params;
  const matches = new Set<string>();
  let m: RegExpExecArray | null;
  UNSPLASH_URL_RE.lastIndex = 0;
  while ((m = UNSPLASH_URL_RE.exec(html)) !== null) {
    matches.add(m[0]);
  }
  if (matches.size === 0) return html;

  const targetDir = safeJoin(subDir, "assets");
  await mkdir(targetDir, { recursive: true });

  // url-as-found-in-HTML → replacement path (or unchanged on failure).
  const urlMap = new Map<string, string>();

  await Promise.all(
    Array.from(matches).map(async (htmlUrl) => {
      const fetchUrl = decodeHtmlEntitiesInUrl(htmlUrl);
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), UNSPLASH_FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(fetchUrl, {
            redirect: "follow",
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          urlMap.set(htmlUrl, htmlUrl);
          return;
        }
        const raw = Buffer.from(await response.arrayBuffer());
        if (raw.length === 0 || raw.length > UNSPLASH_MAX_BYTES) {
          urlMap.set(htmlUrl, htmlUrl);
          return;
        }

        const optimized = await sharp(raw)
          .rotate()
          .resize({
            width: 2000,
            height: 2000,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85, effort: 4 })
          .toBuffer();

        const hash = createHash("sha256")
          .update(optimized)
          .digest("hex")
          .slice(0, 16);
        const filename = `${hash}.webp`;
        const dst = path.join(targetDir, filename);

        // Hash-based dedupe: if it's already there, skip the write entirely.
        let exists = false;
        try {
          await stat(dst);
          exists = true;
        } catch {
          /* not there yet */
        }
        if (!exists) {
          await writeFile(dst, optimized);
        }

        urlMap.set(htmlUrl, `/assets/${filename}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[publishToDir] unsplash migrate failed", htmlUrl, err);
        urlMap.set(htmlUrl, htmlUrl);
      }
    }),
  );

  // Rewrite — only URLs that successfully migrated get replaced. Failed
  // ones stay as the original Unsplash hotlink (graceful degradation).
  return html.replace(UNSPLASH_URL_RE, (match) => {
    const replacement = urlMap.get(match);
    return replacement && replacement !== match ? replacement : match;
  });
}

export interface PublishResult {
  /** First 12 chars of sha256(optimized HTML). Stable per content. */
  sha: string;
  /** The optimized HTML actually written to disk (used by R2 backup). */
  html: string;
  /** True if a new release dir was created. False if `releases/<sha>/` already existed (idempotent re-publish). */
  written: boolean;
}

/**
 * Publish `html` as a new release for `subdomain` and atomically flip the
 * `current` symlink. The release directory is content-addressed by SHA, so
 * re-publishing identical HTML is a no-op (just re-flips the symlink to the
 * same target, which is also a no-op).
 *
 * Either the new release is current, or the previous one still is. Never an
 * in-between (symlink swap via rename(2) is atomic on POSIX).
 */
export async function publishToDir(
  params: PublishParams,
): Promise<PublishResult> {
  const v = validateSubdomain(params.subdomain);
  if (!v.ok) {
    throw new Error(`publishToDir: invalid subdomain (${v.reason})`);
  }
  if (detectSlotPath(params.html)) {
    throw new Error(
      "publishToDir: refusing to write HTML containing data-slot-path (editor-mode leaked into publish path)",
    );
  }

  const sub = v.value;
  const root = getRoot();
  const subDir = safeJoin(root, sub);
  const releasesDir = safeJoin(subDir, "releases");
  await mkdir(releasesDir, { recursive: true });

  // Optimize for production before computing the SHA so identical post-
  // optimization output (e.g. user clicks Deploy twice without editing)
  // dedupes on disk.
  const optimized = await optimizeHtmlForProduction(params.html);

  // Consolidate Unsplash credits BEFORE the asset migrations below. We need
  // to see the original `images.unsplash.com` URLs to detect anonymous
  // (paste-URL / template-baked) photos; after migrateUnsplashAssets rewrites
  // them to `/assets/<sha>.webp`, the Unsplash provenance is lost. Soft-fail
  // so a cheerio parse hiccup never blocks a publish.
  let creditedHtml = optimized.html;
  try {
    creditedHtml = consolidateUnsplashCredits(optimized.html).html;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] credit consolidation failed; using uncredited HTML", err);
  }

  // Move LocalFs uploads to the subdomain's shared assets dir and rewrite
  // their URLs so nginx serves them directly. SHA is computed AFTER this
  // rewrite so a republish with the same assets still dedupes to one
  // release. S3-backed URLs (absolute, non-`/api/projects/.../assets/`)
  // pass through untouched.
  let migratedHtml = creditedHtml;
  if (params.projectId) {
    try {
      migratedHtml = await migrateLocalAssets({
        html: creditedHtml,
        projectId: params.projectId,
        subDir,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] asset migration failed; using unrewritten HTML", err);
      migratedHtml = creditedHtml;
    }
  }

  // Cache-on-publish for Unsplash hotlinks — download, optimize, and
  // serve from the subdomain's assets dir so the published page doesn't
  // depend on Unsplash being up at every visitor request. Failures fall
  // back to the original hotlink.
  try {
    migratedHtml = await migrateUnsplashAssets({
      html: migratedHtml,
      subDir,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] unsplash migration failed; using hotlinks", err);
  }

  // Wire <form>s to the OpenLen submit endpoint + inject the inline-submit
  // script. Done last so the action lands on the final asset-rewritten HTML.
  // Soft-fail — a cheerio hiccup must never block a publish.
  try {
    migratedHtml = wirePublishedForms(migratedHtml, sub, params.formConfigs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[publishToDir] form wiring failed; publishing without it", err);
  }

  // Inject the per-project logo (favicon + fallback og:image) BEFORE the
  // analytics snippet so the resulting <head> ordering ends with the
  // tracker, not the brand assets — matches how every other publish-time
  // injector layers in. Soft-fail.
  if (params.logoUrl) {
    try {
      migratedHtml = injectLogoIntoHtml({
        html: migratedHtml,
        logoUrl: params.logoUrl,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[publishToDir] logo injection failed; publishing without it", err);
    }
  }

  // Inject the analytics tracker snippet (lib/analytics/snippet.ts). Done
  // AFTER all other HTML rewrites so the snippet position is stable + the
  // string-literal projectId in the snippet survives any later transforms.
  // Skipped when: (a) no projectId (apex/dev publishes), or (b) the
  // project's settings.analyticsDisabled is true (user opt-out).
  const analyticsEnabled = params.analyticsEnabled ?? true;
  if (params.projectId && analyticsEnabled) {
    migratedHtml = injectAnalyticsSnippet(migratedHtml, params.projectId);
  }

  const sha = computeSha(migratedHtml);

  const releaseDir = safeJoin(releasesDir, sha);
  let written = false;

  // Skip the write if this exact release already exists (re-publish of
  // identical content). We still flip the symlink below so the live site
  // reliably points at the latest call.
  let releaseExists = false;
  try {
    await stat(releaseDir);
    releaseExists = true;
  } catch {
    // ENOENT — first publish for this content hash.
  }

  if (!releaseExists) {
    const tmpDir = safeJoin(releasesDir, `.tmp-${sha}-${randomUUID()}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      await writeFile(path.join(tmpDir, "index.html"), migratedHtml, "utf8");
      await rename(tmpDir, releaseDir);
      written = true;
    } finally {
      // If rename succeeded, tmpDir is consumed and this is a no-op.
      // If rename failed (e.g. race with another publish that won), clean
      // up the orphaned tmpdir.
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Atomically flip the current symlink. symlink(target, current.new) then
  // rename(current.new, current) is atomic across POSIX. We use a relative
  // target so the symlink survives the dir being moved (and so a `cp -a` of
  // /var/www/openlen for backup/restore preserves it).
  const currentPath = safeJoin(subDir, "current");
  const currentNew = safeJoin(subDir, `.current-${randomUUID()}.new`);
  await symlink(path.join("releases", sha), currentNew).catch(async (err) => {
    // On Windows symlinks need admin/dev-mode. In tests, fall back to a
    // marker file so the test environment still works.
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      await writeFile(currentNew, sha, "utf8");
      return;
    }
    throw err;
  });
  await rename(currentNew, currentPath);

  // Best-effort prune of old releases. Keep the RELEASES_KEEP newest by
  // mtime; never delete the one `current` points at, just in case the
  // caller is currently rolling back.
  await pruneOldReleases(releasesDir, sha).catch(() => {});

  return { sha, html: migratedHtml, written };
}

/**
 * Roll back the live site for `subdomain` to a prior release. Just flips
 * the `current` symlink — no HTML regeneration. Caller is responsible for
 * updating `projects.publishedHtml` + cache purge.
 */
export async function rollbackToSha(
  subdomain: string,
  sha: string,
): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`rollbackToSha: invalid subdomain (${v.reason})`);
  }
  if (!/^[a-f0-9]{1,64}$/.test(sha)) {
    throw new Error("rollbackToSha: invalid sha");
  }

  const root = getRoot();
  const subDir = safeJoin(root, v.value);
  const releaseDir = safeJoin(subDir, "releases", sha);
  try {
    await stat(releaseDir);
  } catch {
    throw new ReleaseNotFoundError(v.value, sha);
  }

  const currentPath = safeJoin(subDir, "current");
  const currentNew = safeJoin(subDir, `.current-${randomUUID()}.new`);
  await symlink(path.join("releases", sha), currentNew).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code === "EPERM") {
      await writeFile(currentNew, sha, "utf8");
      return;
    }
    throw err;
  });
  await rename(currentNew, currentPath);
}

/**
 * Read the HTML of a specific release. Used by the rollback handler to
 * sync `projects.publishedHtml` with the on-disk content.
 */
export async function readRelease(
  subdomain: string,
  sha: string,
): Promise<string> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`readRelease: invalid subdomain (${v.reason})`);
  }
  if (!/^[a-f0-9]{1,64}$/.test(sha)) {
    throw new Error("readRelease: invalid sha");
  }
  const root = getRoot();
  const file = safeJoin(root, v.value, "releases", sha, "index.html");
  try {
    return await readFile(file, "utf8");
  } catch {
    throw new ReleaseNotFoundError(v.value, sha);
  }
}

export interface ReleaseSummary {
  sha: string;
  mtime: Date;
  isCurrent: boolean;
}

/**
 * List releases for a subdomain (newest first by mtime). Used by the
 * "Previous deploys" UI in TopBar.
 */
export async function listReleases(
  subdomain: string,
): Promise<ReleaseSummary[]> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return [];
  const root = getRoot();
  const releasesDir = safeJoin(root, v.value, "releases");
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch {
    return [];
  }
  const currentSha = await getCurrentReleaseSha(v.value);
  const items = await Promise.all(
    names
      .filter((n) => !n.startsWith("."))
      .map(async (sha) => {
        try {
          const s = await stat(path.join(releasesDir, sha));
          if (!s.isDirectory()) return null;
          return { sha, mtime: s.mtime, isCurrent: sha === currentSha };
        } catch {
          return null;
        }
      }),
  );
  return items
    .filter((x): x is ReleaseSummary => x !== null)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/**
 * Resolve the SHA the `current` symlink points at. Returns null if the
 * symlink doesn't exist (subdomain never published or unpublished).
 */
export async function getCurrentReleaseSha(
  subdomain: string,
): Promise<string | null> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) return null;
  const root = getRoot();
  const currentPath = safeJoin(root, v.value, "current");
  try {
    const target = await readlink(currentPath);
    // target is like "releases/abc123def456"
    const m = target.match(/(?:^|[\\/])releases[\\/](.+)$/);
    return m ? m[1] : null;
  } catch {
    // Fallback for the EPERM marker-file path (Windows test env).
    try {
      const content = await readFile(currentPath, "utf8");
      const trimmed = content.trim();
      return /^[a-f0-9]{1,64}$/.test(trimmed) ? trimmed : null;
    } catch {
      return null;
    }
  }
}

/**
 * Remove the entire subdomain directory (including all historical
 * releases). Idempotent. Called by `unpublishProject`.
 */
export async function unpublishDir(subdomain: string): Promise<void> {
  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    throw new Error(`unpublishDir: invalid subdomain (${v.reason})`);
  }
  const dir = safeJoin(getRoot(), v.value);
  await rm(dir, { recursive: true, force: true });
}

/**
 * Sweep stale tmp dirs under each subdomain. Called once at app startup
 * (instrumentation.ts).
 */
export async function cleanupStaleTmpDirs(): Promise<void> {
  const root = getRoot();
  let subs: string[];
  try {
    subs = await readdir(root);
  } catch {
    return;
  }
  const cutoff = Date.now() - 60 * 60 * 1000;
  await Promise.all(
    subs.map(async (sub) => {
      if (sub.startsWith(".") || sub === "_default") return;
      const releasesDir = path.join(root, sub, "releases");
      let entries: string[];
      try {
        entries = await readdir(releasesDir);
      } catch {
        return;
      }
      await Promise.all(
        entries
          .filter((n) => n.startsWith(".tmp-") || n.startsWith(".current-"))
          .map(async (name) => {
            const full = path.join(releasesDir, name);
            try {
              const s = await stat(full);
              if (s.mtimeMs < cutoff) {
                await rm(full, { recursive: true, force: true });
              }
            } catch {
              // Race or already gone.
            }
          }),
      );
    }),
  );
}

async function pruneOldReleases(
  releasesDir: string,
  protectSha: string,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(releasesDir);
  } catch {
    return;
  }
  const entries = await Promise.all(
    names
      .filter((n) => !n.startsWith("."))
      .map(async (sha) => {
        try {
          const s = await stat(path.join(releasesDir, sha));
          if (!s.isDirectory()) return null;
          return { sha, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
  );
  const valid = entries.filter(
    (x): x is { sha: string; mtimeMs: number } => x !== null,
  );
  if (valid.length <= RELEASES_KEEP) return;
  valid.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toDelete = valid.slice(RELEASES_KEEP).filter((x) => x.sha !== protectSha);
  await Promise.all(
    toDelete.map((x) =>
      rm(path.join(releasesDir, x.sha), { recursive: true, force: true }).catch(
        () => {},
      ),
    ),
  );
}
