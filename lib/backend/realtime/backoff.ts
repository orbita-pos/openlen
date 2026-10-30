// DBConnection.Backoff (elixir-ecto/db_connection 2.10.2, Apache-2.0), the one
// Supabase Realtime (supabase/realtime @ f86df8c3) builds its retries with:
// `:rand_exp` for its ReplicationPoller's `retry_or_stop`, `:rand` for a
// channel's `postgres_subscribe`.

/** Its private `rand/2`: an integer in [min, max]. */
export function randBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Its `:rand_exp`: each wait is random between the previous one (capped at
 *  a third of max) and three times it (capped at max). */
export class RandExpBackoff {
  private prev: number;
  private readonly lower: number;

  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {
    this.lower = Math.max(min, Math.floor(max / 3));
    this.prev = min;
  }

  /** Its `backoff/1`. */
  next(): number {
    this.prev = randBetween(Math.min(this.prev, this.lower), Math.min(this.prev * 3, this.max));
    return this.prev;
  }

  /** Its `reset/1`. */
  reset(): void {
    this.prev = this.min;
  }
}
