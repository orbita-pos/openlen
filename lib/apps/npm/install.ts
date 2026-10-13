// INSTALLING (spec 2026-10-13): from "these imports have no package yet" or
// `npm install x` to a new /package.json and esm lock, with what the gate and
// esm.sh said as notes for Len. It only fetches and caches; it never saves a
// file: the caller saves the returned ones through its own door.
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { compilarCarpeta } from "@/lib/apps/compilador";
import type { AppDeProyecto } from "@/lib/projects/types";
import { fetchPackageAsset } from "./assets";
import { esmUrl, externalsFor } from "./esm-url";
import { fetchGraph, type GraphError } from "./fetch-graph";
import { checkResolved, chooseVersion, type GateDecision, type GateDeps } from "./gate";
import {
  catalogRange,
  catalogServes,
  catalogVersionOf,
  EMPTY_LOCK,
  FIXED_TO_CATALOG,
  readEsmLock,
  readPackageJson,
  satisfiesSafe,
  serializeEsmLock,
  serializePackageJson,
  sourceOf,
  type LockedModules,
  type LockedPackage,
  type PackageJson,
} from "./lock";
import { nodeOnlyBuiltinsIn, packageVersionsIn } from "./module-scan";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { getPackument } from "./registry";
import { isAssetSubpath, parseBareSpecifier, specifierOf } from "./specifier";
import { sha256Hex, type ModuleStore } from "./store";
import { fetchTypes } from "./types";

export const MAX_ESM_PACKAGES = 50;
export const MAX_MODULE_BYTES = 40 * 1024 * 1024;
export const INSTALL_DEADLINE_MS = 60_000;
/** How long a refusal (the gate's or esm.sh's, never a service that didn't
 *  answer) is remembered: saving again doesn't ask npm again. `npm install
 *  <name>` always asks. */
export const REFUSAL_TTL_MS = 10 * 60_000;
const MAX_REFUSALS = 500;
const refusals = new Map<string, { readonly message: string; readonly until: number }>();

export function clearRefusalCache(): void {
  refusals.clear();
}

const refusalKey = (catalog: string, add: InstallAdd) => [catalog, add.name, add.range ?? "", [...add.subpaths].sort().join(",")].join("\0");

function rememberRefusal(key: string, message: string, until: number): void {
  refusals.delete(key);
  refusals.set(key, { message, until });
  while (refusals.size > MAX_REFUSALS) refusals.delete(refusals.keys().next().value!);
}

export interface InstallAdd {
  readonly name: string;
  readonly range: string | null;
  readonly subpaths: readonly string[];
  /** Asked by name (`npm install x`): a package with no JavaScript entry is still recorded. */
  readonly explicit?: boolean;
}
export interface InstallRequest {
  readonly add: readonly InstallAdd[];
  readonly remove: readonly string[];
}
export interface NpmNote {
  readonly severity: "Error" | "Warning" | "Info";
  readonly message: string;
}
export interface InstallOutcome {
  readonly files: Readonly<Record<string, string>>;
  readonly notes: readonly NpmNote[];
  readonly installed: readonly string[];
}
export interface InstallDeps extends GateDeps {
  readonly store: ModuleStore;
  readonly deadlineMs?: number;
  readonly origin?: string;
}

type Files = Readonly<Record<string, string>>;
type Parts = {
  development: Record<string, LockedModules>;
  production: Record<string, LockedModules>;
  assets: Record<string, string>;
  warnings: string[];
  bytes: number;
};
interface Ctx {
  readonly app: AppDeProyecto;
  readonly deps: InstallDeps;
  readonly deadline: number;
  readonly dependencies: Record<string, string>;
  readonly packages: Record<string, LockedPackage>;
  readonly nested: Map<string, Promise<GateDecision>>;
}

const error = (message: string): NpmNote => ({ severity: "Error", message });
const warning = (message: string): NpmNote => ({ severity: "Warning", message });
const isFixed = (name: string) => (FIXED_TO_CATALOG as readonly string[]).includes(name);
const servesSubpath = (p: LockedPackage, subpath: string) => Object.hasOwn(p.development, subpath) || Object.hasOwn(p.assets, subpath);
const sortKeys = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function importedSpecifiers(files: Files, app: AppDeProyecto): readonly string[] {
  const inputs = Object.fromEntries(Object.entries(files).filter(([p]) => isCompileInputPath(p)));
  return compilarCarpeta({ carpeta: inputs, catalogo: app.catalogo }).paquetes;
}

