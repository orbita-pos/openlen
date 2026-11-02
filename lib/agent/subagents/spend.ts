// THE TURN'S SPENDING LIMIT, SHARED WITH ITS SUBAGENTS (spec local 2026-11-01-subagentes-de-len, §4.10):
// what Len spends and what its children spend count against the same cap, also after Len's turn closed —
// like Claude Code's session `maxBudgetUsd`, which counts its agents. In centicredits, as the route counts.

export interface TurnSpend {
  readonly cap: number;
  len(): number;
  children(): number;
  addChildren(centicredits: number): void;
  /** Whether Len's spend, the children's and `extra` (a running child's) reach the cap. */
  over(extra?: number): boolean;
}

export function createTurnSpend(cap: number, len: () => number): TurnSpend {
  let children = 0;
  return {
    cap,
    len,
    children: () => children,
    addChildren: (centicredits) => {
      children += Math.max(0, centicredits);
    },
    over: (extra = 0) => len() + children + extra >= cap,
  };
}
