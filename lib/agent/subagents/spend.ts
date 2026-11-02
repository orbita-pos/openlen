// THE TURN'S SPENDING LIMIT, SHARED WITH ITS SUBAGENTS (spec local 2026-11-01-subagentes-de-len, §4.10):
// what Len spends and what its children spend count against the same cap, also after Len's turn closed —
// like Claude Code's session `maxBudgetUsd`, which counts its agents. In centicredits, as the route counts.

export interface TurnSpend {
  readonly cap: number;
  len(): number;
  /** What the children that ended were charged. */
  children(): number;
  addChildren(centicredits: number): void;
  /** A running child's spend so far (it replaces its previous report): the others and Len count it too. */
  track(id: string, centicredits: number): void;
  /** A child ended: its running spend becomes what it was charged. */
  settle(id: string, centicredits: number): void;
  /** Whether Len's spend, the ended children's, the running ones' and `extra` reach the cap. */
  over(extra?: number): boolean;
}

export function createTurnSpend(cap: number, len: () => number): TurnSpend {
  let children = 0;
  const running = new Map<string, number>();
  const addChildren = (centicredits: number) => {
    children += Math.max(0, centicredits);
  };
  return {
    cap,
    len,
    children: () => children,
    addChildren,
    track: (id, centicredits) => void running.set(id, Math.max(0, centicredits)),
    settle: (id, centicredits) => {
      running.delete(id);
      addChildren(centicredits);
    },
    over: (extra = 0) => {
      let live = 0;
      for (const c of running.values()) live += c;
      return len() + children + live + extra >= cap;
    },
  };
}