export function pendingInstall(files: Files, app: AppDeProyecto): InstallRequest {
  const pkg = readPackageJson(files);
  const wanted = new Map<string, { range: string | null; subpaths: Set<string> }>();
  const want = (name: string, range: string | null, subpath: string) => {
    const w = wanted.get(name) ?? { range, subpaths: new Set<string>() };
    w.subpaths.add(subpath);
    wanted.set(name, w);
  };
  for (const spec of importedSpecifiers(files, app)) {
    const bare = parseBareSpecifier(spec);
    if (!bare || isFixed(bare.name)) continue;
    const source = sourceOf(bare.name, files, app.catalogo);
    if (source.kind === "missing") want(bare.name, source.range, bare.subpath);
    else if (source.kind === "esm" && bare.subpath && !servesSubpath(source.locked, bare.subpath)) want(bare.name, pkg?.dependencies?.[bare.name] ?? null, bare.subpath);
    else if (source.kind === "catalog" && pkg && !pkg.dependencies?.[bare.name]) want(bare.name, null, bare.subpath);
  }
  for (const [name, range] of Object.entries(pkg?.dependencies ?? {})) {
    if (!wanted.has(name) && sourceOf(name, files, app.catalogo).kind === "missing") want(name, range, "");
  }
  return { add: [...wanted].map(([name, w]) => ({ name, range: w.range, subpaths: [...w.subpaths] })), remove: [] };
}

function graphMessage(name: string, version: string, subpath: string, e: GraphError): string {
  switch (e.code) {
    case "not-found":
      return `${specifierOf(name, subpath)}@${version}: esm.sh has no such file (${e.message}).`;
    case "build-failed":
      return `${name}@${version}: esm.sh could not build it: ${e.message}.`;
    case "too-large":
      return `${name}@${version}: ${e.message}; not installed.`;
    default:
      return `${name}: the package service did not answer; nothing was installed. Try again.`;
  }
}

async function nestedProblem(urls: readonly string[], name: string, version: string, ctx: Ctx): Promise<string | null> {
  const seen = new Set<string>();
  for (const url of urls) {
    for (const v of packageVersionsIn(url)) {
      const key = `${v.name}@${v.version}`;
      if (v.name === name || seen.has(key)) continue;
      seen.add(key);
      let decision = ctx.nested.get(key);
      if (!decision) {
        decision = checkResolved(v.name, v.version, ctx.deps);
        ctx.nested.set(key, decision);
      }
      const d = await decision;
      if (d.ok || d.code === "unavailable") continue;
      return d.code === "too-new"
        ? `${name}@${version} depends on ${d.message}; not installed.`
        : `${name}@${version} was not installed: one of its dependencies — ${d.message}`;
    }
  }
  return null;
}

