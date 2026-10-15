// @vitest-environment node
//
// Splitting migration SQL runs in its own thread (14/10). A catastrophic regex in
// the splitter hung the app's MAIN thread at 100% CPU forever: the whole server
// stopped answering, and the terminal's command timeout could not even fire.
// These tests prove the app's thread keeps running whatever the splitter does.
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSqlSplitter, type SqlSplitter } from "./split-off-thread";
import { splitSqlStatements } from "./sql-split.mjs";

const HANGING_WORKER = path.join(process.cwd(), "lib", "backend", "split-off-thread.fixture.mjs");

let splitters: SqlSplitter[] = [];
const splitter = (o?: Parameters<typeof createSqlSplitter>[0]) => {
  const s = createSqlSplitter(o);
  splitters.push(s);
  return s;
};
afterEach(() => {
  for (const s of splitters) s.stop();
  splitters = [];
});

/** How many times a 20 ms timer on this thread fired while `p` was pending. */
async function ticksWhile<T>(p: Promise<T>): Promise<{ result: T; ticks: number; ms: number }> {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  const t0 = Date.now();
  try {
    const result = await p;
    return { result, ticks, ms: Date.now() - t0 };
  } finally {
    clearInterval(timer);
  }
}

describe("splitting migration SQL off the app's thread", () => {
  it("splits in its own thread exactly as splitSqlStatements does", async () => {
    const divider = `-- PROFILES ${"-".repeat(66)}\n`;
    const sql = `${divider}create table a (id int);\ncreate function f() returns trigger language plpgsql as $$\nbegin\n  return new;\nend; $$;\n${divider}`;
    const s = splitter();
    expect(await s.split(sql, { timeoutMs: 10_000 })).toEqual(splitSqlStatements(sql));
  });

  it("🔴 a split that never ends doesn't stop the app's thread, and its cap ends it", async () => {
    const s = splitter({ workerPath: HANGING_WORKER });
    const { result, ticks, ms } = await ticksWhile(s.split("select 1;", { timeoutMs: 600 }));
    expect(result).toBeNull();
    expect(ms).toBeGreaterThanOrEqual(550);
    expect(ms).toBeLessThan(10_000);
    // ~30 ticks in 600 ms on an idle machine (fewer when the whole suite runs at
    // once); a blocked thread gives 0 or 1.
    expect(ticks).toBeGreaterThan(5);
  });

  it("🔴 aborting the signal (the command timed out) ends it at once, and the next split runs in a fresh thread", async () => {
    const s = splitter({ workerPath: HANGING_WORKER });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 100);
    const { result, ms } = await ticksWhile(s.split("select 1;", { timeoutMs: 60_000, signal: stop.signal }));
    expect(result).toBeNull();
    expect(ms).toBeLessThan(1_000);

    const fresh = splitter();
    expect(await fresh.split("select 1; select 2;", { timeoutMs: 10_000 })).toEqual(["select 1", "select 2"]);
  });
});
