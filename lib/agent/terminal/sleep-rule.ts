/**
 * A long `sleep` is refused before it runs, as Claude Code's Bash does (its validateInput, binary 2.1.304): when a
 * command OPENS with `sleep N` and N is 25 s or more, nothing runs and the answer says how to wait instead — for
 * a condition, not for a time. Claude Code only does this when it has something better to offer; here a sleep can
 * never be the better thing, because nothing runs in the background of this terminal: the only work that goes on
 * while Len waits is an export job, and `inspect_artifact` waits for that one (`wait_ms`).
 *
 * Only the first part of the line counts, as there: `echo x; sleep 60` runs. Pure; the splitting is the exit-code
 * rule's (`trozos`), which keeps quotes, `$(…)` and comments whole.
 */
import { trozos } from "./codigo-de-salida";

export const LONG_SLEEP_SECONDS = 25;

/** "standalone sleep N" or "sleep N followed by: …" when the command opens with a long sleep; otherwise null. */
export function longSleep(command: string): string | null {
  const parts = trozos(command)?.map((t) => t.texto.trim()).filter((t) => t !== "");
  if (!parts || parts.length === 0) return null;
  const match = /^sleep\s+(\d+(?:\.\d*)?)$/.exec(parts[0]!);
  if (!match) return null;
  const seconds = parseFloat(match[1]!);
  if (seconds < LONG_SLEEP_SECONDS) return null;
  const rest = parts.slice(1).join(" ");
  return rest ? `sleep ${seconds} followed by: ${rest}` : `standalone sleep ${seconds}`;
}

export function longSleepRefusal(what: string, rendersAvailable: boolean): string {
  return [
    `Not run: ${what}.`,
    "Nothing runs in the background of this terminal, so sleeping here only spends the turn.",
    rendersAvailable
      ? "To wait for an export you queued with render_artifact, call inspect_artifact with wait_ms: it checks every 2 s and answers as soon as the job ends."
      : "",
    "Do not split the wait into shorter sleeps to get past this.",
  ].filter(Boolean).join(" ");
}