async function lockParts(
  name: string,
  version: string,
  subpaths: readonly string[],
  externals: readonly string[],
  ctx: Ctx,
): Promise<{ ok: true; parts: Parts; discovered: InstallAdd[] } | { ok: false; message: string; code: GraphError["code"] | "refused" }> {
  const parts: Parts = { development: {}, production: {}, assets: {}, warnings: [], bytes: 0 };
  const bare = new Set<string>();
  const urls: string[] = [];
  for (const subpath of subpaths) {
    if (isAssetSubpath(subpath)) {
      const a = await fetchPackageAsset(name, version, subpath, { fetch: ctx.deps.fetch, deadline: ctx.deadline, origin: ctx.deps.origin });
      if (!a.ok) return { ok: false, message: graphMessage(name, version, subpath, a.error), code: a.error.code };
      const sha = sha256Hex(a.text);
      await ctx.deps.store.put(sha, a.text);
      parts.assets[subpath] = sha;
      continue;
    }
    for (const mode of ["development", "production"] as const) {
      const g = await fetchGraph(esmUrl({ name, version, subpath, mode, externals }, ctx.deps.origin), {
        fetch: ctx.deps.fetch,
        maxBytes: MAX_MODULE_BYTES,
        deadline: ctx.deadline,
      });
      if (!g.ok) return { ok: false, message: graphMessage(name, version, subpath, g.error), code: g.error.code };
      const moduleUrls = g.graph.modules.map((m) => m.url);
      const refused = await nestedProblem(moduleUrls, name, version, ctx);
      if (refused) return { ok: false, message: refused, code: "refused" };
      for (const m of g.graph.modules) {
        await ctx.deps.store.put(m.sha, m.code);
        parts.bytes += m.code.length;
      }
      urls.push(...moduleUrls);
      (mode === "development" ? parts.development : parts.production)[subpath] = {
        entry: g.graph.entry,
        modules: Object.fromEntries(g.graph.modules.map((m) => [m.url, m.sha])),
      };
      for (const b of g.graph.bare) bare.add(b);
    }
  }
  const nodeOnly = nodeOnlyBuiltinsIn(urls);
  if (nodeOnly.length > 0) parts.warnings.push(`${name}@${version} uses Node's ${nodeOnly.join(", ")}; that part won't work in the browser.`);
  // What esm.sh left bare: React (the catalog's) or one of this app's esm.sh
  // packages marked external — whose subpath must be locked too.
  const discovered: InstallAdd[] = [];
  for (const spec of bare) {
    const b = parseBareSpecifier(spec);
    if (b && !isFixed(b.name) && externals.includes(b.name)) discovered.push({ name: b.name, range: null, subpaths: [b.subpath] });
  }
  return { ok: true, parts, discovered };
}

async function typesFor(name: string, version: string, ctx: Ctx): Promise<Pick<LockedPackage, "types" | "typesFrom"> | null> {
  const got = await fetchTypes(name, version, { fetch: ctx.deps.fetch, gate: ctx.deps, deadline: ctx.deadline, origin: ctx.deps.origin }).catch(() => null);
  if (!got) return null;
  const shas: Record<string, string> = {};
  for (const [p, text] of Object.entries(got.files)) {
    const sha = sha256Hex(text);
    await ctx.deps.store.put(sha, text);
    shas[p] = sha;
  }
  return { types: shas, typesFrom: { name: got.name, version: got.version } };
}

type OneOutcome = { notes: NpmNote[]; installed: string | null; discovered: InstallAdd[]; refused?: string };

