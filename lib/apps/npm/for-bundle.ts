// What the bundler needs from the esm lock (spec 2026-10-13): each import the
// lock serves → its module URL, every module's code (cache first; esm.sh by its
// exact URL if the cache lost it, checked against its hash), and the packages'
// CSS and images as text. The canvas, the eyes and publishing never install: a
// module that can't be had is an error that names the package and the fix.
import type { Diagnostico } from "@/lib/apps/compilador";
import type { AppDeProyecto } from "@/lib/projects/types";
import type { EsmMode } from "./esm-url";
import { fetchText } from "./fetch-graph";
import { readEsmLock, readPackageJson, serializeEsmLock, sourceOf } from "./lock";
import { PACKAGE_JSON_PATH } from "./paths";
import type { FetchLike } from "./registry";
import { specifierOf } from "./specifier";
import { sha256Hex, type ModuleStore } from "./store";

export interface NpmBundleInput {
  /** Bare specifier the app (or a package) imports → the module URL it resolves to. */
  readonly entries: Readonly<Record<string, string>>;
  /** Module URL → its code. */
  readonly modules: Readonly<Record<string, string>>;
  /** Bare specifier of a package stylesheet → its CSS (images inlined). */
  readonly styles: Readonly<Record<string, string>>;
  /** Bare specifier of a package image or font → its data: URL. */
  readonly urls: Readonly<Record<string, string>>;
  /** Packages esm.sh serves in this app: the catalog must not serve them too. */
  readonly servedByEsm: readonly string[];
}

type Files = Readonly<Record<string, string>>;

async function moduleCode(url: string, sha: string, deps: { store: ModuleStore; fetch: FetchLike }): Promise<string | null> {
  const cached = await deps.store.get(sha);
  if (cached !== null) return cached;
  const got = await fetchText(url, { fetch: deps.fetch, deadline: Date.now() + 20_000 });
  if (!got.ok || sha256Hex(got.text) !== sha) return null;
  await deps.store.put(sha, got.text).catch(() => {});
  return got.text;
}

const missing = (name: string, what: string): Diagnostico => ({
  ruta: PACKAGE_JSON_PATH,
  linea: null,
  columna: null,
  mensaje: `${name}: ${what} is missing from the package cache and esm.sh didn't give back the same file. Run npm install ${name} to install it again.`,
});

export async function npmForBundle(
  files: Files,
  app: AppDeProyecto,
  mode: EsmMode,
  deps: { store: ModuleStore; fetch: FetchLike },
): Promise<{ ok: true; npm: NpmBundleInput | null; key: string } | { ok: false; errores: Diagnostico[] }> {
  const dependencies = readPackageJson(files)?.dependencies;
  if (!dependencies) return { ok: true, npm: null, key: "" };
  const entries: Record<string, string> = {};
  const modules: Record<string, string> = {};
  const styles: Record<string, string> = {};
  const urls: Record<string, string> = {};
  const servedByEsm: string[] = [];
  const errores: Diagnostico[] = [];
  for (const name of Object.keys(dependencies).sort()) {
    const source = sourceOf(name, files, app.catalogo);
    if (source.kind !== "esm") continue;
    servedByEsm.push(name);
    for (const [subpath, set] of Object.entries(mode === "development" ? source.locked.development : source.locked.production)) {
      entries[specifierOf(name, subpath)] = set.entry;
      for (const [url, sha] of Object.entries(set.modules)) {
        if (modules[url] !== undefined) continue;
        const code = await moduleCode(url, sha, deps);
        if (code === null) errores.push(missing(name, url));
        else modules[url] = code;
      }
    }
    for (const [subpath, sha] of Object.entries(source.locked.assets)) {
      const text = await deps.store.get(sha);
      const spec = specifierOf(name, subpath);
      if (text === null) errores.push(missing(name, spec));
      else (subpath.toLowerCase().endsWith(".css") ? styles : urls)[spec] = text;
    }
  }
  if (errores.length > 0) return { ok: false, errores };
  if (servedByEsm.length === 0) return { ok: true, npm: null, key: "" };
  const key = sha256Hex(`${mode}\n${JSON.stringify(dependencies)}\n${serializeEsmLock(readEsmLock(files))}`);
  return { ok: true, npm: { entries, modules, styles, urls, servedByEsm }, key };
}
