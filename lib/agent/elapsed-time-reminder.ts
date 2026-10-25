// A3 OF LEN 3.1 · Claude Code's `elapsed_time_reminder` (binary 2.1.304): after every round of tools
// the model reads how long the turn has been running. Same text and formula as theirs (`oOr`: whole
// seconds, minutes unbounded, seconds padded to two), inside a <system-reminder> like their attachment.
// It goes at the end of the step, never in the system prompt: the cached prefix does not change.
// Anthropic measured it (plans/len-3-1-pruebas/lectura.md): told the time, runs finish sooner and
// cost less, for the price of a short note.

export function elapsedTimeReminder(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  return `<system-reminder>\nElapsed time so far: ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s\n</system-reminder>`;
}