async function installOne(add: InstallAdd, ctx: Ctx): Promise<OneOutcome> {
  const { app, dependencies, packages, deps } = ctx;
  const nothing = (note?: NpmNote): OneOutcome => ({ notes: note ? [note] : [], installed: null, discovered: [] });
  // A refusal worth remembering: the answer, not a service that didn't give one.
  const refused = (message: string, code: string): OneOutcome => ({ ...nothing(error(message)), ...(code === "unavailable" ? {} : { refused: message }) });

  if (isFixed(add.name)) {
    const v = catalogVersionOf(app.catalogo, add.name)!;
    if (add.range && !satisfiesSafe(v, add.range)) return nothing(error(`${add.name} is fixed to ${v} in this app (one copy); other versions can't be installed.`));
    dependencies[add.name] = catalogRange(app.catalogo, add.name);
    return nothing();
  }

  const catalogVersion = catalogVersionOf(app.catalogo, add.name);
  if (catalogServes(app.catalogo, add.name) && (add.range === null || catalogVersion === null || satisfiesSafe(catalogVersion, add.range))) {
    dependencies[add.name] = add.range ?? catalogRange(app.catalogo, add.name);
    return nothing();
  }

  const range = add.range ?? dependencies[add.name] ?? null;
  const existing = packages[add.name];
  if (existing && (range === null || satisfiesSafe(existing.version, range))) {
    const missing = add.subpaths.filter((s) => !servesSubpath(existing, s));
    dependencies[add.name] = range ?? `^${existing.version}`;
    if (missing.length === 0) return nothing();
    const more = await lockParts(add.name, existing.version, missing, existing.externals, ctx);
    if (!more.ok) return refused(more.message, more.code);
    packages[add.name] = {
      ...existing,
      development: { ...existing.development, ...more.parts.development },
      production: { ...existing.production, ...more.parts.production },
      assets: { ...existing.assets, ...more.parts.assets },
      bytes: existing.bytes + more.parts.bytes,
    };
    return { notes: more.parts.warnings.map(warning), installed: null, discovered: more.discovered };
  }

  if (!existing && Object.keys(packages).length >= MAX_ESM_PACKAGES) {
    return nothing(error(`this app already has ${MAX_ESM_PACKAGES} packages outside its catalog; ${add.name} was not installed.`));
  }
  const decision = await chooseVersion(add.name, add.range, deps);
  if (!decision.ok) return refused(decision.message, decision.code);
  const manifest = decision.packument.versions[decision.version] ?? { version: decision.version };
  const externals = externalsFor(manifest, new Set(Object.keys(packages).filter((n) => n !== add.name)));
  const subpaths = add.subpaths.length > 0 ? add.subpaths : [""];
  let parts = await lockParts(add.name, decision.version, subpaths, externals, ctx);
  const warnings: string[] = [];
  if (!parts.ok && add.explicit && parts.code === "not-found" && subpaths.every((s) => s === "")) {
    // `npm install @fontsource/inter`: no JavaScript entry, only files by path.
    parts = { ok: true, parts: { development: {}, production: {}, assets: {}, warnings: [], bytes: 0 }, discovered: [] };
    warnings.push(`${add.name}@${decision.version} has no JavaScript entry; import its files by path (${add.name}/<file>).`);
  }
  if (!parts.ok) return refused(parts.message, parts.code);
  warnings.push(...parts.parts.warnings);
  const reactVersion = catalogVersionOf(app.catalogo, "react");
  const peerReact = manifest.peerDependencies?.react;
  if (peerReact && reactVersion && !satisfiesSafe(reactVersion, peerReact)) {
    warnings.push(`${add.name}@${decision.version} declares react ${peerReact}; this app uses ${reactVersion}.`);
  }
  const types = await typesFor(add.name, decision.version, ctx);
  if (!types) warnings.push(`${add.name}@${decision.version} has no TypeScript types; what it exports is typed as any.`);
  packages[add.name] = {
    version: decision.version,
    publishedAt: decision.publishedAt,
    externals,
    development: parts.parts.development,
    production: parts.parts.production,
    assets: parts.parts.assets,
    types: types?.types ?? null,
    ...(types?.typesFrom ? { typesFrom: types.typesFrom } : {}),
    warnings,
    bytes: parts.parts.bytes,
  };
  dependencies[add.name] = add.range ?? `^${decision.version}`;
  const check = decision.malwareCheck === "unavailable" ? " (malware check unavailable)" : "";
  return {
    notes: [{ severity: "Info", message: `Installed ${add.name}@${decision.version} from npm (esm.sh)${check}.` }, ...warnings.map(warning)],
    installed: `${add.name}@${decision.version}`,
    discovered: parts.discovered,
  };
}

/**
 * A package installed before another it depends on must now leave that one
 * external: one copy. Returns the subpaths of externals its new graph imports,
 * which the next round locks.
 */
async function reExternalize(ctx: Ctx, notes: NpmNote[]): Promise<InstallAdd[]> {
  const discovered: InstallAdd[] = [];
  for (const [name, locked] of Object.entries(ctx.packages)) {
    const manifest = (await getPackument(name, ctx.deps.fetch).catch(() => null))?.versions[locked.version];
    if (!manifest) continue;
    const externals = externalsFor(manifest, new Set(Object.keys(ctx.packages).filter((n) => n !== name)));
    if (externals.join(",") === locked.externals.join(",")) continue;
    const parts = await lockParts(name, locked.version, Object.keys(locked.development), externals, ctx);
    if (!parts.ok) {
      notes.push(error(parts.message));
      continue;
    }
    ctx.packages[name] = { ...locked, externals, development: parts.parts.development, production: parts.parts.production, bytes: parts.parts.bytes };
    discovered.push(...parts.discovered);
  }
  return discovered;
}

