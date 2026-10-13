// INSTALLING (spec 2026-10-13): from "these imports have no package yet" or
// `npm install x` to a new /package.json and esm lock, with what the gate and
// esm.sh said as notes for Len. It only fetches and caches; it never saves a
// file: the caller saves the returned ones through its own door.
import { isCompileInputPath } from "@/lib/agent/ficheros/folder";
import { catalogTypePathsOf } from "@/lib/apps/checker/types-pack";
import { compilarCarpeta } from "@/lib/apps/compilador";
import type { AppDeProyecto } from "@/lib/projects/types";
import { fetchPackageAsset } from "./assets";
import { esmUrl, externalsFor } from "./esm-url";
import { fetchGraph, type GraphError } from "./fetch-graph";
import { checkResolved, chooseVersion, type GateDecision, type GateDeps } from "./gate";
import {
  catalogPartsLocked,
  catalogRange,
  catalogServes,
  catalogShips,
  catalogVersionOf,
  EMPTY_LOCK,
  FIXED_TO_CATALOG,
  readEsmLock,
  readPackageJson,
  satisfiesSafe,
  serializeEsmLock,
  serializePackageJson,
  servesSubpath,
  sourceOf,
  type LockedModules,
  type LockedPackage,
  type PackageJson,
} from "./lock";
import { nodeOnlyBuiltinsIn, packageVersionsIn } from "./module-scan";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { mapLimited } from "./pool";
import { getPackument } from "./registry";
import { isAssetSubpath, parseBareSpecifier, specifierOf } from "./specifier";
import { sha256Hex, type ModuleStore } from "./store";
import { fetchTypes } from "./types";

export const MAX_ESM_PACKAGES = 50;
export const MAX_MODULE_BYTES = 40 * 1024 * 1024;
export const INSTALL_DEADLINE_MS = 60_000;
/** A refusal (the gate's or esm.sh's, never a service that failed or didn't
 *  answer) is remembered while /package.json stays the same — like v0, which
 *  installs again when package.json changes, not on every save — and at most
 *  this long (a version too new today may be old enough later). `npm install
 *  <name>` always asks. */
export const REFUSAL_TTL_MS = 60 * 60_000;
const MAX_REFUSALS = 500;
const refusals = new Map<string, { readonly message: string; readonly until: number }>();

export function clearRefusalCache(): void {
  refusals.clear();
}

const refusalKey = (catalog: string, add: InstallAdd, packageJson: string) =>
  [catalog, add.name, add.range ?? "", [...add.subpaths].sort().join(","), sha256Hex(packageJson)].join("\0");

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
    if (!bare) continue;
    const source = sourceOf(bare.name, files, app.catalogo);
    // A part of a catalog package the catalog doesn't ship (react-dom/server): from esm.sh, at its version.
    if (source.kind === "catalog" && !catalogShips(app.catalogo, spec)) {
      const parts = catalogPartsLocked(bare.name, files, app.catalogo);
      if (!parts || !servesSubpath(parts, bare.subpath)) want(bare.name, null, bare.subpath);
      continue;
    }
    if (isFixed(bare.name)) continue;
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
      return `${name}: ${e.message}; nothing was installed. It's the package service, not the package: try again.`;
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
      await mapLimited(g.graph.modules, (m) => ctx.deps.store.put(m.sha, m.code));
      for (const m of g.graph.modules) parts.bytes += m.code.length;
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

/** The .d.ts of `subpaths` ("" = the package), cached; `skip`: paths the catalog's types already have. */
async function typesFor(name: string, version: string, ctx: Ctx, subpaths: readonly string[] = [""], skip: ReadonlySet<string> = new Set()): Promise<Pick<LockedPackage, "types" | "typesFrom"> | null> {
  const got = await fetchTypes(name, version, { fetch: ctx.deps.fetch, gate: ctx.deps, deadline: ctx.deadline, origin: ctx.deps.origin }, subpaths).catch(() => null);
  if (!got) return null;
  const files = Object.entries(got.files).filter(([p]) => !skip.has(p));
  const shas = Object.fromEntries(files.map(([p, text]) => [p, sha256Hex(text)]));
  await mapLimited(files, ([p, text]) => ctx.deps.store.put(shas[p]!, text));
  return { types: shas, typesFrom: { name: got.name, version: got.version } };
}

type OneOutcome = { notes: NpmNote[]; installed: string | null; discovered: InstallAdd[]; refused?: string };

const nothing = (note?: NpmNote): OneOutcome => ({ notes: note ? [note] : [], installed: null, discovered: [] });
// A refusal worth remembering: the answer, not a service that didn't give one.
const refused = (message: string, code: string): OneOutcome => ({ ...nothing(error(message)), ...(code === "unavailable" ? {} : { refused: message }) });

/**
 * The parts of a catalog package the catalog doesn't ship (`react-dom/server`,
 * `zod/v4`, a stylesheet), as v0 has them — the whole package is in its
 * node_modules. From esm.sh at the catalog's exact version, with the package
 * itself, React and whatever else the catalog serves external: what they import
 * by name is the catalog's copy (one copy). Their types skip what the catalog's
 * types already have.
 */
