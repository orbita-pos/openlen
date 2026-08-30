/**
 * 🔴 LA COLUMNA `users.credits` GUARDA CENTICRÉDITOS, NO CRÉDITOS.
 *
 * Sigue siendo un `integer` —el dinero y los flotantes se llevan mal— pero su
 * unidad es 1/100 de crédito. Todo lo de este módulo (el saldo, los cargos
 * planos, lo que devuelve `creditsForUsage`) está en centicréditos. Al usuario
 * se le enseñan CRÉDITOS con dos decimales: `formatCredits`.
 *
 * POR QUÉ, MEDIDO el 2026-08-30 sobre 44 turnos reales:
 *
 *     exacto                          98,86
 *     con el redondeo de antes       125,00   +26,4%
 *     redondeando al más cercano      92,00    −6,9%   (perdíamos nosotros)
 *     centicréditos                   99,10    +0,2%
 *
 * `Math.ceil` a crédito entero cobraba un 26% de más, y no repartido: caía
 * entero sobre los turnos BARATOS. Un turno de 1,18 créditos pagaba 2 —un 70%
 * más—, mientras uno de 16,28 pagaba 17, un 4%. O sea que castigaba justo lo
 * que queremos fomentar: la pregunta corta, la corrección pequeña, el «no»
 * honesto. Y empujaba al usuario a acumularlo todo en una pregunta enorme, que
 * le sale peor a él y calienta menos la caché.
 *
 * En el plan gratis eso son 7,0 turnos donde caben 8,9.
 *
 * El suelo de 1 se queda, pero ahora vale 1 centicrédito (0,01 créditos) en vez
 * de un crédito entero: sigue impidiendo el cargo cero sin cobrar 14x por un
 * turno diminuto. En la práctica ninguno se acerca — con ~9k de prompt de
 * sistema, el más barato de los 44 costó 1,18 créditos.
 */
export const CENTICREDITOS_POR_CREDITO = 100;

/** Lo que vale un crédito en coste real de modelo. */
export const USD_PER_CREDIT = 0.01;

/** Centicréditos → dólares.
 *
 *  Existe para que no haya un `/ 100` suelto por ahí significando «créditos a
 *  dólares». Lo había —uno, en `image-edit-core.test.ts`— y al cambiar la
 *  unidad el 2026-08-30 se quedó desfasado en silencio: ni `tsc` ni el barrido
 *  lo ven, porque las dos unidades son `number`. Lo cazó la puerta de pruebas
 *  del deploy, que es tarde. */
export function usdDeCenticreditos(centicreditos: number): number {
  return (centicreditos / CENTICREDITOS_POR_CREDITO) * USD_PER_CREDIT;
}

/** Centicréditos → lo que ve el usuario. Dos decimales, y sin cola de ceros
 *  cuando el número es redondo: «20», no «20,00». */
export function formatCredits(centicreditos: number): string {
  const c = centicreditos / CENTICREDITOS_POR_CREDITO;
  return Number.isInteger(c) ? String(c) : c.toFixed(2);
}

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