export async function installForApp(args: { readonly files: Files; readonly app: AppDeProyecto; readonly request: InstallRequest; readonly deps: InstallDeps }): Promise<InstallOutcome> {
  const { files, app, request, deps } = args;
  const pkgBefore = readPackageJson(files);
  const ctx: Ctx = {
    app,
    deps,
    deadline: Date.now() + (deps.deadlineMs ?? INSTALL_DEADLINE_MS),
    dependencies: { ...(pkgBefore?.dependencies ?? {}) },
    packages: { ...readEsmLock(files).packages },
    nested: new Map(),
  };
  const notes: NpmNote[] = [];
  const installed: string[] = [];

  for (const name of request.remove) {
    if (!(name in ctx.dependencies) && !(name in ctx.packages)) notes.push(warning(`${name} is not in /package.json.`));
    delete ctx.dependencies[name];
    delete ctx.packages[name];
  }

  // Rounds: install what was asked (and the subpaths its graphs import), then
  // re-externalize what the new packages share; what that uncovers is the next
  // round. Three rounds are plenty: each one only adds subpaths.
  let queue: InstallAdd[] = [...request.add];
  for (let round = 0; round < 3 && queue.length > 0; round++) {
    const next: InstallAdd[] = [];
    let installedThisRound = false;
    for (let i = 0; i < queue.length; i++) {
      const add = queue[i]!;
      if (Date.now() > ctx.deadline) {
        notes.push(error(`${add.name}: installing took longer than ${INSTALL_DEADLINE_MS / 1000} s; it was not installed. Try again.`));
        continue;
      }
      const key = refusalKey(app.catalogo, add);
      const now = deps.now().getTime();
      const known = add.explicit ? undefined : refusals.get(key);
      if (known && known.until > now) {
        notes.push(error(known.message));
        continue;
      }
      const r = await installOne(add, ctx);
      if (r.refused) rememberRefusal(key, r.refused, now + REFUSAL_TTL_MS);
      else refusals.delete(key);
      notes.push(...r.notes);
      if (r.installed) {
        installed.push(r.installed);
        installedThisRound = true;
      }
      queue.push(...r.discovered);
    }
    if (installedThisRound) next.push(...(await reExternalize(ctx, notes)));
    queue = next;
  }

  const total = Object.values(ctx.packages).reduce((n, p) => n + p.bytes, 0);
  if (total > MAX_MODULE_BYTES) {
    return { files: {}, notes: [...notes.filter((n) => n.severity !== "Info"), error(`this app's packages would be over ${MAX_MODULE_BYTES / 1024 / 1024} MB of modules; nothing was installed.`)], installed: [] };
  }

  // A fresh package.json lists what the app already imports from the catalog.
  // Without one, nothing is written unless something was added (`npm install
  // recharts` adds a catalog package and nothing to the lock).
  const hasEsm = Object.keys(ctx.packages).length > 0;
  if (!pkgBefore && !hasEsm && Object.keys(ctx.dependencies).length === 0) return { files: {}, notes, installed };
  if (!pkgBefore) {
    for (const spec of importedSpecifiers(files, app)) {
      const name = parseBareSpecifier(spec)?.name;
      if (name && catalogServes(app.catalogo, name) && !(name in ctx.dependencies)) ctx.dependencies[name] = catalogRange(app.catalogo, name);
    }
  }

  const out: Record<string, string> = {};
  const before = JSON.stringify(sortKeys({ ...(pkgBefore?.dependencies ?? {}) }));
  const after = sortKeys(ctx.dependencies);
  if (!pkgBefore || before !== JSON.stringify(after)) {
    const pkg: PackageJson = { ...(pkgBefore ?? { name: "app", private: true, type: "module" }), dependencies: after };
    out[PACKAGE_JSON_PATH] = serializePackageJson(pkg);
  }
  const lockText = serializeEsmLock({ lockfileVersion: 1, packages: ctx.packages });
  if (lockText !== (files[ESM_LOCK_PATH] ?? serializeEsmLock(EMPTY_LOCK))) out[ESM_LOCK_PATH] = lockText;
  return { files: out, notes, installed };
}

export function listPackages(files: Files, app: AppDeProyecto): string {
  const deps = readPackageJson(files)?.dependencies ?? {};
  const names = Object.keys(deps).sort();
  if (names.length === 0) return "app\n└── (empty)\n";
  const rows = names.map((name, i) => {
    const s = sourceOf(name, files, app.catalogo);
    const label =
      s.kind === "esm"
        ? `${name}@${s.locked.version} (esm.sh)`
        : s.kind === "catalog"
          ? `${name}@${catalogVersionOf(app.catalogo, name) ?? "?"} (preinstalled)`
          : `${name} (not installed: ${deps[name]})`;
    return `${i === names.length - 1 ? "└──" : "├──"} ${label}`;
  });
  return `app\n${rows.join("\n")}\n`;
}
