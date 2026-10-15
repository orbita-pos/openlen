// lib/functions/window-limiter.ts — HOW MANY TIMES IN A WINDOW, per key, in
// memory: the app is ONE process on ONE box, like ConcurrencyLimiter (if one
// day there are several, this moves to Postgres like the rate limiter). Fixed
// windows: cheap, and a burst of up to twice the limit across a window edge is
// fine for a fairness limit. Used by the Edge Functions gateway (per visitor
// IP) and the AI gateway (per project).

export interface WindowRule {
  readonly windowMs: number;
  readonly max: number;
}

const PRUNE_ABOVE = 50_000;

export class WindowLimiter {
  readonly #slots = new Map<string, { start: number; count: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Counts one hit if every window has room and returns 0; otherwise counts
   *  nothing and returns how many ms until it would fit. */
  hit(key: string, rules: readonly WindowRule[]): number {
    const t = this.#now();
    let wait = 0;
    const slots = rules.map((rule) => {
      const k = `${rule.windowMs}|${key}`;
      let slot = this.#slots.get(k);
      if (!slot || t - slot.start >= rule.windowMs) slot = { start: t, count: 0 };
      if (slot.count >= rule.max) wait = Math.max(wait, slot.start + rule.windowMs - t);
      return [k, slot] as const;
    });
    if (wait > 0) return wait;
    for (const [k, slot] of slots) {
      slot.count += 1;
      this.#slots.set(k, slot);
    }
    if (this.#slots.size > PRUNE_ABOVE) this.#prune(t);
    return 0;
  }

  #prune(t: number): void {
    for (const [k, slot] of this.#slots) {
      const windowMs = Number(k.slice(0, k.indexOf("|")));
      if (t - slot.start >= windowMs) this.#slots.delete(k);
    }
  }
}
