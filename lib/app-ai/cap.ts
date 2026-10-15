// lib/app-ai/cap.ts — WHAT IS IN FLIGHT AGAINST AN ACCOUNT'S MONTHLY CAP (spec
// local 2026-10-15, 4.4). The month's spend lives in Postgres; the calls still
// running live here, in this process. The check and the reservation happen in
// ONE synchronous step, so two calls can't both squeeze into the last room.

export class CapReservations {
  readonly #reserved = new Map<string, number>();

  reserved(userId: string): number {
    return this.#reserved.get(userId) ?? 0;
  }

  /** Reserves `amount` if `spent` + in flight + `amount` ≤ `cap`; returns the
   *  release (releasing twice releases once), or null. */
  tryReserve(userId: string, spent: number, amount: number, cap: number): (() => void) | null {
    const inFlight = this.reserved(userId);
    if (spent + inFlight + amount > cap) return null;
    this.#reserved.set(userId, inFlight + amount);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this.reserved(userId) - amount;
      if (left <= 0) this.#reserved.delete(userId);
      else this.#reserved.set(userId, left);
    };
  }
}
