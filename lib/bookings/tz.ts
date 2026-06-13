// Timezone math for bookings — ALL wall-clock ↔ instant conversion lives here
// and NOWHERE else. This is the single highest-risk file in the module: a
// two-pass-refinement bug silently shifts every slot by an hour twice a year.
//
// Approach (decided in design): raw Intl.DateTimeFormat, no library. Node ships
// full ICU, so the zone offset at any instant is exact (DST-aware). We store
// UTC; the creator authors wall-clock rules in their IANA zone; the visitor
// sees their own zone. Pure functions — no Date.now(), nothing injected here.

// NOTE: do NOT validate against Intl.supportedValuesOf('timeZone') — that list
// contains only CANONICAL zone ids, so valid IANA aliases a real browser sends
// (e.g. "Asia/Kolkata", "Etc/UTC") would be wrongly rejected. The formatter
// probe accepts every valid zone (canonical or alias) and throws only on
// genuinely invalid input. Cache the verdict per string.
const _knownCache = new Map<string, boolean>();
export function isKnownTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  const cached = _knownCache.get(tz);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  _knownCache.set(tz, ok);
  return ok;
}

const _fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

function partsAt(utcMs: number, tz: string): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
} {
  const parts = fmt(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => {
    const p = parts.find((x) => x.type === t);
    return p ? parseInt(p.value, 10) : 0;
  };
  let h = get("hour");
  if (h === 24) h = 0; // some ICU builds render midnight as 24
  return { y: get("year"), mo: get("month"), d: get("day"), h, mi: get("minute"), s: get("second") };
}

/** The zone's UTC offset (ms) at a given instant. Positive = ahead of UTC.
 *  Technique: read the wall-clock parts in `tz`, reinterpret them AS IF UTC,
 *  and the difference from the real instant is the offset. DST-aware. */
export function getZoneOffsetMs(utcMs: number, ianaTz: string): number {
  const p = partsAt(utcMs, ianaTz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUtc - utcMs;
}

/** Civil wall-clock fields in `ianaTz` at a UTC instant. weekday is 0=Sun..6
 *  in the TARGET zone (derived from the civil date, not getUTCDay of utcMs). */
export function utcToWallParts(
  utcMs: number,
  ianaTz: string,
): { y: number; mo: number; d: number; h: number; mi: number; weekday: number } {
  const p = partsAt(utcMs, ianaTz);
  const weekday = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return { y: p.y, mo: p.mo, d: p.d, h: p.h, mi: p.mi, weekday };
}

/** Resolve a wall-clock time in `ianaTz` to a UTC instant. Two-pass: a first
 *  offset guess, then a refine pass that catches DST boundaries.
 *   - existed=false  → the wall time falls in a spring-forward GAP (never
 *                       happened); callers DROP these slots.
 *   - ambiguous=true → the wall time falls in a fall-back OVERLAP (happened
 *                       twice); v1 returns the FIRST occurrence. */
export function wallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  ianaTz: string,
): { utcMs: number; existed: boolean; ambiguous: boolean } {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = getZoneOffsetMs(guess, ianaTz);
  let utc = guess - off1;
  const off2 = getZoneOffsetMs(utc, ianaTz);
  if (off2 !== off1) utc = guess - off2;

  const wp = utcToWallParts(utc, ianaTz);
  const existed = wp.y === y && wp.mo === mo && wp.d === d && wp.h === h && wp.mi === mi;
  // Fall-back vicinity: the offset shortly before vs after the resolved instant
  // differs while the time still exists → the wall time occurred twice.
  const ambiguous =
    existed &&
    getZoneOffsetMs(utc - 1800000, ianaTz) !== getZoneOffsetMs(utc + 1800000, ianaTz);
  return { utcMs: utc, existed, ambiguous };
}
