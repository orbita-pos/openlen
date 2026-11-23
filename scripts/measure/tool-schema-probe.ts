/**
 * THE TOOL-SCHEMA PROBE (spec local 2026-11-22-artifacts-de-len): does each of Len's providers take `artifact_data`'s
 * declaration — whose `query.where[].value` and `data` carry no JSON type, because they are any JSON value and any
 * object — and does the model fill them so that `artifact_data` itself accepts the call?
 *
 * Per provider, two calls through the real client and the real bridge (`toolsForFireworks`, as a turn sends them), with
 * the two declarations (`publish_artifact`, `artifact_data`) and the agent role's model:
 *   · query — a `where` whose value is the boolean false;
 *   · set   — a `data` object with text, a boolean and a list.
 * Each is judged three ways: the provider answered (no refusal of the schema), the model called `artifact_data` with those
 * values, and `parseRead` / `parseWrite` (lib/len-artifacts/validate.ts, what `artifact_data` runs) take its arguments.
 *
 * ⚠️ It spends real money on the accounts production uses. Without `--yes` it prints the plan and its worst case:
 *
 *   npx tsx --tsconfig tsconfig.eval.json --env-file=.env.local --require ./scripts/test-node-server-only-shim.cjs \
 *     scripts/measure/tool-schema-probe.ts -- --yes --budget-usd=0.10
 *
 * Nothing it sends is anyone's data: the prompts are written here. The report goes to plans/len-artifacts/ (local).
 */
import fs from "node:fs";
import path from "node:path";
import type { Message } from "@/lib/ai-gateway";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { createFireworksStreamClient } from "@/lib/ai/fireworks-stream-client";
import { resolveAgentProviders } from "@/lib/ai/providers";
import { ARTIFACT_DATA, ARTIFACT_DATA_DECLARATION, PUBLISH_ARTIFACT_DECLARATION } from "@/lib/len-artifacts/tools";
import { parseRead, parseWrite } from "@/lib/len-artifacts/validate";
import { WIRE_PROBE_PRICES, wireProbeCostUsd, type WireProvider } from "@/lib/measure/wire-probe";

const DIR = path.join("plans", "len-artifacts", "tool-schema-probe");
const PROVIDERS: readonly WireProvider[] = ["deepinfra", "fireworks"];
const MAX_OUTPUT_TOKENS = 400;
const CALL_TIMEOUT_MS = 120_000;
/** Each call's worst case: this many input tokens (the two declarations and the prompt are ~2,500) at full price, and the
 *  whole output allowance, at the dearest provider's prices. */
const WORST_INPUT_TOKENS = 6_000;

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return found?.includes("=") ? found.slice(found.indexOf("=") + 1) : found ? "" : undefined;
}

const SYSTEM =
  "You are an agent with your own small tools. Answer only by calling the tool the person names, exactly once, with exactly " +
  "the arguments they give. Do not write any text.";

interface Step {
  readonly id: "query" | "set";
  readonly ask: string;
  /** What the call must carry for the step to pass, beyond `artifact_data` accepting it. */
  check(args: Record<string, unknown>): string | null;
}

const STEPS: readonly Step[] = [
  {
    id: "query",
    ask:
      'Call artifact_data with artifact "recorrido", action "query", collection "tasks", and a query whose where has one condition: ' +
      'field "done", op "==", value false (the boolean, not text).',
    check(args) {
      const where = (args.query as { where?: Array<{ value?: unknown }> } | undefined)?.where;
      return where?.[0]?.value === false ? null : `where[0].value is ${JSON.stringify(where?.[0]?.value)}, not false`;
    },
  },
  {
    id: "set",
    ask:
      'Call artifact_data with artifact "recorrido", action "set", collection "tasks", doc_id "t1", and data ' +
      '{"title": "Pay rent", "done": false, "tags": ["home"]}.',
    check(args) {
      const data = args.data as { title?: unknown; done?: unknown; tags?: unknown } | undefined;
      const ok = data && data.title === "Pay rent" && data.done === false && Array.isArray(data.tags) && data.tags[0] === "home";
      return ok ? null : `data is ${JSON.stringify(data)}`;
    },
  },
];

/** What `artifact_data` itself would say of these arguments: null when it takes them. */
function toolDataTakes(step: Step, args: Record<string, unknown>): string | null {
  const input = { collection: args.collection, docId: args.doc_id, data: args.data, query: args.query };
  const parsed = step.id === "query" ? parseRead("query", input) : parseWrite("set", input);
  return "problem" in parsed ? parsed.problem : null;
}

interface Outcome {
  readonly provider: WireProvider;
  readonly model: string;
  readonly step: Step["id"];
  readonly accepted: boolean;
  readonly called: boolean;
  readonly valuesRight: boolean;
  readonly toolDataTakes: boolean;
  readonly detail: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
  readonly ms: number;
}

