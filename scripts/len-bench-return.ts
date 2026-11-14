/**
 * THE RETURN BENCH (spec local 2026-11-13-conversar-todo-el-mes, §8): does Len — or the person's own
 * assistant — answer as well when someone comes back to a long conversation ten hours later, with the
 * history trimmed (piece A) or starting from a summary written while idle (piece B)? And how much less
 * does that return cost? The parts are in lib/len-bench/cold-return/.
 *
 * ⚠️ `build` and `run` SPEND REAL MONEY on the provider, the same account production uses. Without `--yes`
 * they print what they would do and stop; with it they need `--budget-usd`, a hard cap with two locks (the
 * runner stops before a run that might not fit; the owner's balance on the bench's server is set to what is
 * left before every turn, so the route itself stops a turn that runs away).
 *
 *   npm run bench:return                                                        → the plan: cases, estimates, servers. $0
 *   npm run bench:return -- build --pilot --budget-usd=1.00 --yes               → builds the pilot's two cases
 *   npm run bench:return -- run --arm=today --pilot --runs=1 --budget-usd=… --yes
 *   npm run bench:return -- run --arm=trim --runs=3 --budget-usd=3.80 --yes
 *   npm run bench:return -- report                                              → the gates of §8.5. $0
 *
 * The bench's server (`npm run bench:len:servidor`, on a LOCAL throwaway database) has to be started with
 * the environment of the step: `plan` prints the three sets. Everything the bench makes stays in
 * plans/conversar-todo-el-mes/bench/ (local, never in the repo).
 */
import fs from "node:fs";
import path from "node:path";
import { ARMS, type Arm, type ReturnCase, type RunResult } from "@/lib/len-bench/cold-return/types";
import { ARM_SPECS, SERVER_ENV, type ServerConfig } from "@/lib/len-bench/cold-return/arms";
import { PILOT_CASE_IDS, RETURN_CASES, selectCases } from "@/lib/len-bench/cold-return/cases";
import { gateLines, gates } from "@/lib/len-bench/cold-return/gates";
import { Budget, BudgetStop, SetupStop, buildCase, estimateBuildUsd, estimateRunUsd, runArm, type BuiltCase } from "@/lib/len-bench/cold-return/runner";
import { BENCH_DIR, addSpend, capturesDir, keepBuild, latestRuns, loadBuilds, loadSpend, runStore, type Step } from "@/lib/len-bench/cold-return/store";
import { BASE_LEN_BENCH } from "@/lib/len-bench/entorno";

/** The spec's caps (§8.6): what each step is asked for with. */
const SPEC_CAPS = { pilot: 1.0, build: 3.6, today: 6.0, trim: 3.8, trim_summary: 4.4 } as const;
/** A question turn that has not ended by then is asked to stop, like the panel's ■. */
const TURN_TIMEOUT_MS = 15 * 60_000;
/** A building turn: the first turn of an app can take longer. */
const BUILD_TIMEOUT_MS = 30 * 60_000;

/** What the cold return's trim does to a built case, in a few words: whether it empties old results at all
 *  (a short conversation may not reach the 20.000 tokens the rule asks for — then only what was thought goes,
 *  and the «old result» question asks nothing new of that case). */
function trimLine(b: BuiltCase | undefined): string {
  if (!b?.trim) return "—";
  const freed = b.trim.tokensBefore > 0 ? Math.round((1 - b.trim.tokensAfter / b.trim.tokensBefore) * 100) : 0;
  return `-${freed}% · ${b.trim.resultsCleared} results emptied`;
}

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return found?.includes("=") ? found.slice(found.indexOf("=") + 1) : found ? "" : undefined;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;
const stamp = (): string => new Date().toISOString().slice(11, 19);
const log = (line: string): void => console.log(`${stamp()}  ${line}`);

function chosenCases(): ReturnCase[] {
  const only = arg("--only")?.split(",").filter(Boolean);
  return selectCases(arg("--pilot") !== undefined ? [...PILOT_CASE_IDS] : only);
}

