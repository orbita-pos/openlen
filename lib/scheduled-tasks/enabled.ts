// The kill switch (spec local 2026-10-29-tareas-programadas, §9): OPENLEN_SCHEDULE=0 turns scheduled
// tasks off — no tools, no /schedule skill, no scheduler, no writes. Only the literal "0" counts.
export function scheduleEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_SCHEDULE !== "0";
}
