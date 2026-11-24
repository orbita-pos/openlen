// @vitest-environment node
//
// WHAT A RUN COST AND DID, FROM THE ROWS THE ROUTE RECORDED (spec local 2026-11-12-len-3-1-ruta, §5 piece 5):
// one row per call to the provider in `agentRequestSteps`, wherever the server runs. The recordings folder
// was the runner's own, and a server started from another worktree (the base column, 92f4f7e21) writes to
// ITS folder: the cost would read $0 and the cap would never trip.
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import type { Sql } from "./cold-return/snapshot";
import { measuresFromSteps, preflightSteps, readRunSteps, settledRunSteps, stepsProblem, type RunSteps } from "./steps-of-run";

describe("measuresFromSteps — only the battery, or on purpose (review I2)", () => {
  it("the battery's game is measured from the table; the other games keep their recordings and their fallback", () => {
    expect(measuresFromSteps("clientes", false)).toBe(true);
    expect(measuresFromSteps("dev", false)).toBe(false);
    expect(measuresFromSteps("dev", true)).toBe(true);
  });
});

describe("preflightSteps — a database without the table is found before the first paid run (review I3)", () => {
  it("with the table: nothing to say", async () => {
    const p = new PGlite();
    await p.exec(`create table "agentRequestSteps" ("projectId" text)`);
    expect(await preflightSteps({ query: async (t, a) => (await p.query(t, a as unknown[] | undefined)).rows as never })).toBeNull();
  });
  it("without it: says what to do, instead of a raw database error after a paid run", async () => {
    const p = new PGlite();
    expect(await preflightSteps({ query: async (t, a) => (await p.query(t, a as unknown[] | undefined)).rows as never })).toMatch(/agentRequestSteps.*agent-steps:migrate/);
  });
});

let pg: PGlite;
let sql: Sql;

async function step(o: {
  projectId?: string;
  provider?: string;
  input?: number | null;
  cached?: number | null;
  output?: number | null;
  tools?: unknown;
  repeats?: unknown;
}) {
  await pg.query(
    `insert into "agentRequestSteps" ("projectId", "provider", "inputTokens", "cachedTokens", "outputTokens", "tools", "repeats")
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      o.projectId ?? "p1",
      o.provider ?? "deepinfra",
      o.input === undefined ? 1000 : o.input,
      o.cached === undefined ? 0 : o.cached,
      o.output === undefined ? 100 : o.output,
      JSON.stringify(o.tools ?? []),
      JSON.stringify(o.repeats ?? { identicalRun: 1, alternatingPair: 0 }),
    ],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  sql = { query: async (text, params) => (await pg.query(text, params as unknown[] | undefined)).rows as never };
  await pg.exec(`
    create table "agentRequestSteps" (
      "projectId" text not null, "provider" text not null,
      "inputTokens" integer, "cachedTokens" integer, "outputTokens" integer,
      "tools" jsonb, "repeats" jsonb, "createdAt" timestamp not null default now()
    );
  `);
});

describe("readRunSteps", () => {
  it("adds up the project's calls at DeepInfra's list price, and nobody else's", async () => {
    await step({ input: 10_000, cached: 8_000, output: 500 });
    await step({ input: 20_000, cached: 0, output: 1_000 });
    await step({ projectId: "other", input: 999_999, cached: 0, output: 999_999 });
    const r = await readRunSteps(sql, "p1");
    expect(r.calls).toBe(2);
    expect(r.inputTokens).toBe(30_000);
    expect(r.cachedTokens).toBe(8_000);
    expect(r.outputTokens).toBe(1_500);
    // $0,20 uncached · $0,006 cached · $0,60 output, per million (spec §7.1).
    expect(r.usdAtList).toBeCloseTo((22_000 * 0.2 + 8_000 * 0.006 + 1_500 * 0.6) / 1e6, 12);
  });

  it("a call the provider never reported (null tokens) counts as a call and costs nothing", async () => {
    await step({ input: null, cached: null, output: null });
    const r = await readRunSteps(sql, "p1");
    expect(r.calls).toBe(1);
    expect(r.usdAtList).toBe(0);
  });

  it("counts the writes refused for not having read the file (tools[].errorCode)", async () => {
    await step({ tools: [{ name: "Write", argsHash: "a", errorCode: "not_read" }, { name: "Read", argsHash: "b" }] });
    await step({ tools: [{ name: "Edit", argsHash: "c", errorCode: "not_read" }, { name: "Edit", argsHash: "d", errorCode: "old_string_not_found" }] });
    expect((await readRunSteps(sql, "p1")).notRead).toBe(2);
  });

  it("counts the calls where the telemetry saw a loop: three identical in a row, or an alternating pair", async () => {
    await step({ repeats: { identicalRun: 2, alternatingPair: 0 } });
    await step({ repeats: { identicalRun: 3, alternatingPair: 0 } });
    await step({ repeats: { identicalRun: 1, alternatingPair: 2 } });
    await step({ repeats: null });
    expect((await readRunSteps(sql, "p1")).repeats).toBe(2);
  });

  it("says which providers answered, once each", async () => {
    await step({ provider: "deepinfra" });
    await step({ provider: "fireworks" });
    await step({ provider: "deepinfra" });
    expect([...(await readRunSteps(sql, "p1")).providers].sort()).toEqual(["deepinfra", "fireworks"]);
  });
});

const steps = (calls: number, providers: string[] = ["deepinfra"]): RunSteps => ({
  calls,
  providers,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  usdAtList: 0,
  notRead: 0,
  repeats: 0,
});

describe("settledRunSteps — the route records its calls without waiting for them", () => {
  it("reads until two reads agree", async () => {
    const seen = [steps(2), steps(3), steps(3)];
    let i = 0;
    const r = await settledRunSteps(async () => seen[Math.min(i++, seen.length - 1)]!, async () => {});
    expect(r.calls).toBe(3);
    expect(i).toBe(3);
  });

  it("gives up on an empty table after a few reads instead of waiting for ever", async () => {
    let i = 0;
    const r = await settledRunSteps(async () => (i++, steps(0)), async () => {});
    expect(r.calls).toBe(0);
    expect(i).toBeLessThanOrEqual(6);
  });
});

describe("stepsProblem — what stops the suite before it counts a wrong number", () => {
  it("no call recorded while Len answered: the cost would read $0 and the cap never trip", () => {
    expect(stepsProblem(steps(0), { lenAnswered: true })).toMatch(/OPENLEN_STEP_TELEMETRY=0/);
  });
  it("a call answered by another provider: the bench counts DeepInfra's price and nothing else", () => {
    expect(stepsProblem(steps(4, ["deepinfra", "fireworks"]), { lenAnswered: true })).toMatch(/fireworks.*OPENLEN_AGENT_PROVIDERS=deepinfra/);
  });
  it("calls, all from DeepInfra: nothing to say; and a run where Len never answered is not this check's business", () => {
    expect(stepsProblem(steps(4), { lenAnswered: true })).toBeNull();
    expect(stepsProblem(steps(0), { lenAnswered: false })).toBeNull();
  });
});
