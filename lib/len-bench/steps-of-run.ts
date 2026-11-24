// lib/len-bench/steps-of-run.ts — WHAT A RUN COST AND DID, from the rows the route recorded.
//
// Spec local 2026-11-12-len-3-1-ruta, §5 piece 5: «las medidas laterales en absoluto, sacadas de
// `agentRequestSteps` de la base del banco». One row per call to the provider (layer 0, step-recorder.ts),
// written by whichever server ran the turn. The recordings the runner used to read lived in ITS OWN folder;
// a server started from another worktree (the base column, 92f4f7e21) writes to its own, so the cost read
// $0 and the cap never tripped. The table is shared: both servers write to the bench's database.
import { LIST_PRICE, usdOf } from "./cold-return/cost";
import { PILOT_ONLY_GAMES } from "./coste";
import type { Sql } from "./cold-return/snapshot";
import { REPEAT_THRESHOLDS } from "@/lib/agent/repeat-reminder";

/** The only provider the bench counts: both columns run on it (OPENLEN_AGENT_PROVIDERS=deepinfra). */
export const BENCH_PROVIDER = "deepinfra";

/** Which suites are measured from the table, with its «DeepInfra only» stop (review I2): the battery's games,
 *  whose base column runs from another folder, or any suite on purpose (`--medir-desde-la-base`). The other
 *  games keep their recordings and the server's Fireworks fallback, as their past numbers were taken. */
export function measuresFromSteps(juego: string, forced: boolean): boolean {
  return forced || PILOT_ONLY_GAMES.has(juego);
}

/** Before the first paid run (review I3): the bench's database has the table the runs are measured from. */
export async function preflightSteps(sql: Sql): Promise<string | null> {
  try {
    await sql.query(`select 1 from "agentRequestSteps" limit 0`);
    return null;
  } catch (err) {
    return `the bench's database has no agentRequestSteps table (${err instanceof Error ? err.message : String(err)}): run npm run agent-steps:migrate against it before a paid run`;
  }
}

export interface RunSteps {
  /** Calls to the provider, the main thread's and its subagents'. */
  readonly calls: number;
  /** Who answered them, once each. */
  readonly providers: readonly string[];
  readonly inputTokens: number;
  /** A subset of `inputTokens`. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
  /** At DeepInfra's list price without its promotion (spec §7.1). */
  readonly usdAtList: number;
  /** Writes refused because the file was not read first (F3): `tools[].errorCode = "not_read"`. */
  readonly notRead: number;
  /** Calls where the telemetry saw a loop (F4): the repeat reminder's first threshold of identical calls in a
   *  row, or an alternating pair. */
  readonly repeats: number;
}

interface StepRow {
  readonly provider: string;
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly outputTokens: number | null;
  readonly tools: readonly { readonly errorCode?: unknown }[] | null;
  readonly repeats: { readonly identicalRun?: unknown; readonly alternatingPair?: unknown } | null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A loop, as the repeat reminder would have seen it (lib/agent/repeat-reminder.ts). */
const isLoop = (r: StepRow["repeats"]): boolean => num(r?.identicalRun) >= REPEAT_THRESHOLDS[0]! || num(r?.alternatingPair) > 0;

export async function readRunSteps(sql: Sql, projectId: string): Promise<RunSteps> {
  const rows = await sql.query<StepRow>(
    `select "provider", "inputTokens", "cachedTokens", "outputTokens", "tools", "repeats" from "agentRequestSteps" where "projectId" = $1`,
    [projectId],
  );
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let usdAtList = 0;
  let notRead = 0;
  let repeats = 0;
  for (const r of rows) {
    const usage = { inputTokens: num(r.inputTokens), cachedTokens: num(r.cachedTokens), outputTokens: num(r.outputTokens) };
    inputTokens += usage.inputTokens;
    cachedTokens += Math.min(usage.cachedTokens, usage.inputTokens);
    outputTokens += usage.outputTokens;
    usdAtList += usdOf(usage, LIST_PRICE);
    notRead += (Array.isArray(r.tools) ? r.tools : []).filter((t) => t?.errorCode === "not_read").length;
    if (isLoop(r.repeats)) repeats++;
  }
  return { calls: rows.length, providers: [...new Set(rows.map((r) => r.provider))], inputTokens, cachedTokens, outputTokens, usdAtList, notRead, repeats };
}

/** The route records each call without waiting for it (step-recorder.ts): read until two reads agree. An empty
 *  table is given up on after a few reads — `stepsProblem` then says why. */
export async function settledRunSteps(read: () => Promise<RunSteps>, sleep: (ms: number) => Promise<void>): Promise<RunSteps> {
  let last = await read();
  for (let i = 0; i < 12; i++) {
    if (last.calls === 0 && i >= 4) return last;
    await sleep(1_000);
    const next = await read();
    if (next.calls > 0 && next.calls === last.calls) return next;
    last = next;
  }
  return last;
}

/** What stops the suite before it counts a wrong number, or `null`. */
export function stepsProblem(s: RunSteps, o: { readonly lenAnswered: boolean }): string | null {
  if (o.lenAnswered && s.calls === 0) {
    return "the server recorded no call for this run (agentRequestSteps): the cost would read $0 and the cap would never trip. Start the bench's server without OPENLEN_STEP_TELEMETRY=0, on the bench's database.";
  }
  const foreign = s.providers.find((p) => p !== BENCH_PROVIDER);
  if (foreign) return `a call was answered by ${foreign}: the bench counts ${BENCH_PROVIDER}'s price and nothing else. Start the server with OPENLEN_AGENT_PROVIDERS=${BENCH_PROVIDER}.`;
  return null;
}
