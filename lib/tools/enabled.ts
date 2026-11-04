// TOOLS MADE BY LEN (spec local 2026-11-04-herramientas-hechas-por-len, §4.15): on by default, like the rest of
// OpenLen's features; only the literal "0" turns them off everywhere — routes, rail, views, the start card and
// Len's tool posture.
export function toolsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_TOOLS !== "0";
}
