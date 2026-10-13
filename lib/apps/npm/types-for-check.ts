// The .d.ts files of the app's esm.sh packages (from the lock, out of the
// cache), laid out under /node_modules like the catalog's types.json. One the
// cache lost is read again from esm.sh — from the package the lock says the
// types came from — and kept only if its hash matches, like modules and assets
// (several at a time).
import { rawUrl } from "./esm-url";
import { fetchText } from "./fetch-graph";
import { catalogPartsLocked, lockedOrigin, readEsmLock, readPackageJson, sourceOf, type LockedPackage } from "./lock";
import { mapLimited } from "./pool";
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
  const add = async (name: string, locked: LockedPackage) => {
    if (!locked.types) return;
    const types = Object.entries(locked.types);
    const texts = await mapLimited(types, async ([p, sha]) => (await store.get(sha)) ?? (await refetch(name, locked, p, sha, store, fetchImpl)));
    types.forEach(([p], i) => {
      if (texts[i] !== null) out[p] = texts[i]!;
    });
  };
  for (const name of Object.keys(readPackageJson(files)?.dependencies ?? {})) {
    const source = sourceOf(name, files, catalogName);
    if (source.kind === "esm") await add(name, source.locked);
  }
  // The parts of catalog packages: only what the catalog's types don't have.
  for (const name of Object.keys(readEsmLock(files).packages)) {
    const parts = catalogPartsLocked(name, files, catalogName);
    if (parts) await add(name, parts);
  }
  return out;
}