async function main(): Promise<number> {
  const cap = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : 0.1;
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--budget-usd must be a number above zero");
  const providers = PROVIDERS.flatMap((name) => {
    const [resolved] = resolveAgentProviders({ ...process.env, OPENLEN_AGENT_PROVIDERS: name }, [name]);
    if (!resolved) console.log(`provider  ${name}: no key in the environment, left out`);
    return resolved ? [{ name, resolved }] : [];
  });
  if (providers.length === 0) throw new Error("no provider key in the environment: nothing to probe");

  const dearest = Object.values(WIRE_PROBE_PRICES).reduce((a, p) => ({ input: Math.max(a.input, p.input), output: Math.max(a.output, p.output) }), { input: 0, output: 0 });
  const worstPerCall = (WORST_INPUT_TOKENS * dearest.input + MAX_OUTPUT_TOKENS * dearest.output) / 1e6;
  const calls = providers.length * STEPS.length;
  for (const p of providers) console.log(`provider  ${p.name} · ${p.resolved.dialect.endpoint} · ${p.resolved.modelId}`);
  console.log(`probe     ${calls} calls (${STEPS.map((s) => s.id).join(", ")} per provider) · worst $${(worstPerCall * calls).toFixed(4)} · cap $${cap.toFixed(2)}`);
  if (worstPerCall * calls > cap) throw new Error(`REFUSED: the worst case does not fit under --budget-usd=${cap.toFixed(2)}`);
  if (arg("--yes") === undefined) {
    console.log("\nDry run: nothing was sent. It spends real money on the accounts production uses; add --yes to run it.");
    return 0;
  }

  const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const tools = toolsForFireworks([PUBLISH_ARTIFACT_DECLARATION, ARTIFACT_DATA_DECLARATION] as unknown as Parameters<typeof toolsForFireworks>[0]);
  const outcomes: Outcome[] = [];
  let spent = 0;
  for (const p of providers) {
    const client = createFireworksStreamClient({
      apiKey: p.resolved.apiKey,
      endpoint: p.resolved.dialect.endpoint,
      modelId: p.resolved.modelId,
      affinityField: p.resolved.dialect.affinityField,
      effortStyle: p.resolved.dialect.effortStyle,
    });
    for (const step of STEPS) {
      if (spent + worstPerCall > cap) {
        console.log(`STOPPED before ${p.name}/${step.id}: $${spent.toFixed(4)} spent, a call could cost $${worstPerCall.toFixed(4)}, cap $${cap.toFixed(2)}`);
        break;
      }
      const messages: Message[] = [
        { role: "system", content: SYSTEM },
        { role: "user", content: step.ask },
      ] as unknown as Message[];
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
      const started = Date.now();
      let usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
      let call: { name: string; args: Record<string, unknown> } | null = null;
      let error: string | undefined;
      try {
        for await (const event of client.stream(
          {
            messages: messagesForFireworks(messages),
            tools,
            toolChoice: "auto",
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: 0,
            requestId: `tool-schema-probe-${runId}`,
            operation: "agent_turn",
            esfuerzo: null,
          },
          { signal: abort.signal },
        )) {
          if (event.type === "usage") usage = { inputTokens: event.inputTokens, cachedTokens: Math.min(event.cachedTokens, event.inputTokens), outputTokens: event.outputTokens };
          else if (event.type === "function_call" && !call) call = { name: event.name, args: event.args };
          else if (event.type === "done" && event.stopReason.kind === "error") error = [event.stopReason.httpStatus, event.stopReason.code, event.stopReason.error].filter((x) => x !== undefined && x !== "").join(" ");
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
      const usd = wireProbeCostUsd(p.name, { ...usage, text: "", toolCalls: call ? 1 : 0, ms: 0 });
      spent += usd;
      const called = call?.name === ARTIFACT_DATA;
      const wrong = called ? step.check(call!.args) : null;
      const refused = called ? toolDataTakes(step, call!.args) : null;
      const outcome: Outcome = {
        provider: p.name,
        model: p.resolved.modelId,
        step: step.id,
        accepted: !error,
        called,
        valuesRight: called && wrong === null,
        toolDataTakes: called && refused === null,
        detail: error ? `ERROR ${error.slice(0, 300)}` : !call ? "no tool call" : !called ? `called ${call.name}` : wrong ?? refused ?? JSON.stringify(call.args),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        usd,
        ms: Date.now() - started,
      };
      outcomes.push(outcome);
      const verdict = outcome.accepted && outcome.called && outcome.valuesRight && outcome.toolDataTakes ? "PASS" : "FAIL";
      console.log(`${verdict}  ${p.name}/${step.id} · ${outcome.detail.slice(0, 160)} · ${usage.inputTokens}+${usage.outputTokens} tokens · ${outcome.ms} ms · spent $${spent.toFixed(4)}`);
    }
  }

  const passed = outcomes.every((o) => o.accepted && o.called && o.valuesRight && o.toolDataTakes) && outcomes.length === calls;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${runId}.json`), JSON.stringify({ runId, cap, spent, outcomes }, null, 2));
  console.log(`\n${passed ? "ALL PASS" : "NOT ALL PASS"} · spent $${spent.toFixed(4)} at list price · cap $${cap.toFixed(2)} · ${path.join(DIR, `${runId}.json`)}`);
  return passed ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
