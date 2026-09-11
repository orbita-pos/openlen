import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function internalRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/gi))
    for (const part of m[1].split(",")) refs.push(part.trim().split(/\s+/)[0]);
  return [
    ...new Set(
      refs
        .filter((r) => r.startsWith("/"))
        .map((r) => r.split("#")[0].split("?")[0])
        .filter(Boolean),
    ),
  ];
}

export function resolves(outDir, ref) {
  const p = join(outDir, decodeURIComponent(ref));
  if (existsSync(p) && statSync(p).isFile()) return true;
  return existsSync(join(p, "index.html"));
}
