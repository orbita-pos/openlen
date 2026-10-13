// A package's TypeScript types for the checker (lib/apps/checker/), read raw
// from esm.sh (`?raw` keeps the original files and specifiers) into the same
// virtual node_modules layout as the catalogs' types.json. Its own types if it
// has them (`types`, `typings`, `exports["."].types`); else @types/<name> at
// the same major.minor, through the gate like any other version.
import path from "node:path";
import semver from "semver";
import { rawUrl } from "./esm-url";
import { fetchText } from "./fetch-graph";
import { checkResolved, type GateDeps } from "./gate";
import { esmOrigin } from "./paths";
import { getPackument, type FetchLike } from "./registry";

const MAX_FILES = 600;
const MAX_BYTES = 8 * 1024 * 1024;

interface TypesOptions {
  readonly fetch: FetchLike;
  readonly gate: GateDeps;
  readonly deadline: number;
  readonly origin?: string;
}

type Manifest = { types?: unknown; typings?: unknown; exports?: unknown };

/** The `types` of an `exports` entry, through its conditions. */
function pickTypes(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.types === "string") return o.types;
  for (const k of ["import", "default", "require"]) {
    const inner = pickTypes(o[k]);
    if (inner) return inner;
  }
  return null;
}

const exportOf = (manifest: Manifest, key: string): unknown =>
  manifest.exports && typeof manifest.exports === "object" ? (manifest.exports as Record<string, unknown>)[key] : null;

function typesEntryOf(manifest: Manifest): string | null {
  for (const v of [manifest.types, manifest.typings]) if (typeof v === "string") return v;
  return pickTypes(exportOf(manifest, "."));
}

/** Where a subpath's types may start ("" = the package's): its `exports` entry, else the file by name. */
function entriesFor(manifest: Manifest, subpath: string, rootFallback: string | null): string[] {
  if (subpath === "") {
    const entry = typesEntryOf(manifest) ?? rootFallback;
    return entry ? [entry] : [];
  }
  const entry = pickTypes(exportOf(manifest, `./${subpath}`));
  return entry ? [entry] : [`${subpath}.d.ts`, `${subpath}/index.d.ts`];
}

/** Every subpath's types, crawled from the first entry that exists; null if none has any. */
async function crawlSubpaths(pkg: string, version: string, manifest: { text: string; manifest: Manifest }, subpaths: readonly string[], rootFallback: string | null, opts: TypesOptions): Promise<Record<string, string> | null> {
  const files: Record<string, string> = {};
  let found = false;
  for (const subpath of subpaths) {
    for (const entry of entriesFor(manifest.manifest, subpath, rootFallback)) {
      const got = await crawl(pkg, version, entry, manifest.text, opts);
      if (!got) continue;
      Object.assign(files, got);
      found = true;
      break;
    }
  }
  return found ? files : null;
}

const mangle = (name: string) => (name.startsWith("@") ? name.slice(1).replace("/", "__") : name);

function candidatesFor(fromFile: string, spec: string): string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (base.endsWith(".d.ts") || base.endsWith(".d.mts") || base.endsWith(".d.cts")) return [base];
  if (/\.(?:m|c)?js$/.test(base)) return [base.replace(/\.js$/, ".d.ts").replace(/\.mjs$/, ".d.mts").replace(/\.cjs$/, ".d.cts")];
  return [`${base}.d.ts`, `${base}/index.d.ts`];
}

async function crawl(pkgName: string, pkgVersion: string, entry: string, manifestText: string, opts: TypesOptions): Promise<Record<string, string> | null> {
  const origin = opts.origin ?? esmOrigin();
  const root = `/node_modules/${pkgName}/`;
  const files: Record<string, string> = { [`${root}package.json`]: manifestText };
  const entryFile = path.posix.normalize(entry.replace(/^\.\//, ""));
  const queue = [entryFile];
  const seen = new Set(queue);
  let bytes = manifestText.length;
  while (queue.length > 0) {
    const file = queue.shift()!;
    const got = await fetchText(rawUrl(pkgName, pkgVersion, file, origin), opts);
    if (!got.ok) {
      // The entry missing means no types; another file missing is one of the
      // two candidates of a reference (x.d.ts / x/index.d.ts): try the next.
      if (file === entryFile) return null;
      continue;
    }
    files[`${root}${file}`] = got.text;
    bytes += got.text.length;
    if (Object.keys(files).length > MAX_FILES || bytes > MAX_BYTES) break;
    const refs = [
      ...[...got.text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]!),
      ...[...got.text.matchAll(/\/\/\/\s*<reference\s+path=["']([^"']+)["']/g)].map((m) => m[1]!),
    ];
    for (const ref of refs) {
      for (const candidate of candidatesFor(file, ref.startsWith(".") ? ref : `./${ref}`)) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          queue.push(candidate);
        }
      }
    }
  }
  return files;
}

async function manifestOf(name: string, version: string, opts: TypesOptions): Promise<{ text: string; manifest: Manifest } | null> {
  const got = await fetchText(rawUrl(name, version, "package.json", opts.origin ?? esmOrigin()), opts);
  if (!got.ok) return null;
  try {
    return { text: got.text, manifest: JSON.parse(got.text) as Manifest };
  } catch {
    return null;
  }
}

/** The .d.ts files, and the package they were read from (the package itself or its @types). */
export interface TypesFetched {
  readonly name: string;
  readonly version: string;
  readonly files: Record<string, string>;
}

/** `subpaths`: the parts whose types are wanted ("" = the package itself). */
export async function fetchTypes(name: string, version: string, opts: TypesOptions, subpaths: readonly string[] = [""]): Promise<TypesFetched | null> {
  const own = await manifestOf(name, version, opts);
  // A package that types its own entry types its parts too.
  if (own && typesEntryOf(own.manifest)) {
    const files = await crawlSubpaths(name, version, own, subpaths, null, opts);
    return files && { name, version, files };
  }

  const typesName = `@types/${mangle(name)}`;
  const doc = await getPackument(typesName, opts.fetch).catch(() => null);
  if (!doc) return null;
  const parsed = semver.parse(version);
  const candidates = Object.keys(doc.versions).filter((v) => semver.valid(v) && !semver.prerelease(v)).sort(semver.rcompare);
  const sameMinor = parsed ? candidates.filter((v) => semver.major(v) === parsed.major && semver.minor(v) === parsed.minor) : [];
  for (const v of [...sameMinor, ...candidates]) {
    if (!(await checkResolved(typesName, v, opts.gate)).ok) continue;
    const m = await manifestOf(typesName, v, opts);
    if (!m) return null;
    const files = await crawlSubpaths(typesName, v, m, subpaths, "index.d.ts", opts);
    return files && { name: typesName, version: v, files };
  }
  return null;
}
