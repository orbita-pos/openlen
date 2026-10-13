// WHICH PACKAGES LEN COULD NOT INSTALL, and why: since open npm (spec
// 2026-10-13) any npm package installs, so what this counts is what the gate
// or esm.sh refused — the list that says whether the gate is too strict.
//
// There is no separate log: every refusal is already in the turn's transcript
// (`projectChatMessages.transcript`), with the exact text the model read — in
// a <new-diagnostics> line (installing on save) or after `npm error` (the
// terminal). The messages, and this is their only reader:
//
//   not-installed  the compiler, a package nothing serves yet:
//                  «"three" is not installed in this app. …» (before open npm:
//                  «… is not available in this app.» and the terminal's
//                  «three: isn't available here — there is no npm; …»)
//   too-new        the gate (lib/apps/npm/gate.ts): «three@^0.181.0: every matching version is newer than 7 days …»
//   too-young      the gate: «young: published 10 days ago; packages must be at least 30 days old.»
//   malware        the gate: «x@1.2.3 is flagged as malware (MAL-…) …»
//   build-failed   the installer (lib/apps/npm/install.ts): «x@1.2.3: esm.sh could not build it: …»
//   page-import    the compiler, a package imported in a PAGE (not an app):
//                  «"chart.js" is a package name, and packages can only be imported in an app.»
//   catalog-part   the compiler, a part of a catalog package the catalog doesn't ship:
//                  «"react-dom/server" is not part of this app's react-dom: …»
//
// If one of those texts changes, `missing-packages.test.ts` says so.

export type MissingSource = "not-installed" | "too-new" | "too-young" | "malware" | "build-failed" | "page-import" | "catalog-part";

export interface MissingHit {
  readonly pkg: string;
  readonly source: MissingSource;
}

export interface MissingPackageRow {
  readonly pkg: string;
  /** Distinct projects that asked for it. */
  readonly projects: number;
  /** Turns it showed up in (from any source). */
  readonly turns: number;
  readonly sources: readonly MissingSource[];
  /** Date (YYYY-MM-DD, UTC) of the last turn that asked for it. */
  readonly lastSeen: string;
  /** Already in the catalog new apps are born with: an app on an older catalog asked for it. */
  readonly inCurrentCatalog: boolean;
}

// The gate's messages start a line after `npm error ` or after a diagnostic's
// `[Line 1:1] `: what comes before the name is the start of a line or a space.
const PATTERNS: readonly (readonly [MissingSource, RegExp])[] = [
  ["not-installed", /"([^"]+)" is not installed in this app\./g],
  // Before open npm, still in stored turns.
  ["not-installed", /"([^"]+)" is not available in this app\./g],
  ["not-installed", /^(\S+): isn't available here — there is no npm;/gm],
  ["too-new", /(?:^|\s)((?:@[^/\s]+\/)?[^@\s]+)@\S+: every matching version is newer than/gm],
  ["too-young", /(?:^|\s)((?:@[^/\s]+\/)?[^:\s]+): published \d+ days ago; packages must be at least/gm],
  ["malware", /((?:@[^/\s]+\/)?[^@\s]+)@\S+ is flagged as malware/g],
  ["build-failed", /((?:@[^/\s]+\/)?[^@\s]+)@\S+: esm\.sh could not build it/g],
  ["page-import", /"([^"]+)" is a package name, and packages can only be imported in an app\./g],
  ["catalog-part", /"([^"]+)" is not part of this app's /g],
];

// The CDNs that serve npm by name: what follows the prefix is `package[@version][/path]`.
const CDN_PREFIXES: readonly RegExp[] = [
  /^https?:\/\/esm\.sh\/(?:v\d+\/|stable\/)?(.+)$/i,
  /^https?:\/\/cdn\.jsdelivr\.net\/npm\/(.+)$/i,
  /^https?:\/\/unpkg\.com\/(.+)$/i,
  /^https?:\/\/cdn\.skypack\.dev\/(.+)$/i,
  /^https?:\/\/ga\.jspm\.io\/npm:(.+)$/i,
];

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/** The package of a specifier (`three/examples/x.js` → `three`) or of a CDN URL; `null` if there is none. */
export function packageNameOf(specifier: string): string | null {
  let s = specifier.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const cdn = CDN_PREFIXES.map((re) => re.exec(s)).find(Boolean);
    if (!cdn) return null;
    s = cdn[1]!.split(/[?#]/)[0]!;
  }
  const parts = s.split("/");
  const segments = parts.slice(0, s.startsWith("@") ? 2 : 1);
  const last = segments.length - 1;
  segments[last] = segments[last]!.replace(/@.*$/, "");
  const name = segments.join("/");
  return NPM_NAME.test(name) ? name : null;
}

// A tool response without its own text is stored as `JSON.stringify(response)`
// (`contenidoDeRespuesta`, lib/agent/fireworks-bridge.ts): inside it, the
// message doesn't start a line and its quotes are escaped. It is parsed and
// walked like everything else.
function* stringsIn(value: unknown): Generator<string> {
  if (typeof value === "string") {
    const t = value.trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        yield value;
        return;
      }
      yield* stringsIn(parsed);
      return;
    }
    yield value;
  } else if (Array.isArray(value)) {
    for (const v of value) yield* stringsIn(v);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) yield* stringsIn(v);
  }
}

/** The packages missing in ONE turn: each once per source, in the order they came up. */
export function missingPackagesOfTurn(transcript: unknown): MissingHit[] {
  const seen = new Set<string>();
  const out: MissingHit[] = [];
  for (const text of stringsIn(transcript)) {
    for (const [source, pattern] of PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        const pkg = packageNameOf(m[1]!);
        if (!pkg || seen.has(`${source}\0${pkg}`)) continue;
        seen.add(`${source}\0${pkg}`);
        out.push({ pkg, source });
      }
    }
  }
  return out;
}

export interface TurnForTally {
  readonly projectId: string;
  readonly createdAt: Date;
  readonly transcript: unknown;
}

/** The table by package: most projects first, then most turns. */
export function tallyMissingPackages(
  turns: readonly TurnForTally[],
  currentCatalog: readonly string[],
): MissingPackageRow[] {
  const inCatalog = new Set(currentCatalog.map((e) => packageNameOf(e) ?? e));
  const byPackage = new Map<string, { projects: Set<string>; turns: number; sources: Set<MissingSource>; last: Date }>();
  for (const t of turns) {
    const hits = missingPackagesOfTurn(t.transcript);
    for (const pkg of new Set(hits.map((h) => h.pkg))) {
      const row = byPackage.get(pkg) ?? { projects: new Set(), turns: 0, sources: new Set(), last: t.createdAt };
      row.projects.add(t.projectId);
      row.turns += 1;
      for (const h of hits) if (h.pkg === pkg) row.sources.add(h.source);
      if (t.createdAt > row.last) row.last = t.createdAt;
      byPackage.set(pkg, row);
    }
  }
  return [...byPackage.entries()]
    .map(([pkg, r]) => ({
      pkg,
      projects: r.projects.size,
      turns: r.turns,
      sources: [...r.sources].sort(),
      lastSeen: r.last.toISOString().slice(0, 10),
      inCurrentCatalog: inCatalog.has(pkg),
    }))
    .sort((a, b) => b.projects - a.projects || b.turns - a.turns || a.pkg.localeCompare(b.pkg));
}
