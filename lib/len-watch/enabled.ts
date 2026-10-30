// The kill switch (spec local 2026-10-30-len-watch, §6): OPENLEN_WATCH=0 turns Len Watch off —
// no snippet at publish, `/c` ignores the reports, no checks, no turns. Only the literal "0" counts.
export function lenWatchEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_WATCH !== "0";
}