async function installCatalogParts(add: InstallAdd, version: string | null, ctx: Ctx): Promise<OneOutcome> {
  const { app, packages, deps } = ctx;
  const before = packages[add.name];
  const existing = before?.catalogParts && before.version === version ? before : undefined;
  const missing = add.subpaths.filter((s) => !catalogShips(app.catalogo, specifierOf(add.name, s)) && !(existing && servesSubpath(existing, s)));
  if (missing.length === 0) return nothing();
  const specs = missing.map((s) => specifierOf(add.name, s)).join(", ");
  if (version === null) return nothing(error(`${specs}: this app's ${add.name} has no known version, so its other parts can't be installed.`));
  const decision = await chooseVersion(add.name, version, deps);
  if (!decision.ok) return refused(decision.message, decision.code);
  const manifest = decision.packument.versions[version] ?? { version };
  const declared = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})];
  const others = new Set(Object.keys(packages).filter((n) => n !== add.name && !packages[n]!.catalogParts));
  const externals = existing?.externals ?? [...new Set([add.name, ...externalsFor(manifest, others), ...declared.filter((d) => catalogServes(app.catalogo, d))])].sort();
  const parts = await lockParts(add.name, version, missing, externals, ctx);
  if (!parts.ok) return refused(parts.message, parts.code);
  const code = missing.filter((s) => !isAssetSubpath(s));
  const types = code.length > 0 ? await typesFor(add.name, version, ctx, code, catalogTypePathsOf(app.catalogo)) : null;
  const allTypes = { ...(existing?.types ?? {}), ...(types?.types ?? {}) };
  const typesFrom = types?.typesFrom ?? existing?.typesFrom;
  packages[add.name] = {
    version,
    publishedAt: decision.publishedAt,
    externals,
    catalogParts: true,
    development: { ...existing?.development, ...parts.parts.development },
    production: { ...existing?.production, ...parts.parts.production },
    assets: { ...existing?.assets, ...parts.parts.assets },
    types: Object.keys(allTypes).length > 0 ? allTypes : null,
    ...(typesFrom ? { typesFrom } : {}),
    warnings: [...(existing?.warnings ?? []), ...parts.parts.warnings],
    bytes: (existing?.bytes ?? 0) + parts.parts.bytes,
  };
  return {
    notes: [{ severity: "Info", message: `Installed ${specs} from npm (esm.sh), from the same ${add.name}@${version} this app already has.` }, ...parts.parts.warnings.map(warning)],
    installed: `${add.name}@${version} (${specs})`,
    discovered: parts.discovered,
  };
}

async function installOne(add: InstallAdd, ctx: Ctx): Promise<OneOutcome> {
  const { app, dependencies, packages, deps } = ctx;

  if (isFixed(add.name)) {
    const v = catalogVersionOf(app.catalogo, add.name)!;
    if (add.range && !satisfiesSafe(v, add.range)) return nothing(error(`${add.name} is fixed to ${v} in this app (one copy); other versions can't be installed.`));
    dependencies[add.name] = catalogRange(app.catalogo, add.name);
    return installCatalogParts(add, v, ctx);
  }

  const catalogVersion = catalogVersionOf(app.catalogo, add.name);
  if (catalogServes(app.catalogo, add.name) && (add.range === null || catalogVersion === null || satisfiesSafe(catalogVersion, add.range))) {
    dependencies[add.name] = add.range ?? dependencies[add.name] ?? catalogRange(app.catalogo, add.name);
    return installCatalogParts(add, catalogVersion, ctx);
  }

  const range = add.range ?? dependencies[add.name] ?? null;
  // Parts of the catalog's copy are not this package from esm.sh: another version replaces them.
  const existing = packages[add.name]?.catalogParts ? undefined : packages[add.name];
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

  if (!existing && Object.values(packages).filter((p) => !p.catalogParts).length >= MAX_ESM_PACKAGES) {
    return nothing(error(`this app already has ${MAX_ESM_PACKAGES} packages outside its catalog; ${add.name} was not installed.`));
  }
  const decision = await chooseVersion(add.name, add.range, deps);
  if (!decision.ok) return refused(decision.message, decision.code);
  const manifest = decision.packument.versions[decision.version] ?? { version: decision.version };
  const externals = externalsFor(manifest, new Set(Object.keys(packages).filter((n) => n !== add.name && !packages[n]!.catalogParts)));
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
    // Parts of a catalog package keep the package itself external: nothing to redo.
    if (locked.catalogParts) continue;
    const manifest = (await getPackument(name, ctx.deps.fetch).catch(() => null))?.versions[locked.version];
    if (!manifest) continue;
    const externals = externalsFor(manifest, new Set(Object.keys(ctx.packages).filter((n) => n !== name && !ctx.packages[n]!.catalogParts)));
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
      const key = refusalKey(app.catalogo, add, files[PACKAGE_JSON_PATH] ?? "");
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
