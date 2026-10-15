// lib/app-ai/store.ts — WHERE THE AI OF THE APPS IS COUNTED (spec local
// 2026-10-15, 4.4): what each project spent per month and environment, the
// account's cap alerts, and the cap the owner chose. Postgres in production
// (store-pg.ts); this one, in memory, for the tests.

export type AppAiEnvironment = "draft" | "live";

export interface ProjectMonth {
  readonly centicredits: number;
  readonly calls: number;
}

export interface AppAiStore {
  /** What the account's apps spent this month, in centicredits. */
  monthSpent(userId: string, month: string): Promise<number>;
  /** One finished call: its cost and +1 call. */
  add(o: {
    readonly userId: string;
    readonly month: string;
    readonly projectId: string;
    readonly environment: AppAiEnvironment;
    readonly centicredits: number;
  }): Promise<void>;
  /** The project's month, by environment. */
  projectMonth(projectId: string, month: string): Promise<Readonly<Record<AppAiEnvironment, ProjectMonth>>>;
  /** True ONCE per level and month; once 100 is given, 80 no longer goes out. */
  claimCapAlert(userId: string, month: string, percent: 80 | 100): Promise<boolean>;
  /** The owner's own cap in centicredits, or null for the default. */
  explicitCap(userId: string): Promise<number | null>;
  setExplicitCap(userId: string, cap: number | null): Promise<void>;
}

export function memoryAppAiStore(): AppAiStore {
  const spend = new Map<string, { userId: string; month: string; projectId: string; environment: AppAiEnvironment; centicredits: number; calls: number }>();
  const alerts = new Map<string, number>();
  const caps = new Map<string, number>();
  return {
    async monthSpent(userId, month) {
      let total = 0;
      for (const r of spend.values()) if (r.userId === userId && r.month === month) total += r.centicredits;
      return total;
    },
    async add({ userId, month, projectId, environment, centicredits }) {
      const k = `${userId}|${month}|${projectId}|${environment}`;
      const r = spend.get(k) ?? { userId, month, projectId, environment, centicredits: 0, calls: 0 };
      spend.set(k, { ...r, centicredits: r.centicredits + centicredits, calls: r.calls + 1 });
    },
    async projectMonth(projectId, month) {
      const out: Record<AppAiEnvironment, ProjectMonth> = { draft: { centicredits: 0, calls: 0 }, live: { centicredits: 0, calls: 0 } };
      for (const r of spend.values()) {
        if (r.projectId !== projectId || r.month !== month) continue;
        const e = out[r.environment];
        out[r.environment] = { centicredits: e.centicredits + r.centicredits, calls: e.calls + r.calls };
      }
      return out;
    },
    async claimCapAlert(userId, month, percent) {
      const k = `${userId}|${month}`;
      if ((alerts.get(k) ?? 0) >= percent) return false;
      alerts.set(k, percent);
      return true;
    },
    async explicitCap(userId) {
      return caps.get(userId) ?? null;
    },
    async setExplicitCap(userId, cap) {
      if (cap === null) caps.delete(userId);
      else caps.set(userId, cap);
    },
  };
}
