// What an esm.sh package exports by name (spec 2026-10-13): what a vi.mock of
// it must export. esm.sh entries re-export their build (`export * from
// "/x@1/es2022/x.mjs"`), so `export *` is followed through the lock's modules,
// as ES modules do: it brings every name but `default`.
import { parse } from "es-module-lexer/js";

export interface EsmExports {
  readonly names: readonly string[];
  readonly hasDefault: boolean;
}

/** `null` when a name can't be known: a module missing from `modules`, one that
 *  doesn't parse, or an `export *` of a package outside `entries` (the catalog's). */
export function esmExportsOf(
  entryUrl: string,
  modules: Readonly<Record<string, string>>,
  entries: Readonly<Record<string, string>> = {},
): EsmExports | null {
  const visited = new Set<string>();
  const namesOf = (url: string): Set<string> | null => {
    if (visited.has(url)) return new Set();
    visited.add(url);
    const code = modules[url];
    if (code === undefined) return null;
    let exports: ReturnType<typeof parse>[1];
    try {
      [, exports] = parse(code);
    } catch {
      return null;
    }
    const names = new Set<string>();
    for (const e of exports) {
      if ("name" in e) {
        names.add(e.name);
        continue;
      }
      const target = /^(?:\/|\.\.?\/|https?:\/\/)/.test(e.from) ? new URL(e.from, url).href : entries[e.from];
      if (target === undefined) return null;
      const star = namesOf(target);
      if (star === null) return null;
      for (const n of star) if (n !== "default") names.add(n);
    }
    return names;
  };
  const all = namesOf(entryUrl);
  if (all === null) return null;
  return { names: [...all].filter((n) => n !== "default").sort(), hasDefault: all.has("default") };
}
