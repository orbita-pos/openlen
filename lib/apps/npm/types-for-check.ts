// The .d.ts files of the app's esm.sh packages (from the lock, out of the
// cache), laid out under /node_modules like the catalog's types.json. One the
// cache lost is read again from esm.sh — from the package the lock says the
// types came from — and kept only if its hash matches, like modules and assets.
import { rawUrl } from "./esm-url";
import { fetchText } from "./fetch-graph";
import { lockedOrigin, readPackageJson, sourceOf, type LockedPackage } from "./lock";
import type { FetchLike } from "./registry";
import { defaultModuleStore, sha256Hex, type ModuleStore } from "./store";

/** "/node_modules/@types/x/index.d.ts" → { pkg: "@types/x", file: "index.d.ts" }. */
function splitTypesPath(p: string): { pkg: string; file: string } | null {
  const parts = p.replace(/^\/node_modules\//, "").split("/");
  const n = parts[0]?.startsWith("@") ? 2 : 1;
  if (parts.length <= n) return null;
  return { pkg: parts.slice(0, n).join("/"), file: parts.slice(n).join("/") };
}

async function refetch(name: string, locked: LockedPackage, p: string, sha: string, store: ModuleStore, fetchImpl: FetchLike): Promise<string | null> {
  const where = splitTypesPath(p);
  if (!where) return null;
  // Older locks don't say where the types came from: only the package's own are known.
  const version = locked.typesFrom?.name === where.pkg ? locked.typesFrom.version : where.pkg === name ? locked.version : null;
  if (!version) return null;
  const got = await fetchText(rawUrl(where.pkg, version, where.file, lockedOrigin(locked)), { fetch: fetchImpl, deadline: Date.now() + 20_000 });
  if (!got.ok || sha256Hex(got.text) !== sha) return null;
  await store.put(sha, got.text).catch(() => {});
  return got.text;
}

export async function npmTypesFor(
  files: Readonly<Record<string, string>>,
  catalogName: string,
  store: ModuleStore = defaultModuleStore(),
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(readPackageJson(files)?.dependencies ?? {})) {
    const source = sourceOf(name, files, catalogName);
    if (source.kind !== "esm" || !source.locked.types) continue;
    for (const [p, sha] of Object.entries(source.locked.types)) {
      const text = (await store.get(sha)) ?? (await refetch(name, source.locked, p, sha, store, fetchImpl));
      if (text !== null) out[p] = text;
    }
  }
  return out;
}
