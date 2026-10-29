// Vendored from DeepSeek Harness — `deepseek-ai/deepseek-harness` @ 00d5414, MIT
// (LICENSES/deepseek-harness.MIT.txt): `packages/util/time/src/index.ts`. Byte for byte except the import
// specifiers (their packages → ./session, ./brand, ./time) and the `declare module` blocks that
// register into their plugin system, so it diffs cleanly against upstream.
// OpenLen's own rules live outside this folder (lib/scheduled-tasks/limits.ts, view.ts).
/**
 * Time vocabulary shared by the boundaries that accept a caller's zone or a
 * wall-clock selector, plus one span type for elapsed and interval arithmetic.
 *
 * The library validates, canonicalizes, parses, and renders one canonical instant
 * format; it produces no model-facing text and owns no failure vocabulary. A refusal that carries a
 * reason is a discriminated result, and each caller maps that reason onto its
 * own domain code and diagnostic. `canonicalClientTimeZone` is the wire-boundary
 * form and answers a name or `undefined`; `formatFourDigitYearInstant` and
 * `resolveLocalInstant` take already-validated values and answer a string or
 * epoch milliseconds directly; `Duration` holds a span in milliseconds with no
 * implicit numeric conversion.
 * @module @deepseek-ai/dsh-util-time
 */

import { canonicalizeTimeZone } from './time-instant'

export { Duration } from './time-duration'
export {
  MAX_FOUR_DIGIT_YEAR_MS,
  MIN_FOUR_DIGIT_YEAR_MS,
  canonicalizeTimeZone,
  formatFourDigitYearInstant,
  fourDigitYearEpoch,
  isFourDigitYearInstant,
  parseLocalCalendar,
  parseOffsetInstant,
  resolveLocalInstant,
} from './time-instant'
export type { InstantRejection, LocalCalendarRejection, LocalCalendarTime, TimeZoneRejection } from './time-instant'

/**
 * Validate and canonicalize one caller-supplied IANA zone at a wire boundary.
 *
 * The canonical name is what a later reader needs: a zone identity is stored on
 * durable records and resolved again by another process, so an alias accepted
 * here would not compare equal to the zone a reader derives.
 * @param value - the caller's reported zone name.
 * @returns the canonical zone, or `undefined` when the name is unusable.
 */
export function canonicalClientTimeZone(value: string): string | undefined {
  const resolved = canonicalizeTimeZone(value)
  return resolved.kind === 'accepted' ? resolved.timeZone : undefined
}
