import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { lookupDomain } from "@/lib/custom-domains";
import { NOT_FOUND_HTML } from "@/lib/publish/not-found-page";

// ─────────────────────────────────────────────────────────────────────────────
// Custom-domain HTML server (`/served/...`).
//
// Caddy receives a request like `https://landing.miempresa.com/about`,
// rewrites it to `/served/landing.miempresa.com/about`, and proxies here.
// This handler:
//
//   1. Looks up the host in `customDomains` (must be verified).
//   2. Resolves it to a project + subdomain.
//   3. Serves the static file from /var/www/openlen/<sub>/current/<path>
//      (or /var/www/openlen/<sub>/assets/<file> for /assets/* paths).
//
// The path prefix is `/served/` (not `/_custom/`) because Next.js App Router
// excludes any folder starting with `_` from the route tree — that
// convention is intentional, so we use a regular segment with a name
// unlikely to collide with a user route. Any unauthenticated probe to
// /served/<random> falls through to a 404 via lookupDomain returning null.
//
// Form submissions (POST /api/f/<sub>) and analytics beacons (POST /c/<id>)
// are NOT rewritten by Caddy — they hit the regular Next routes directly,
// so this handler only sees GET/HEAD for static page content.
//
// The architecture invariant says "no Node hop on published pages", which
// we preserve for *.openlen.com (Caddy serves directly from disk for the
// wildcard). Custom domains accept one Node hop in exchange for not having
// to dynamically rewrite the Caddy config every time a domain is added —
// the tradeoff is documented and revisitable when traffic justifies it.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLISH_ROOT = process.env.PUBLISH_ROOT?.trim() || "/var/www/openlen";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

const HTML_CACHE =
  "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400";
const ASSET_CACHE = "public, max-age=2592000, immutable";

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function cacheControlFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".html" || ext === ".htm" || ext === "") return HTML_CACHE;
  return ASSET_CACHE;
}

/** Reject paths that try to escape the subdomain root via `..`, null bytes,
 *  or any character that wouldn't appear in a legitimate static asset path. */
function isPathSafe(parts: string[]): boolean {
  for (const p of parts) {
    if (!p) continue;
    if (p === "." || p === "..") return false;
    if (p.includes("\0")) return false;
    if (p.includes("/") || p.includes("\\")) return false;
    if (p.length > 200) return false;
  }
  return true;
}

interface ResolvedFile {
  absolutePath: string;
  contentType: string;
  cacheControl: string;
}

/** Segments that stand in for the live release. Normally `current` is a
 *  symlink to `releases/<sha>` and resolves on its own. Where symlinks need
 *  privileges (Windows dev), publishToDir falls back to writing the sha into
 *  `current` as a regular FILE — read it so local dev serves the release
 *  instead of 404ing on a path that isn't a directory. */
async function currentSegments(subDir: string): Promise<string[]> {
  try {
    const s = await stat(path.join(subDir, "current"));
    if (s.isDirectory()) return ["current"];
    const sha = (await readFile(path.join(subDir, "current"), "utf8")).trim();
    // Our own file, but it composes a path — keep it to a bare hex token.
    if (!/^[a-f0-9]{6,64}$/i.test(sha)) return ["current"];
    return ["releases", sha];
  } catch {
    return ["current"];
  }
}

/** Mirror the nginx wildcard root layout: requests to / return index.html,
 *  paths under /assets/ resolve to the shared assets dir (sibling of
 *  `current/`), and everything else lives under the current release. */
function resolveFile(
  subdomain: string,
  pathParts: string[],
  releaseSegments: string[],
): ResolvedFile | null {
  if (!isPathSafe(pathParts)) return null;
  const subDir = path.join(PUBLISH_ROOT, subdomain);

  // /assets/<file> — published-asset cache (Unsplash hotlinks, LocalFs
  // uploads). Lives in <sub>/assets/, shared across releases.
  if (pathParts[0] === "assets" && pathParts.length >= 2) {
    const filename = pathParts.slice(1).join("/");
    const absolutePath = path.join(subDir, "assets", filename);
    return {
      absolutePath,
      contentType: contentTypeFor(filename),
      cacheControl: ASSET_CACHE,
    };
  }

  // Empty path or trailing-slash directory → index.html in current release.
  if (pathParts.length === 0 || pathParts[pathParts.length - 1] === "") {
    const indexParts =
      pathParts.length === 0 ? ["index.html"] : [...pathParts, "index.html"];
    const absolutePath = path.join(subDir, ...releaseSegments, ...indexParts);
    return {
      absolutePath,
      contentType: "text/html; charset=utf-8",
      cacheControl: HTML_CACHE,
    };
  }

  // Specific file under the current release.
  const absolutePath = path.join(subDir, ...releaseSegments, ...pathParts);
  return {
    absolutePath,
    contentType: contentTypeFor(absolutePath),
    cacheControl: cacheControlFor(absolutePath),
  };
}

async function serve(
  params: { host: string; path?: string[] },
  includeBody: boolean,
): Promise<Response> {
  const host = params.host.toLowerCase();
  const found = await lookupDomain(host);
  if (!found || !found.verified || !found.subdomain) {
    return notFound(includeBody);
  }

  const releaseSegments = await currentSegments(
    path.join(PUBLISH_ROOT, found.subdomain),
  );
  const resolved = resolveFile(
    found.subdomain,
    params.path ?? [],
    releaseSegments,
  );
  if (!resolved) return notFound(includeBody);

  // Containment check — never let a constructed path escape the publish root.
  const rootNorm = path.normalize(PUBLISH_ROOT) + path.sep;
  const absNorm = path.normalize(resolved.absolutePath);
  if (!absNorm.startsWith(rootNorm)) return notFound(includeBody);

  let body: ArrayBuffer | null = null;
  let size: number;
  try {
    const s = await stat(absNorm);
    if (!s.isFile()) return notFound(includeBody);
    size = s.size;
    if (includeBody) {
      const buf = await readFile(absNorm);
      // Slice into a standalone ArrayBuffer — node's `Buffer` shares a pool
      // ArrayBuffer with other allocations, and the Response constructor in
      // newer @types/node typings rejects Uint8Array<ArrayBufferLike>.
      const ab = new ArrayBuffer(buf.byteLength);
      new Uint8Array(ab).set(buf);
      body = ab;
    }
  } catch {
    return notFound(includeBody);
  }

  const headers: Record<string, string> = {
    "Content-Type": resolved.contentType,
    "Content-Length": String(size),
    "Cache-Control": resolved.cacheControl,
    ...SECURITY_HEADERS,
  };

  return new Response(includeBody ? body : null, { status: 200, headers });
}

// The branded dead-link page (same HTML Caddy serves for dead *.openlen.com
// subdomains via handle_errors). Body omitted on HEAD per spec.
function notFound(includeBody: boolean): Response {
  return new Response(includeBody ? NOT_FOUND_HTML : null, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ host: string; path?: string[] }> },
): Promise<Response> {
  return serve(await params, true);
}

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ host: string; path?: string[] }> },
): Promise<Response> {
  return serve(await params, false);
}
