// @vitest-environment node
//
// `db` inside `inTransaction` is the transaction; work it leaves running (a `void` call, a timer) inherits that
// scope, so once the transaction has ended it must go back to the pool: in node-postgres the transaction's client
// has been released, and a late query on it would run on whatever connection that is now.
import { describe, expect, it } from "vitest";

import { transactionScope } from "./transaction-scope";

/** A database that names who ran each call; its transactions commit when the work resolves. */
function fakeDatabase() {
  const calls: string[] = [];
  const make = (name: string): unknown => ({
    who: () => calls.push(name),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const value = await work(make(`${name}:tx`));
      calls.push(`${name}:commit`);
      return value;
    },
  });
  return { calls, root: make("pool") as never };
}

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("transactionScope", () => {
  it("is the transaction inside the work and the pool outside it", async () => {
    const { calls, root } = fakeDatabase();
    const scope = transactionScope(root);
    await scope.run(async () => { (scope.db as unknown as { who(): void }).who(); });
    (scope.db as unknown as { who(): void }).who();
    expect(calls).toEqual(["pool:tx", "pool:commit", "pool"]);
  });

  it("work left running inside a transaction uses the pool once it has ended", async () => {
    const { calls, root } = fakeDatabase();
    const scope = transactionScope(root);
    const db = scope.db as unknown as { who(): void };
    let late!: Promise<void>;
    await scope.run(async () => {
      late = (async () => { await later(20); db.who(); })();
    });
    await late;
    expect(calls).toEqual(["pool:commit", "pool"]);
  });

  it("a transaction asked for by that late work is a new one, not the ended one", async () => {
    const { calls, root } = fakeDatabase();
    const scope = transactionScope(root);
    const db = scope.db as unknown as { who(): void };
    let late!: Promise<void>;
    await scope.run(async () => {
      late = (async () => { await later(20); await scope.run(async () => { db.who(); }); })();
    });
    await late;
    expect(calls).toEqual(["pool:commit", "pool:tx", "pool:commit"]);
  });

  it("an afterCommit from that late work runs at once", async () => {
    const { root } = fakeDatabase();
    const scope = transactionScope(root);
    const ran: string[] = [];
    let late!: Promise<void>;
    await scope.run(async () => {
      late = (async () => { await later(20); scope.afterCommit(() => ran.push("late")); })();
    });
    await late;
    expect(ran).toEqual(["late"]);
  });

  it("afterCommit waits for the commit, and a rolled-back transaction never runs it", async () => {
    const { root } = fakeDatabase();
    const scope = transactionScope(root);
    const ran: string[] = [];
    await scope.run(async () => { scope.afterCommit(() => ran.push("committed")); expect(ran).toEqual([]); });
    await expect(scope.run(async () => { scope.afterCommit(() => ran.push("rolled back")); throw new Error("refused"); })).rejects.toThrow("refused");
    expect(ran).toEqual(["committed"]);
  });
});
