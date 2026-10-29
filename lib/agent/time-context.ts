// LEN READS THE TIME (spec local 2026-10-29-tareas-programadas, §7.3). DeepSeek ships its schedule
// tools together with its time context (`deepseek-harness` @ 00d5414, MIT,
// LICENSES/deepseek-harness.MIT.txt: `packages/context/time-context/src/{index,timestamp,request-zone}.ts`):
// a model that only knows the day cannot place «at 9» or «in an hour». Same three lines as their
// first step, same timestamp and duration format. It goes in the turn's context, never the system
// prompt, so the cached prefix does not move.
import { Duration } from "@/lib/scheduled-tasks/deepseek/time";

/** Their `formatDuration`: compact whole-second units, a backward clock clamped to zero. */
function formatDuration(elapsedMs: number): string {
  const { days, hours, minutes, seconds } = Duration.fromMilliseconds(Math.max(0, elapsedMs)).decompose();
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

/** Their `createTimestampFormatter` + `formatTimestamp`: ISO-shaped, numeric offset, zone in brackets. */
function formatTimestamp(now: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const offset = (parts.timeZoneName ?? "GMT").replace(/^GMT$/, "GMT+00:00").slice(3);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}[${timeZone}]`;
}

/** Their `renderBrowserTimeZoneContext`, for a known zone or none. */
function browserZoneLine(zone: string | null): string {
  return zone
    ? `Browser time zone for this request: ${zone}. Interpret otherwise-unqualified dates and times in this zone.`
    : "Browser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.";
}

/** Milliseconds since the last turn ended (its start plus its duration), or null without one. */
export function sinceLastTurn(last: { readonly createdAt: Date; readonly durationMs: number | null } | null, now: Date): number | null {
  if (!last) return null;
  return now.getTime() - (last.createdAt.getTime() + (last.durationMs ?? 0));
}

/** The first-step reading. Without a zone it is shown in UTC, which is this server's fallback. */
export function timeContext(o: { readonly turn: number; readonly now: Date; readonly zone: string | null; readonly sinceLast: number | null }): string {
  const elapsed = o.sinceLast === null ? "unavailable" : formatDuration(o.sinceLast);
  return (
    `Time sampled while preparing turn ${o.turn}, step 1: ${formatTimestamp(o.now.getTime(), o.zone ?? "UTC")}\n` +
    `${browserZoneLine(o.zone)}\n` +
    `Elapsed since the preceding model-visible message: ${elapsed}.`
  );
}
