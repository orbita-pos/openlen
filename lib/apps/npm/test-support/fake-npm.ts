// A fake npm registry, OSV and esm.sh on one local port, for tests. esm.sh is
// the root (its modules import each other by absolute path, like the real
// one); the registry answers under /-/registry/ and OSV under /-/osv/.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeVersion {
  readonly daysAgo: number;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface FakePackage {
  readonly name: string;
  readonly createdDaysAgo: number;
  readonly versions: Readonly<Record<string, FakeVersion>>;
  readonly latest?: string;
}

export interface FakeNpmOptions {
  readonly now: Date;
  readonly packages: readonly FakePackage[];
  /** esm.sh modules: "<path>?<query>" exactly as requested (no origin) → code. */
  readonly modules?: Readonly<Record<string, string>>;
  /** esm.sh raw files: "<name>@<version>/<subpath>" → contents. */
  readonly raw?: Readonly<Record<string, string | Uint8Array>>;
  /** "<name>@<version>" → a MAL- id. */
  readonly malware?: Readonly<Record<string, string>>;
}

export interface FakeNpm {
  readonly origin: string;
  readonly requests: string[];
  setDown(part: "esm" | "osv" | "registry", down: boolean): void;
  /** Points OPENLEN_ESM_ORIGIN / OPENLEN_NPM_REGISTRY / OPENLEN_OSV_API here; returns the restore. */
  useEnv(): () => void;
  close(): Promise<void>;
}

const MIME: Record<string, string> = { ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ts": "text/plain" };

export async function startFakeNpm(o: FakeNpmOptions): Promise<FakeNpm> {
  const down = new Set<string>();
  const requests: string[] = [];
  const iso = (days: number) => new Date(o.now.getTime() - days * 86_400_000).toISOString();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(`${req.method} ${url}`);
    if (url.startsWith("/-/registry/")) {
      if (down.has("registry")) return void res.writeHead(503).end("down");
      const name = decodeURIComponent(url.slice("/-/registry/".length));
      const pkg = o.packages.find((p) => p.name === name);
      if (!pkg) return void res.writeHead(404).end("{}");
      const versions = Object.keys(pkg.versions);
      const doc = {
        name,
        "dist-tags": { latest: pkg.latest ?? versions.at(-1) },
        versions: Object.fromEntries(versions.map((v) => [v, { version: v, ...pkg.versions[v] }])),
        time: { created: iso(pkg.createdDaysAgo), ...Object.fromEntries(versions.map((v) => [v, iso(pkg.versions[v]!.daysAgo)])) },
      };
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(doc));
    }
    if (url.startsWith("/-/osv/")) {
      if (down.has("osv")) return void res.writeHead(503).end("down");
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const q = JSON.parse(body || "{}") as { package?: { name?: string }; version?: string };
        const id = o.malware?.[`${q.package?.name}@${q.version}`];
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ vulns: id ? [{ id }] : [] }));
      });
      return;
    }
    if (down.has("esm")) return void res.writeHead(503).end("esm.sh is down");
    if (url.endsWith("?raw")) {
      const key = url.slice(1, -"?raw".length);
      const file = o.raw?.[key];
      if (file === undefined) return void res.writeHead(404).end("not found");
      const ext = key.slice(key.lastIndexOf("."));
      return void res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" }).end(file);
    }
    const code = o.modules?.[url];
    if (code === undefined) return void res.writeHead(404, { "content-type": "text/plain" }).end(`${url} not found`);
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(code);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    requests,
    setDown(part, isDown) {
      if (isDown) down.add(part);
      else down.delete(part);
    },
    useEnv() {
      const before = { esm: process.env.OPENLEN_ESM_ORIGIN, reg: process.env.OPENLEN_NPM_REGISTRY, osv: process.env.OPENLEN_OSV_API };
      process.env.OPENLEN_ESM_ORIGIN = origin;
      process.env.OPENLEN_NPM_REGISTRY = `${origin}/-/registry`;
      process.env.OPENLEN_OSV_API = `${origin}/-/osv`;
      return () => {
        for (const [k, v] of [["OPENLEN_ESM_ORIGIN", before.esm], ["OPENLEN_NPM_REGISTRY", before.reg], ["OPENLEN_OSV_API", before.osv]] as const) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