function serverEnvLines(config: ServerConfig, dir: string): string[] {
  return Object.entries(SERVER_ENV[config]).map(([key, value]) => `      ${key}=${key === "OPENLEN_IDLE_SUMMARY_CAPTURE_DIR" ? path.resolve(capturesDir(dir)) : value}`);
}

function plan(dir: string): number {
  const builds = loadBuilds(dir);
  console.log("THE RETURN BENCH — the plan. Nothing is sent by this command.\n");
  console.log(`${"case".padEnd(26)} family  target  built        messages  build est.  what the trim frees`);
  for (const c of RETURN_CASES) {
    const b = builds.get(c.id);
    console.log(`${c.id.padEnd(26)} ${c.family.padEnd(6)}  ${`${c.targetKTokens}k`.padStart(6)}  ${(b ? `${Math.round(b.tokens / 1000)}k tokens` : "—").padEnd(11)}  ${String(c.build.length).padStart(8)}  ${usd(estimateBuildUsd(c)).padEnd(10)}  ${trimLine(b)}`);
  }
  const pilot = selectCases([...PILOT_CASE_IDS]);
  const sizeOf = (c: ReturnCase) => builds.get(c.id)?.tokens ?? c.targetKTokens * 1_000;
  const armTotal = (cases: readonly ReturnCase[], arm: Arm, runs: number) => cases.reduce((sum, c) => sum + runs * estimateRunUsd(sizeOf(c), arm), 0);
  console.log(`\nWorst-case estimates at DeepInfra's list price (the conversation sent with nothing cached), against the spec's caps (§8.6):`);
  console.log(`  pilot   build 2 cases ${usd(pilot.reduce((s, c) => s + estimateBuildUsd(c), 0))} + 3 arms × 1 run ${usd(ARMS.reduce((s, arm) => s + armTotal(pilot, arm, 1), 0))}   · cap ${usd(SPEC_CAPS.pilot)}`);
  console.log(`  build   12 cases ${usd(RETURN_CASES.reduce((s, c) => s + estimateBuildUsd(c), 0))}   · cap ${usd(SPEC_CAPS.build)}`);
  for (const arm of ARMS) console.log(`  ${ARM_SPECS[arm].label.padEnd(7)} 12 cases × 3 runs × 3 questions ${usd(armTotal(RETURN_CASES, arm, 3))}   · cap ${usd(SPEC_CAPS[arm])}`);
  console.log(`\nThe bench's server — \`npm run bench:len:servidor\`, on a LOCAL throwaway database — is started with, for each step:`);
  console.log(`  build (the cases are built on the new code; the summary's job goes to a file, no timer is armed)`);
  console.log(serverEnvLines("build", dir).join("\n"));
  console.log(`  run --arm=today`);
  console.log(serverEnvLines("today", dir).join("\n"));
  console.log(`  run --arm=trim and --arm=trim_summary`);
  console.log(serverEnvLines("new", dir).join("\n"));
  console.log(`\nIn order: build → run --arm=today → (restart the server) run --arm=trim → run --arm=trim_summary → report.`);
  console.log(`Each paid step needs --budget-usd and --yes, and the account's balance at the cap plus $5 (it is production's account).`);
  console.log(`A step's cap is the STEP's, across every command that runs it: so far build ${usd(loadSpend(dir, "build"))}, ${ARMS.map((arm) => `${ARM_SPECS[arm].label} ${usd(loadSpend(dir, arm))}`).join(", ")}.`);
  return 0;
}

