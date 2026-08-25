export const CREDIT_BALANCE_CHANGED_EVENT = "openlen:credits-changed";

/** Ask every mounted credit indicator to refetch the server balance. */
export function notifyCreditBalanceChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CREDIT_BALANCE_CHANGED_EVENT));
}

/**
 * The credit wall carries a per-user date. If the server sent it as prose, the
 * only way to keep the date would be to show the server's Spanish sentence to
 * every locale — so it travels as an ISO instant instead and each surface says
 * it in its own words, in the reader's own timezone (the pill formats the same
 * instant, so both agree on the day).
 *
 * Returns `{ refillsAt }` only for the no-credit code; every other Agent error
 * keeps its localized string.
 */
export function noCreditsRefill(
  code: unknown,
  payload: unknown,
): { refillsAt: string | null } | null {
  if (code !== "no_credits") return null;
  const raw =
    payload && typeof payload === "object"
      ? (payload as { refillsAt?: unknown }).refillsAt
      : null;
  return { refillsAt: typeof raw === "string" && raw.trim() ? raw : null };
}

/** ISO instant → a day the reader recognizes, or null when it can't be read. */
export function creditRefillLabel(
  iso: string | null | undefined,
  locale: string,
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(at);
}

type NoCreditsKey = "no_credits" | "no_credits_at";

/**
 * The Chat and the Agent share one credit wall. Given the SSE error payload
 * and the surface's translator, returns the sentence in the reader's language
 * — or null for every other error, which keeps its own localized string.
 */
export function noCreditsText(
  code: unknown,
  payload: unknown,
  locale: string,
  translate: (key: NoCreditsKey, values?: { date: string }) => string,
): string | null {
  const refill = noCreditsRefill(code, payload);
  if (!refill) return null;
  const day = creditRefillLabel(refill.refillsAt, locale);
  return day ? translate("no_credits_at", { date: day }) : translate("no_credits");
}
