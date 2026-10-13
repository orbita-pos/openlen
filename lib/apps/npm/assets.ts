// A package's CSS and images, imported like in Vite: `import "leaflet/dist/
// leaflet.css"` injects the sheet, `import icon from "leaflet/dist/images/
// marker-icon.png"` is a URL. Everything becomes text (data: URLs) so the
// canvas, the eyes and the release carry the same bytes with no binary path.
// Leaflet's default marker detection fails with data: URLs exactly as it fails
// with Vite's hashed names; the usual fix (import the images and pass them to
// L.Icon.Default.mergeOptions) works here too.
import path from "node:path";
import { rawUrl } from "./esm-url";
import type { GraphError } from "./fetch-graph";
import { esmOrigin } from "./paths";
import type { FetchLike } from "./registry";

export const MAX_ASSET_BYTES = 200 * 1024;
export const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".avif": "image/avif", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

interface AssetOptions {
  readonly fetch: FetchLike;
  readonly deadline: number;
  readonly origin?: string;
}

type Result = { ok: true; text: string } | { ok: false; error: GraphError };

async function fetchBytes(url: string, opts: AssetOptions): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: GraphError }> {
  const left = opts.deadline - Date.now();
  if (left <= 0) return { ok: false, error: { code: "unavailable", message: "esm.sh took too long" } };
  try {
    const res = await opts.fetch(url, { signal: AbortSignal.timeout(Math.min(30_000, left)) });
    if (res.status === 404) return { ok: false, error: { code: "not-found", message: `${url} not found` } };
    if (!res.ok) return { ok: false, error: { code: "build-failed", message: `esm.sh answered ${res.status} for ${url}` } };
    return { ok: true, bytes: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return { ok: false, error: { code: "unavailable", message: "esm.sh did not answer" } };
  }
}

function dataUrl(subpath: string, bytes: Buffer): string {
  const mime = MIME[path.posix.extname(subpath).toLowerCase()] ?? "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const isRelative = (ref: string) => !/^(?:data:|https?:|\/\/|\/|#)/i.test(ref);

async function stylesheet(name: string, version: string, subpath: string, opts: AssetOptions, depth: number): Promise<Result> {
  const origin = opts.origin ?? esmOrigin();
  const got = await fetchBytes(rawUrl(name, version, subpath, origin), opts);
  if (!got.ok) return got;
  let css = got.bytes.toString("utf8");
  const dir = path.posix.dirname(subpath);

  // @import "./x.css" (relative only), inlined up to three levels.
  for (const m of [...css.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?\s*;/g)]) {
    if (!isRelative(m[1]!) || depth >= 3) continue;
    const inner = await stylesheet(name, version, path.posix.normalize(path.posix.join(dir, m[1]!)), opts, depth + 1);
    if (!inner.ok) return inner;
    css = css.replace(m[0], inner.text);
  }

  // url(relative) → data: URL.
  for (const m of [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)]) {
    const ref = m[2]!.trim();
    if (!isRelative(ref)) continue;
    const assetPath = path.posix.normalize(path.posix.join(dir, ref.split(/[?#]/)[0]!));
    const bytes = await fetchBytes(rawUrl(name, version, assetPath, origin), opts);
    if (!bytes.ok) return bytes;
    if (bytes.bytes.length > MAX_ASSET_BYTES) {
      return { ok: false, error: { code: "too-large", message: `${assetPath} is over ${MAX_ASSET_BYTES / 1024} KB, too big to inline` } };
    }
    css = css.replace(m[0], `url("${dataUrl(assetPath, bytes.bytes)}")`);
  }
  if (Buffer.byteLength(css) > MAX_STYLESHEET_BYTES) {
    return { ok: false, error: { code: "too-large", message: `${subpath} is over ${MAX_STYLESHEET_BYTES / 1024 / 1024} MB with its images` } };
  }
  return { ok: true, text: css };
}

export async function fetchPackageAsset(name: string, version: string, subpath: string, opts: AssetOptions): Promise<Result> {
  if (subpath.toLowerCase().endsWith(".css")) return stylesheet(name, version, subpath, opts, 0);
  const got = await fetchBytes(rawUrl(name, version, subpath, opts.origin ?? esmOrigin()), opts);
  if (!got.ok) return got;
  if (got.bytes.length > MAX_ASSET_BYTES) return { ok: false, error: { code: "too-large", message: `${subpath} is over ${MAX_ASSET_BYTES / 1024} KB` } };
  return { ok: true, text: dataUrl(subpath, got.bytes) };
}
