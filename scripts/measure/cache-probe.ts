/**
 * THE CACHE PROBE's runner (spec local 2026-11-13-conversar-todo-el-mes, §8.1; the plan and every number
 * live in lib/measure/cache-probe.ts).
 *
 * ⚠️ It spends real money on DeepInfra — the same account production uses. Without `--yes` it only prints
 * the plan and its worst case. With it: eighteen calls over three hours, unattended, through the real
 * client (`createFireworksStreamClient` with DeepInfra's dialect, so the cache key travels exactly as a
 * turn's does), a hard cap asked before EVERY call, and the state saved after every call:
 *
 *   npm run measure:cache-probe                                   → the plan, nothing sent
 *   npm run measure:cache-probe -- --yes --budget-usd=0.15         → the probe
 *   npm run measure:cache-probe -- --yes --resume=<run id>         → goes on after a kill
 *   npm run measure:cache-probe -- --report=<run id>               → reads a finished one again, nothing sent
 *
 * The state and the report go to plans/conversar-todo-el-mes/cache-probe/ (local, never in the repo).
 */
import fs from "node:fs";
import path from "node:path";
import type { Message } from "@/lib/ai-gateway";
import { messagesForFireworks } from "@/lib/agent/fireworks-bridge";
import { createFireworksStreamClient, type FireworksStreamRequest } from "@/lib/ai/fireworks-stream-client";
import { resolveAgentProviders } from "@/lib/ai/providers";
import {
  PROBE_CAP_USD_DEFAULT,
  PROBE_MAX_OUTPUT_TOKENS,
  newProbeState,
  probeReport,
  runProbe,
  spentUsd,
  worstCaseRemainingUsd,
  type ProbeCall,
  type ProbeState,
} from "@/lib/measure/cache-probe";

const DIR = path.join("plans", "conversar-todo-el-mes", "cache-probe");
/** A call that has not ended by then is abandoned and its prefix reported as failed. */
const CALL_TIMEOUT_MS = 180_000;

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return found?.includes("=") ? found.slice(found.indexOf("=") + 1) : found ? "" : undefined;
}

const fileOf = (runId: string): string => path.join(DIR, `${runId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

function save(state: ProbeState): void {
  fs.mkdirSync(DIR, { recursive: true });
  const file = fileOf(state.runId);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function load(runId: string): ProbeState {
  const file = fileOf(runId);
  if (!fs.existsSync(file)) throw new Error(`no probe «${runId}» in ${DIR}`);
  const state = JSON.parse(fs.readFileSync(file, "utf8")) as ProbeState;
  if (state.v !== 1 || !Array.isArray(state.entries)) throw new Error(`${file} is not a probe's state`);
  return state;
}

async function main(): Promise<number> {
  const reportOnly = arg("--report");
  if (reportOnly !== undefined) {
    console.log(probeReport(load(reportOnly)).lines.join("\n"));
    return 0;
  }

  // DeepInfra whatever OPENLEN_AGENT_PROVIDERS says: it is the provider whose cache is being measured.
  const [deepinfra] = resolveAgentProviders({ ...process.env, OPENLEN_AGENT_PROVIDERS: "deepinfra" }, ["deepinfra"]);
  if (!deepinfra) throw new Error("no DEEPINFRA_API_KEY in the environment: nothing to probe");
  const cap = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : PROBE_CAP_USD_DEFAULT;
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--budget-usd must be a number above zero");

  const resume = arg("--resume");
  const state = resume !== undefined ? load(resume) : newProbeState(new Date().toISOString().replace(/[-:]/g, "").slice(0, 13), deepinfra.modelId);
  if (state.model !== deepinfra.modelId) throw new Error(`probe «${state.runId}» was started on ${state.model}; Len's model is now ${deepinfra.modelId}`);

  const left = state.entries.reduce((n, e) => n + (e.first === null ? 2 : e.second === null && !e.first.error ? 1 : 0), 0);
  console.log(`provider  ${deepinfra.id} · ${deepinfra.dialect.endpoint}`);
  console.log(`model     ${deepinfra.modelId}`);
  console.log(`probe     ${state.runId}${resume !== undefined ? " (resumed)" : ""} · ${state.entries.length} prefixes · ${left} calls left · about 3 hours`);
  console.log(`delays    ${state.entries.map((e) => e.delayMin).join(", ")} minutes (the first is the control)`);
  console.log(`spent     $${spentUsd(state).toFixed(4)} · worst case of what is left $${worstCaseRemainingUsd(state).toFixed(4)} · cap $${cap.toFixed(2)}`);
  if (spentUsd(state) + worstCaseRemainingUsd(state) > cap) throw new Error(`REFUSED: the worst case does not fit under --budget-usd=${cap.toFixed(2)}`);
  if (arg("--yes") === undefined) {
    console.log("\nDry run: nothing was sent. It spends real money on the account production uses — check its balance is the cap plus $5, then add --yes.");
    return 0;
  }

  const client = createFireworksStreamClient({
    apiKey: deepinfra.apiKey,
    endpoint: deepinfra.dialect.endpoint,
    modelId: deepinfra.modelId,
    affinityField: deepinfra.dialect.affinityField,
    effortStyle: deepinfra.dialect.effortStyle,
  });

  async function send(entry: { cacheKey: string }, text: string): Promise<ProbeCall> {
    const started = Date.now();
    const at = new Date(started).toISOString();
    const messages: Message[] = [
      { role: "system", content: text },
      { role: "user", content: "Reply with the single word OK." },
    ];
    const request: FireworksStreamRequest = {
      messages: messagesForFireworks(messages),
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
      temperature: 0,
      // The cache key: the client sends it in the field a turn's project id travels in.
      requestId: entry.cacheKey,
      operation: "agent_turn",
      // No thinking: the answer is one word.
      esfuerzo: null,
    };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
    let usage: { inputTokens: number; cachedTokens: number; outputTokens: number } | null = null;
    try {
      for await (const event of client.stream(request, { signal: abort.signal })) {
        if (event.type === "usage") usage = event;
      }
    } catch (err) {
      return { at, inputTokens: 0, cachedTokens: 0, outputTokens: 0, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
    if (!usage) return { at, inputTokens: 0, cachedTokens: 0, outputTokens: 0, ms: Date.now() - started, error: "the provider reported no usage" };
    return { at, inputTokens: usage.inputTokens, cachedTokens: Math.min(usage.cachedTokens, usage.inputTokens), outputTokens: usage.outputTokens, ms: Date.now() - started };
  }

  save(state);
  console.log(`state     ${fileOf(state.runId)}\n`);
  const ended = await runProbe(state, cap, {
    send,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    save,
    log: (line) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`),
  });

  const report = probeReport(state);
  console.log(`\n${report.lines.join("\n")}`);
  fs.writeFileSync(path.join(DIR, `${state.runId}.report.txt`), `${report.lines.join("\n")}\n`);
  console.log(`\nFor plans/len-2/gastos.md:  ${new Date().toISOString().slice(0, 10)} · cache probe ${state.runId} · $${report.spentUsd.toFixed(4)} at list price (DeepInfra) · cap $${cap.toFixed(2)}`);
  if (ended === "cap") console.log(`Stopped at the cap. To go on with a higher one: --yes --resume=${state.runId} --budget-usd=<new cap>`);
  return ended === "done" && report.controlOk ? 0 : 1;
}

void main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`cache-probe: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