function report(dir: string, cases: readonly ReturnCase[]): number {
  const ids = new Set(cases.map((c) => c.id));
  const runsOf = (arm: Arm): RunResult[] => latestRuns(runStore(dir, arm).load()).filter((r) => ids.has(r.caseId));
  const today = runsOf("today");
  const lines: string[] = [`THE RETURN BENCH — report of ${new Date().toISOString().slice(0, 10)} · ${cases.length} case(s)`, ""];
  if (today.length === 0) {
    console.log("No runs of today's arm yet: there is nothing to compare against.");
    return 1;
  }
  const sizeOf = (id: string) => RETURN_CASES.find((c) => c.id === id)?.targetKTokens ?? 0;
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);
  const right = (runs: RunResult[], id: string) => {
    const answers = runs.filter((r) => r.caseId === id && !r.infra).flatMap((r) => r.questions.filter((q) => !q.infra));
    return answers.length ? `${answers.filter((q) => q.pass).length}/${answers.length}` : "—";
  };
  const all = { today, trim: runsOf("trim"), trim_summary: runsOf("trim_summary") };
  lines.push(`${"case".padEnd(26)} ${ARMS.map((arm) => `${ARM_SPECS[arm].label} right`.padStart(10) + `${ARM_SPECS[arm].label} cost`.padStart(11)).join("")}`);
  for (const c of cases) {
    lines.push(
      `${c.id.padEnd(26)} ${ARMS.map((arm) => right(all[arm], c.id).padStart(10) + `$${mean(all[arm].filter((r) => r.caseId === c.id && !r.infra).map((r) => r.costUsd)).toFixed(4)}`.padStart(11)).join("")}`,
    );
  }
  lines.push("", "What the cold return's trim frees on each case (read off its history, no model):");
  for (const c of cases) lines.push(`  ${c.id.padEnd(26)} ${trimLine(loadBuilds(dir).get(c.id))}`);
  lines.push("");
  let verdicts = 0;
  for (const arm of ["trim", "trim_summary"] as const) {
    if (all[arm].length === 0) {
      lines.push(`Brazo ${ARM_SPECS[arm].label}: sin corridas todavía.`, "");
      continue;
    }
    const result = gates({ today, arm: all[arm], sizeOf });
    lines.push(...gateLines(ARM_SPECS[arm].label, result));
    if (arm === "trim_summary") lines.push(`  umbral del resumen (medido con la cola literal de la política de 40k, la más corta): ${!result.thresholdKnown ? `no se puede decir todavía: hacen falta 3 corridas juzgadas de cada pregunta` : result.smallestCleanSize === null ? "rompe alguna pregunta en todos los tamaños" : `desde ${result.smallestCleanSize}k no rompe ninguna pregunta`}`);
    lines.push("");
    verdicts += 1;
  }
  const spent = ARMS.reduce((sum, arm) => sum + runStore(dir, arm).load().reduce((s, r) => s + r.spentUsd, 0), 0) + [...loadBuilds(dir).values()].reduce((s, b) => s + b.spentUsd, 0);
  lines.push(`Gastado en total (construir + todas las corridas guardadas), a precio de lista: $${spent.toFixed(3)}`);
  console.log(lines.join("\n"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.txt"), `${lines.join("\n")}\n`);
  return verdicts > 0 ? 0 : 1;
}

async function paid(command: "build" | "run", dir: string): Promise<number> {
  const cases = chosenCases();
  const builds = loadBuilds(dir);
  const cap = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : Number.NaN;
  const armArg = arg("--arm");
  if (command === "run" && !ARMS.includes(armArg as Arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  const arm = armArg as Arm;
  const runs = Number(arg("--runs") ?? "3");
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a whole number above zero");
  const rebuild = arg("--rebuild") !== undefined;
  const toBuild = cases.filter((c) => rebuild || !builds.has(c.id));

  const estimate =
    command === "build"
      ? toBuild.reduce((sum, c) => sum + estimateBuildUsd(c), 0)
      : cases.reduce((sum, c) => sum + runs * estimateRunUsd(builds.get(c.id)?.tokens ?? c.targetKTokens * 1_000, arm), 0);
  const config: ServerConfig = command === "build" ? "build" : ARM_SPECS[arm].server;
  console.log(command === "build" ? `build · ${toBuild.length} case(s) to build of ${cases.length} chosen` : `run · arm ${ARM_SPECS[arm].label} (${arm}) · ${cases.length} case(s) × ${runs} run(s) × 3 questions`);
  const step: Step = command === "build" ? "build" : arm;
  const already = loadSpend(dir, step);
  console.log(`worst-case estimate ${usd(estimate)} · cap ${Number.isFinite(cap) ? usd(cap) : "— (give --budget-usd)"} for the whole step, of which $${already.toFixed(4)} is already spent by earlier commands`);
  console.log(`the bench's server at ${BASE_LEN_BENCH} must have been started with:`);
  console.log(serverEnvLines(config, dir).join("\n"));
  if (arg("--yes") === undefined) {
    console.log("\nDry run: nothing was sent. This spends real money on the account production uses — add --budget-usd=<cap> and --yes.");
    return 0;
  }
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--budget-usd=<cap> is required with --yes");
  if (command === "run") {
    const unbuilt = cases.filter((c) => !builds.has(c.id));
    if (unbuilt.length > 0) throw new Error(`not built: ${unbuilt.map((c) => c.id).join(", ")} — run build first`);
  }

  // Loaded only now: these reach the database, and a dry run must not.
  const { createWorld, startBench } = await import("@/lib/len-bench/cold-return/world");
  // The cap is the step's: what earlier commands of this step spent counts, and every amount is kept as it
  // is counted, so a command that dies has lost none of the count.
  const budget = new Budget(cap, already, (spent) => addSpend(dir, step, spent));
  if (budget.remaining() <= 0) throw new Error(`this step has already spent $${already.toFixed(4)} of its ${usd(cap)} cap`);
  const session = await startBench(BASE_LEN_BENCH);
  const world = createWorld({ base: BASE_LEN_BENCH, session, dir, timeoutTurnMs: TURN_TIMEOUT_MS, timeoutBuildMs: BUILD_TIMEOUT_MS, log });
  let ended: "done" | "cap" = "done";
  let failed = 0;
  let wrongServer: string | null = null;
  try {
    // The server's lock, opened once: the owner's balance is what this command may spend, and from here on
    // it only goes down.
    await session.open(budget.remaining());
    if (command === "build") {
      for (const c of toBuild) {
        const need = estimateBuildUsd(c);
        if (budget.remaining() < need) {
          log(`cap: ${c.id} may cost ${usd(need)} to build and ${usd(budget.remaining())} is left of ${usd(cap)}`);
          ended = "cap";
          break;
        }
        try {
          log(`${c.id}: building (${c.build.length} messages)…`);
          const built = await buildCase(c, world, budget);
          keepBuild(dir, built);
          log(`${c.id}: built · ${Math.round(built.tokens / 1000)}k tokens of conversation (target ${c.targetKTokens}k) · spent $${built.spentUsd.toFixed(4)}`);
        } catch (err) {
          if (err instanceof BudgetStop) {
            log(`cap: ${err.message}`);
            ended = "cap";
            break;
          }
          // A server that is not the building one repeats in every case: nothing else is tried.
          if (err instanceof SetupStop) throw err;
          failed += 1;
          log(`${c.id}: NOT built — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      ended = await runArm({ cases, builds, arm, runs, budget, world, store: runStore(dir, arm), retryInfra: arg("--retry-infra") !== undefined, log });
    }
  } catch (err) {
    if (!(err instanceof SetupStop)) throw err;
    wrongServer = err.message;
  } finally {
    // The owner's balance was the cap's lock: it is left at zero, so nothing else runs on this account by mistake.
    await session.close().catch(() => {});
  }
  const spentNow = budget.spentUsd - already;
  if (wrongServer) console.log(`\nSTOPPED — the bench's server is not right for this step, and it would repeat in every turn:\n  ${wrongServer}`);
  console.log(`\n${wrongServer ? "Stopped." : ended === "cap" ? "Stopped at the cap." : "Done."} This command spent $${spentNow.toFixed(4)}; the step has spent $${budget.spentUsd.toFixed(4)} of ${usd(cap)}, at list price${failed ? ` · ${failed} case(s) could not be built` : ""}.`);
  console.log(`For plans/len-2/gastos.md:  ${new Date().toISOString().slice(0, 10)} · return bench · ${command}${command === "run" ? ` ${arm}` : ""} · $${spentNow.toFixed(4)} at list price (DeepInfra) · cap of the step ${usd(cap)}`);
  return !wrongServer && ended === "done" && failed === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const command = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "plan";
  const dir = arg("--dir") ?? BENCH_DIR;
  if (command === "plan") return plan(dir);
  if (command === "report") return report(dir, chosenCases());
  if (command === "build" || command === "run") return paid(command, dir);
  throw new Error(`no such command: ${command} (plan, build, run, report)`);
}

void main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`bench:return: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
