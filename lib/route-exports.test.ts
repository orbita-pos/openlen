// @vitest-environment node
// WHAT A ROUTE FILE MAY EXPORT. `next build` type-checks every app/**/route.ts against the route segment config: a route
// file exports its HTTP handlers and Next's settings, nothing else. Any other export (a size cap shared with a test, a
// helper) fails the BUILD with «Property 'X' is incompatible with index signature» — and only the build: `tsc --noEmit`
// never sees Next's generated `.next/types`. On 23/11 the deploy stopped at step 1 on two such constants of the artifacts'
// routes, which no gate before it had caught. A shared value lives in a module of its own and the route imports it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Next 15's route segment exports (the handlers plus the route segment config). */
const ALLOWED = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "config",
  "generateStaticParams",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration",
  "experimental_ppr",
]);

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (/^route\.(ts|tsx|js)$/.test(name)) found.push(path);
  }
  return found;
}

/** The names a route file exports as values (`export type` and `export interface` are erased and don't count). */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/^export\s+(?:const|let|var|async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.push(m[1]!);
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (name && !name.startsWith("type ")) names.push(name);
    }
  }
  return names;
}

describe("route files export only what Next accepts", () => {
  it("no app/**/route.ts exports a name outside Next's route segment exports", () => {
    const files = routeFiles("app");
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) =>
      exportedNames(readFileSync(file, "utf8"))
        .filter((name) => !ALLOWED.has(name))
        .map((name) => `${file.replace(/\\/g, "/")}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reads the forms a route file uses to export", () => {
    expect(
      exportedNames(
        [
          "export const GET = handler;",
          "export async function POST() {}",
          "export const CAP = 1;",
          "export { helper as OPTIONS, other };",
          "export type Shape = {};",
        ].join("\n"),
      ),
    ).toEqual(["GET", "POST", "CAP", "OPTIONS", "other"]);
  });
});
