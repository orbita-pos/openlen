// lib/app-ai/free-pool.ts — THE FREE PLAN'S AI, all accounts together, per UTC
// day (spec local 2026-10-15, 4.5): a safety net against a thousand throwaway
// accounts. In memory (one process): a restart empties it, which at worst lets
// one more day's cap through. Reserve the worst case, settle the real one.

const ALERT_SHARE = 0.8;

export class FreeDailyPool {
  readonly cap: number;
  readonly #now: () => Date;
  #day = "";
  #spent = 0;
  #reserved = 0;
  #alerted = false;

  constructor(cap: number, now: () => Date = () => new Date()) {
    this.cap = cap;
    this.#now = now;
  }

  #roll(): void {
    const day = this.#now().toISOString().slice(0, 10);
    if (day === this.#day) return;
    this.#day = day;
    this.#spent = 0;
    this.#reserved = 0;
    this.#alerted = false;
  }

  get day(): string {
    this.#roll();
    return this.#day;
  }

  get spent(): number {
    this.#roll();
    return this.#spent;
  }

  tryReserve(amount: number): boolean {
    this.#roll();
    if (this.#spent + this.#reserved + amount > this.cap) return false;
    this.#reserved += amount;
    return true;
  }

  /** Releases `reserved` and adds `actual`. True ONCE a day, when the spend crosses 80 %. */
  settle(reserved: number, actual: number): boolean {
    this.#roll();
    this.#reserved = Math.max(0, this.#reserved - reserved);
    this.#spent += actual;
    if (this.#alerted || this.cap <= 0 || this.#spent < this.cap * ALERT_SHARE) return false;
    this.#alerted = true;
    return true;
  }
}
