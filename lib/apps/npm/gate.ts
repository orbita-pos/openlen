// THE GATE (spec 2026-10-13, "aduana equilibrada"): a version published at
// least 7 days ago, a package at least 30 days old, and nothing OSV flags as
// malware (ids or aliases MAL-*). The 2025 npm attack on chalk/debug lived for
// about two hours: the 7-day wait is the main barrier; OSV is the second.
import semver from "semver";
import { osvApi } from "./paths";
import { getPackument, type FetchLike, type Packument } from "./registry";

export const MIN_VERSION_AGE_DAYS = 7;
export const MIN_PACKAGE_AGE_DAYS = 30;
const DAY_MS = 86_400_000;
const OSV_TIMEOUT_MS = 5_000;

export interface GateDeps {
  readonly fetch: FetchLike;
  readonly now: () => Date;
}

export type GateCode = "too-new" | "package-too-young" | "malware" | "not-found" | "unavailable" | "no-match";

export type GateDecision =
  | { readonly ok: true; readonly version: string; readonly publishedAt: string; readonly malwareCheck: "clean" | "unavailable"; readonly packument: Packument }
  | { readonly ok: false; readonly code: GateCode; readonly message: string };

const ageDays = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / DAY_MS;

const unavailable = (name: string): GateDecision => ({
  ok: false,
  code: "unavailable",
  message: `${name}: the package service did not answer; nothing was installed. Try again.`,
});

/** OSV's malware ids for one version; null when OSV didn't answer. */
async function malwareIds(name: string, version: string, deps: GateDeps): Promise<string[] | null> {
  try {
    const res = await deps.fetch(`${osvApi()}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem: "npm" }, version }),
      signal: AbortSignal.timeout(OSV_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { vulns?: { id: string; aliases?: string[] }[] };
    return (body.vulns ?? []).flatMap((v) => [v.id, ...(v.aliases ?? [])]).filter((id) => id.startsWith("MAL-"));
  } catch {
    return null;
  }
}

async function load(name: string, deps: GateDeps): Promise<Packument | null | "unavailable"> {
  try {
    return await getPackument(name, deps.fetch);
  } catch {
    return "unavailable";
  }
}

function tooYoung(name: string, doc: Packument, now: Date): GateDecision | null {
  const created = doc.time.created;
  if (!created || ageDays(created, now) >= MIN_PACKAGE_AGE_DAYS) return null;
  return {
    ok: false,
    code: "package-too-young",
    message: `${name}: published ${Math.floor(ageDays(created, now))} days ago; packages must be at least ${MIN_PACKAGE_AGE_DAYS} days old.`,
  };
}

async function finish(name: string, version: string, doc: Packument, deps: GateDeps): Promise<GateDecision> {
  const ids = await malwareIds(name, version, deps);
  if (ids && ids.length > 0) return { ok: false, code: "malware", message: `${name}@${version} is flagged as malware (${ids[0]}) and was not installed.` };
  return { ok: true, version, publishedAt: doc.time[version]!, malwareCheck: ids === null ? "unavailable" : "clean", packument: doc };
}

/** The newest version of `name` that satisfies `range` and passes the gate. `range` null or "latest" = what `npm install name` takes. */
export async function chooseVersion(name: string, range: string | null, deps: GateDeps): Promise<GateDecision> {
  const doc = await load(name, deps);
  if (doc === "unavailable") return unavailable(name);
  if (!doc) return { ok: false, code: "not-found", message: `${name}: not found in the npm registry.` };
  const now = deps.now();
  const young = tooYoung(name, doc, now);
  if (young) return young;
  const tag = range && range !== "latest" ? doc["dist-tags"][range] : undefined;
  const effective = range === "latest" ? null : (tag ?? range);
  const latest = doc["dist-tags"].latest;
  const all = Object.keys(doc.versions).filter((v) => semver.valid(v));
  const matching = all.filter((v) =>
    effective === null ? !semver.prerelease(v) && (!latest || semver.lte(v, latest)) : semver.satisfies(v, effective, { includePrerelease: Boolean(tag) }),
  );
  if (matching.length === 0) return { ok: false, code: "no-match", message: `${name}@${range}: no published version matches.` };
  const oldEnough = (v: string) => Boolean(doc.time[v]) && ageDays(doc.time[v]!, now) >= MIN_VERSION_AGE_DAYS;
  const allowed = matching.filter(oldEnough);
  if (allowed.length === 0) {
    const newestAllowed = all.filter((v) => oldEnough(v) && !semver.prerelease(v)).sort(semver.rcompare)[0];
    return {
      ok: false,
      code: "too-new",
      message: `${name}@${range ?? "latest"}: every matching version is newer than ${MIN_VERSION_AGE_DAYS} days${newestAllowed ? ` (newest allowed: ${newestAllowed})` : ""}.`,
    };
  }
  return finish(name, allowed.sort(semver.rcompare)[0]!, doc, deps);
}

/** A version esm.sh resolved inside a package's graph: the same gate, for that exact version. */
export async function checkResolved(name: string, version: string, deps: GateDeps): Promise<GateDecision> {
  const doc = await load(name, deps);
  if (doc === "unavailable") return unavailable(name);
  if (!doc || !doc.time[version]) return { ok: false, code: "not-found", message: `${name}@${version}: not found in the npm registry.` };
  const now = deps.now();
  const young = tooYoung(name, doc, now);
  if (young) return young;
  if (ageDays(doc.time[version]!, now) < MIN_VERSION_AGE_DAYS) {
    // Half a sentence on purpose: the installer says "<pkg> depends on <this>; not installed."
    return { ok: false, code: "too-new", message: `${name}@${version}, published ${Math.floor(ageDays(doc.time[version]!, now))} days ago` };
  }
  return finish(name, version, doc, deps);
}
