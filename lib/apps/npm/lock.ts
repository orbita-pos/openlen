// /package.json and the esm lock (/.openlen/esm-lock.json), and the one rule
// that decides who serves a package: `sourceOf`. The compiler, the bundler,
// the type checker, the tests and the installer all ask it.
//
// THE LOCK IS A DERIVED CACHE: an entry counts only while its version
// satisfies package.json's range. Undoing a turn restores package.json but may
// leave the lock as it was; an orphan entry then serves nothing.
import semver from "semver";
import { catalogAliasesOf, catalogo } from "@/lib/apps/dependencias";
import versions from "./catalog-versions.json";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "./paths";
import { parseBareSpecifier } from "./specifier";

export interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface LockedModules {
  /** The URL the app's import resolves to. */
  readonly entry: string;
  /** Every module of the graph: URL → sha256 (hex) of its code. */
  readonly modules: Readonly<Record<string, string>>;
}

export interface LockedPackage {
  readonly version: string;
  readonly publishedAt: string;
  /** What went in esm.sh's `external` (sorted). */
  readonly externals: readonly string[];
  /** Subpath ("" = the package itself) → its graph, per mode. */
  readonly development: Readonly<Record<string, LockedModules>>;
  readonly production: Readonly<Record<string, LockedModules>>;
  /** Asset subpath (CSS, image, font) → sha256 of the processed text (CSS with data: URLs, or a data: URL). */
  readonly assets: Readonly<Record<string, string>>;
  /** "/node_modules/<name>/…d.ts" → sha256, or null when the package has no types. */
  readonly types: Readonly<Record<string, string>> | null;
  readonly warnings: readonly string[];
  /** Bytes of the code modules (both modes), for the per-app cap. */
  readonly bytes: number;
}

export interface EsmLock {
  readonly lockfileVersion: 1;
  readonly packages: Readonly<Record<string, LockedPackage>>;
}

export const EMPTY_LOCK: EsmLock = { lockfileVersion: 1, packages: {} };
export const FIXED_TO_CATALOG = ["react", "react-dom"] as const;

type Files = Readonly<Record<string, string>>;

export function readPackageJson(files: Files): PackageJson | null {
  const text = files[PACKAGE_JSON_PATH];
  if (text === undefined) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PackageJson) : null;
  } catch {
    return null;
  }
}

export function readEsmLock(files: Files): EsmLock {
  const text = files[ESM_LOCK_PATH];
  if (text === undefined) return EMPTY_LOCK;
  try {
    const parsed = JSON.parse(text) as EsmLock;
    return parsed?.lockfileVersion === 1 && parsed.packages && typeof parsed.packages === "object" ? parsed : EMPTY_LOCK;
  } catch {
    return EMPTY_LOCK;
  }
}

export function serializePackageJson(pkg: PackageJson): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function serializeEsmLock(lock: EsmLock): string {
  const packages = Object.fromEntries(Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ lockfileVersion: 1, packages }, null, 2)}\n`;
}

const TABLE = versions as Readonly<Record<string, Readonly<Record<string, string>>>>;

export function catalogVersionOf(catalogName: string, packageName: string): string | null {
  const table = TABLE[catalogName] ?? catalogo(catalogName)?.versiones;
  if (!table) return null;
  if (Object.hasOwn(table, packageName)) return table[packageName]!;
  const alias = catalogAliasesOf(catalogName)[packageName];
  const target = alias ? parseBareSpecifier(alias)?.name : null;
  return target && Object.hasOwn(table, target) ? table[target]! : null;
}

export function catalogServes(catalogName: string, packageName: string): boolean {
  return (catalogo(catalogName)?.dependencias ?? []).some((d) => parseBareSpecifier(d.especificador)?.name === packageName);
}

/** The range package.json gets for a catalog package: "^<its version>", or "*" if unknown. */
export function catalogRange(catalogName: string, packageName: string): string {
  const v = catalogVersionOf(catalogName, packageName);
  return v ? `^${v}` : "*";
}

export function satisfiesSafe(version: string, range: string): boolean {
  try {
    return semver.validRange(range) !== null && semver.satisfies(version, range);
  } catch {
    return false;
  }
}

export type PackageSource =
  | { readonly kind: "catalog" }
  | { readonly kind: "esm"; readonly locked: LockedPackage }
  | { readonly kind: "missing"; readonly range: string | null };

export function sourceOf(name: string, files: Files, catalogName: string): PackageSource {
  if ((FIXED_TO_CATALOG as readonly string[]).includes(name)) return { kind: "catalog" };
  const range = readPackageJson(files)?.dependencies?.[name] ?? null;
  if (catalogServes(catalogName, name)) {
    const v = catalogVersionOf(catalogName, name);
    if (range === null || v === null || satisfiesSafe(v, range)) return { kind: "catalog" };
  }
  if (range !== null) {
    const locked = readEsmLock(files).packages[name];
    if (locked && satisfiesSafe(locked.version, range)) return { kind: "esm", locked };
  }
  return { kind: "missing", range };
}
