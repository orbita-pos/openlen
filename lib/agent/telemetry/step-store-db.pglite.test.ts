// @vitest-environment node
//
// Layer 0's rows as the turn goes, against Postgres semantics (PGlite): the recorder, the real store and the
// real upsert of step-store-db.ts. What matters is a turn the process dies in the middle of — its calls are
// already in the table, and the next turn finds its baseline there.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrainCall } from "@/lib/agent/brain";
import * as schema from "@/lib/db/schema";

const base = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return {
    schema: s,
    get db() {
      return base.db;
    },
  };
});

const { drizzleStepStoreDb } = await import("./step-store-db");
const { createStepStore } = await import("./step-store");
const { createStepRecorder } = await import("./step-recorder");

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  // The columns of scripts/agent-steps-migrate.ts.
  await pg.exec(`
    create table "agentRequestSteps" (
      "id" text primary key, "projectId" text not null, "turnId" text not null, "step" integer not null,
      "kind" text not null, "provider" text not null, "model" text not null, "effort" text,
      "startedAt" timestamp not null, "durationMs" integer not null, "firstByteMs" integer, "longestGapMs" integer,
      "inputTokens" integer, "cachedTokens" integer, "outputTokens" integer, "reasoningTokens" integer,
      "systemHash" text, "toolsHash" text, "prefixHash" text not null, "messageCount" integer not null,
      "turnFirstMessageCount" integer, "messageHashes" jsonb, "tools" jsonb, "repeats" jsonb, "cacheBreak" jsonb,
      "endReason" text, "createdAt" timestamp not null default now());
  `);
  base.db = drizzle(pg, { schema });
});

const T0 = Date.UTC(2026, 9, 28, 18, 0, 0);
function call(msgs: string[], cached: number): BrainCall {
  return {
    kind: "loop", provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash-1017", effort: "high", startedAt: T0, durationMs: 1000,
    usage: { inputTokens: cached + 2000, cachedTokens: cached, outputTokens: 10, thinkingTokens: 0 },
    stop: "end_turn",
    wire: { model: "m", messages: [{ role: "system", content: "S" }, ...msgs.map((c) => ({ role: "user", content: c }))] },
  };
}

type Row = { step: number; tools: unknown[] | null; messageHashes: unknown[] | null; endReason: string | null; createdAt: Date };
const rowsOf = async (turnId: string) =>
  (await pg.query<Row>(`select "step", "tools", "messageHashes", "endReason", "createdAt" from "agentRequestSteps" where "turnId" = $1 order by "step"`, [turnId])).rows;

describe("layer 0 rows as the turn goes, in Postgres", () => {
  it("🔴 a turn the process dies in leaves its calls, and the next turn's first call is compared with its last one", async () => {
    const store = createStepStore(drizzleStepStoreDb, { log: () => {} });
    const dead = createStepRecorder({ projectId: "P", turnId: "dead", hasHistory: false, store, log: () => {} });
    dead.onCall(call(["a"], 1000));
    dead.onStepTools([{ name: "Read", argsHash: "r1", ok: true }]);
    dead.onCall(call(["a", "b"], 1500));
    await dead.flush();
    // No finish(): the deploy killed it here.
    const rows = await rowsOf("dead");
    expect(rows.map((r) => [r.step, r.tools?.length, r.messageHashes !== null, r.endReason])).toEqual([
      [0, 1, false, null],
      [1, 0, true, null],
    ]);
    const baseline = await store.loadBaseline("P", "loop");
    expect(baseline).toMatchObject({ turnId: "dead", step: 1, cachedTokens: 1500 });
  });

  it("a row written again keeps its first createdAt and takes its tools, hashes and end reason", async () => {
    const store = createStepStore(drizzleStepStoreDb, { log: () => {} });
    const rec = createStepRecorder({ projectId: "P", turnId: "T", hasHistory: false, store, log: () => {} });
    rec.onCall(call(["a"], 1000));
    await rec.flush();
    const [first] = await rowsOf("T");
    rec.onStepTools([{ name: "Read", argsHash: "r1", ok: true }]);
    rec.onCall(call(["a", "b"], 1500));
    rec.finish({ endReason: "completed" });
    await rec.flush();
    const rows = await rowsOf("T");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.createdAt.getTime()).toBe(first!.createdAt.getTime());
    expect(rows.map((r) => [r.tools?.length, r.messageHashes !== null, r.endReason])).toEqual([
      [1, false, null],
      [0, true, "completed"],
    ]);
  });
});
