export type PilotBudgetRole = "intent" | "baseline" | "creative" | "critic" | "patch";

export interface PilotBudgetRoleCounts {
  acquired: number;
  settled: number;
  rejected: number;
  incomplete: number;
}

export interface PilotBudgetSnapshot {
  limitMicromxn: number;
  reservedMicromxn: number;
  verifiedCostMicromxn: number;
  conservativeCostMicromxn: number;
  availableMicromxn: number;
  exhausted: boolean;
  requests: Record<PilotBudgetRole, PilotBudgetRoleCounts>;
}

export interface PilotBudgetLease {
  settle(actualCostMicromxn?: number): void;
}

export interface PilotBudgetGuard {
  acquire(role: PilotBudgetRole, maximumCostMicromxn: number): PilotBudgetLease | null;
  snapshot(): PilotBudgetSnapshot;
}

const ROLES: readonly PilotBudgetRole[] = ["intent", "baseline", "creative", "critic", "patch"];

function validMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createPilotBudgetGuard(limitMicromxn: number): PilotBudgetGuard {
  if (!validMoney(limitMicromxn) || limitMicromxn === 0) {
    throw new Error("pilot budget must be a positive integer number of micro-MXN");
  }

  let reservedMicromxn = 0;
  let verifiedCostMicromxn = 0;
  let conservativeCostMicromxn = 0;
  let exhausted = false;
  const requests = Object.fromEntries(ROLES.map((role) => [role, {
    acquired: 0,
    settled: 0,
    rejected: 0,
    incomplete: 0,
  }])) as Record<PilotBudgetRole, PilotBudgetRoleCounts>;

  const spent = () => verifiedCostMicromxn + conservativeCostMicromxn;

  return {
    acquire(role, maximumCostMicromxn) {
      if (!validMoney(maximumCostMicromxn) || maximumCostMicromxn === 0) {
        throw new Error("maximum pilot request cost must be a positive integer number of micro-MXN");
      }
      const available = limitMicromxn - spent() - reservedMicromxn;
      if (exhausted || maximumCostMicromxn > available) {
        exhausted = true;
        requests[role].rejected += 1;
        return null;
      }

      reservedMicromxn += maximumCostMicromxn;
      requests[role].acquired += 1;
      let settled = false;
      return {
        settle(actualCostMicromxn) {
          if (settled) return;
          settled = true;
          reservedMicromxn -= maximumCostMicromxn;
          requests[role].settled += 1;
          if (typeof actualCostMicromxn !== "number"
            || !validMoney(actualCostMicromxn)
            || actualCostMicromxn > maximumCostMicromxn) {
            conservativeCostMicromxn += maximumCostMicromxn;
            requests[role].incomplete += 1;
            return;
          }
          verifiedCostMicromxn += actualCostMicromxn;
        },
      };
    },
    snapshot() {
      return {
        limitMicromxn,
        reservedMicromxn,
        verifiedCostMicromxn,
        conservativeCostMicromxn,
        availableMicromxn: limitMicromxn - spent() - reservedMicromxn,
        exhausted,
        requests: Object.fromEntries(ROLES.map((role) => [role, { ...requests[role] }])) as Record<PilotBudgetRole, PilotBudgetRoleCounts>,
      };
    },
  };
}
