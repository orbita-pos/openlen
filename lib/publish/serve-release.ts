// Serves one published release on a loopback port the way Caddy serves it in
// production (infra/caddy/Caddyfile, the `*.openlen.app` block), so the tools
// that look at what was published — the Flight Check and the card thumbnail —
// see what a visitor sees:
//
//   · any file of the release (`try_files {path} {path}/index.html /index.html`),
//     so an app's `/src/main.tsx` bundle, a site page's `/<slug>/index.html` and
//     a folder file like `/js/app.js` load;
//   · the compiled sources (`.jsx`, `.tsx`, `.ts`) as JavaScript, like Caddy's
//     `@fuentes` header;
//   · the subdomain's shared `/assets/` (fonts, images, hashed files);
//   · `/index.html` for anything else, like `try_files`.
//
// This used to live inside flight-check.ts and served only `/` and `/assets/`:
// an app's `<script src="/src/main.tsx">` got a 404, so the Flight Check
// measured an empty app.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/javascript; charset=utf-8",
  ".tsx": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export interface ServedRelease {
  readonly server: Server;
  readonly port: number;
  /** `127.0.0.1:<port>`, for the egress proxy and the SSRF guard. */
  readonly origin: string;
  readonly url: string;
}

async function isFile(p: string): Promise<boolean> {
  return stat(p).then((s) => s.isFile(), () => false);
}

/** The file Caddy would answer for this path, or null (a 404). */
export async function resolveReleasePath(subDir: string, releaseSha: string, pathname: string): Promise<string | null> {
  const releaseDir = path.join(subDir, "releases", releaseSha);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.split("/").some((s) => s === "..")) return null;
  if (decoded.startsWith("/assets/")) {
    const name = decoded.slice("/assets/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
    const file = path.join(subDir, "assets", name);
    return (await isFile(file)) ? file : null;
  }
  const inside = (p: string) => p === releaseDir || p.startsWith(releaseDir + path.sep);
  const direct = path.join(releaseDir, decoded);
  if (inside(direct) && decoded !== "/" && (await isFile(direct))) return direct;
  const index = path.join(releaseDir, decoded, "index.html");
  if (inside(index) && (await isFile(index))) return index;
  const home = path.join(releaseDir, "index.html");
  return (await isFile(home)) ? home : null;
}

export async function serveRelease(subDir: string, releaseSha: string): Promise<ServedRelease> {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const pathname = new URL(req.url ?? "/", "http://release.local").pathname;
      const file = await resolveReleasePath(subDir, releaseSha, pathname);
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      const bytes = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  };
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("release server failed to bind a port");
  }
  const origin = `127.0.0.1:${address.port}`;
  return { server, port: address.port, origin, url: `http://${origin}/` };
}
