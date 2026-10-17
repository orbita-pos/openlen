/**
 * DEEPINFRA STREAMING PROBE (spec local docs/superpowers/specs/2026-10-16-second-provider-design.md,
 * plan task 3).
 *
 * Before Len's turns go to DeepInfra, this checks — against the real endpoint
 * and through the real client (`createFireworksStreamClient` with DeepInfra's
 * dialect) — the things the turn depends on: reasoning arrives as deltas, a
 * tool call arrives assembled, `usage` carries the provider's cached-token
 * count, the second call of a conversation hits the cache, and nothing Len
 * sends (an image, 32,768 output tokens, the effort number) is rejected.
 *
 * Three calls, at Len's temperature and output ceiling (`lib/agent/brain.ts`):
 *   1. Len's tools + a small PNG, asking for a tool call;
 *   2. the same conversation with the tool result and the returned reasoning;
 *   3. a short question at effort `low` (DeepInfra takes the WORD: a number
 *      gets a 422 — the first run of this probe found it).
 *
 * It costs cents. Without `--yes` it only prints what it would do. Hard cap:
 * $0.05 — a call is aborted mid-stream if the estimate would cross it.
 *
 *   npm run provider:probe -- --yes
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Message } from "@/lib/ai-gateway";
import { buildFunctionDeclarations } from "@/lib/agent/catalog";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { tokenCostMicroUsd } from "@/lib/ai/cost-rates";
import {
  createFireworksStreamClient,
  type FireworksStreamEvent,
  type FireworksStreamRequest,
} from "@/lib/ai/fireworks-stream-client";
import { resolveAgentProviders } from "@/lib/ai/providers";
import type { EsfuerzoAgente } from "@/lib/agent/esfuerzo";

const CAP_MICRO_USD = 50_000; // $0.05
const TEMPERATURE = 0.2; // brain.ts TEMPERATURE
const MAX_OUTPUT_TOKENS = 32_768; // brain.ts LOOP_MAX_OUTPUT_TOKENS
// Characters per token, on the LOW side so the estimate over-counts.
const CHARS_PER_TOKEN = 3;
const IMAGE_FILE = path.join(process.cwd(), "public", "icon-192.png");
const PAGE = '<!doctype html><html lang="es"><body><h1>Taquería El Sol</h1><p>Tacos al pastor desde 1998.</p></body></html>';
const SYSTEM =
  "You are Len, a web developer working on the user's page. The page lives in /index.html. Use your tools; be brief.";

interface SentRequest {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface CallResult {
  readonly label: string;
  readonly reasoning: string;
  readonly text: string;
  readonly calls: { name: string; args: Record<string, unknown> }[];
  readonly usage: Extract<FireworksStreamEvent, { type: "usage" }> | null;
  readonly reasoningDeltas: number;
  readonly stop: Extract<FireworksStreamEvent, { type: "done" }>["stopReason"] | null;
  readonly sent: SentRequest[];
  readonly costMicroUsd: number;
  readonly ms: number;
}

const checks: { ok: boolean; line: string }[] = [];
function check(ok: boolean, line: string): void {
  checks.push({ ok, line });
  console.log(`${ok ? "PASS" : "FAIL"}  ${line}`);
}

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  const [provider] = resolveAgentProviders(process.env, ["deepinfra"]);
  // `resolveAgentProviders` honors OPENLEN_AGENT_PROVIDERS; the probe tests
  // DeepInfra whatever the switch says, so it resolves it on its own if needed.
  const deepinfra =
    provider ?? resolveAgentProviders({ ...process.env, OPENLEN_AGENT_PROVIDERS: "deepinfra" }, ["deepinfra"])[0];
  if (!deepinfra) {
    console.error("No DEEPINFRA_API_KEY in the environment: nothing to probe.");
    process.exitCode = 1;
    return;
  }

  const declarations = buildFunctionDeclarations(process.env, {}, "len", null);
  const wireTools = toolsForFireworks(declarations);
  const image = { mimeType: "image/png", dataBase64: readFileSync(IMAGE_FILE).toString("base64") };
  const readTool = declarations.find((d) => d.name === "Read") ? "Read" : String(declarations[0]?.name);

  console.log(`provider  ${deepinfra.id} · ${deepinfra.dialect.endpoint}`);
  console.log(`model     ${deepinfra.modelId}`);
  console.log(`tools     ${wireTools.length} (Len's catalog, page mode) · image ${path.basename(IMAGE_FILE)} ${image.dataBase64.length} b64 chars`);
  console.log(`calls     1) tools + image → ${readTool}  2) + tool result and reasoning  3) effort low`);
  console.log(`cap       $${(CAP_MICRO_USD / 1e6).toFixed(2)}`);
  if (!yes) {
    console.log("\nDry run. Add --yes to send the three calls (cents).");
    return;
  }

  let spentMicroUsd = 0;
  const sent: SentRequest[] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    } catch {
      // A body that isn't JSON is recorded empty; the status still counts.
    }
    sent.push({ status: response.status, body });
    return response;
  };
  const client = createFireworksStreamClient({
    apiKey: deepinfra.apiKey,
    endpoint: deepinfra.dialect.endpoint,
    modelId: deepinfra.modelId,
    affinityField: deepinfra.dialect.affinityField,
    effortStyle: deepinfra.dialect.effortStyle,
    fetchImpl: recordingFetch,
  });
  const requestId = `provider-probe-${Date.now()}`;

  const costOf = (inputTokens: number, cachedTokens: number, outputTokens: number): number =>
    tokenCostMicroUsd({
      provider: "deepinfra",
      model: deepinfra.modelId,
      inputTokens,
      cachedTokens,
      outputTokens,
      at: new Date(),
    }) ?? Number.POSITIVE_INFINITY;

  async function run(label: string, messages: Message[], esfuerzo: EsfuerzoAgente): Promise<CallResult> {
    const wireMessages = messagesForFireworks(messages);
    const request: FireworksStreamRequest = {
      messages: wireMessages,
      tools: wireTools,
      streamToolArgs: true,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      requestId,
      operation: "agent_turn",
      esfuerzo,
    };
    // Uncached input, on purpose: the estimate is the ceiling, not the bill.
    const inputEstimate = Math.ceil(JSON.stringify({ wireMessages, wireTools }).length / CHARS_PER_TOKEN);
    const abort = new AbortController();
    const firstSent = sent.length;
    const started = Date.now();
    let streamedChars = 0;
    let reasoning = "";
    let text = "";
    let reasoningDeltas = 0;
    let usage: CallResult["usage"] = null;
    let stop: CallResult["stop"] = null;
    const calls: CallResult["calls"] = [];

    for await (const event of client.stream(request, { signal: abort.signal })) {
      if (event.type === "reasoning_delta") {
        reasoningDeltas += 1;
        reasoning += event.text;
        streamedChars += event.text.length;
      } else if (event.type === "text_delta") {
        text += event.text;
        streamedChars += event.text.length;
      } else if (event.type === "function_call_delta") {
        streamedChars += event.argsDelta.length;
      } else if (event.type === "function_call") {
        calls.push({ name: event.name, args: event.args });
      } else if (event.type === "usage") {
        usage = event;
      } else if (event.type === "done") {
        stop = event.stopReason;
      }
      const estimate = costOf(inputEstimate, 0, Math.ceil(streamedChars / CHARS_PER_TOKEN));
      if (spentMicroUsd + estimate > CAP_MICRO_USD && !abort.signal.aborted) {
        console.log(`  (${label}: aborted — the estimate would cross the $0.05 cap)`);
        abort.abort();
      }
    }

    const costMicroUsd = usage
      ? costOf(usage.inputTokens, usage.cachedTokens, usage.outputTokens)
      : costOf(inputEstimate, 0, Math.ceil(streamedChars / CHARS_PER_TOKEN));
    spentMicroUsd += costMicroUsd;
    const result: CallResult = {
      label,
      reasoning,
      text,
      calls,
      usage,
      reasoningDeltas,
      stop,
      sent: sent.slice(firstSent),
      costMicroUsd,
      ms: Date.now() - started,
    };
    const u = usage ? `in ${usage.inputTokens} · cached ${usage.cachedTokens} · out ${usage.outputTokens}` : "no usage";
    console.log(
      `  ${label}: ${result.ms} ms · ${u} · $${(costMicroUsd / 1e6).toFixed(4)} · stop ${stop ? stop.kind : "none"}` +
        `${stop?.kind === "error" ? ` (${JSON.stringify(stop)})` : ""} · HTTP ${result.sent.map((s) => s.status).join(",") || "none"}`,
    );
    return result;
  }

  // 1 — tools + image, asking for a tool call.
  const first: Message[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `The attached image is the logo. Before anything else, call the ${readTool} tool on /index.html. Do not answer in text first.`,
      images: [image],
    },
  ];
  const one = await run("call 1", first, "auto");

  // 2 — the same conversation, with the tool result and the reasoning back.
  const call = one.calls[0];
  const second: Message[] = [
    ...first,
    { role: "assistant", content: one.text, functionCalls: call ? [call] : [], reasoning: one.reasoning || undefined },
    { role: "user", content: "", functionResponses: call ? [{ name: call.name, response: { content: PAGE } }] : [] },
  ];
  const two = call ? await run("call 2", second, "auto") : null;

  // 3 — effort low.
  const three =
    spentMicroUsd < CAP_MICRO_USD
      ? await run("call 3", [{ role: "system", content: SYSTEM }, { role: "user", content: "Reply with one word: hola." }], "low")
      : null;

  console.log("");
  const all = [one, two, three].filter((r): r is CallResult => r !== null);
  check(all.some((r) => r.reasoningDeltas > 0), `reasoning arrives as reasoning_delta (${all.map((r) => r.reasoningDeltas).join("/")} deltas)`);
  check(
    !!call && typeof call.args === "object" && Object.keys(call.args).length > 0,
    `an assembled function_call arrives (${call ? `${call.name} ${JSON.stringify(call.args)}` : "none"})`,
  );
  check(
    all.length === 3 && all.every((r) => r.usage !== null && Number.isFinite(r.usage.cachedTokens)),
    `every call ends with a usage event carrying cachedTokens (${all.map((r) => r.usage?.cachedTokens ?? "—").join("/")})`,
  );
  check((two?.usage?.cachedTokens ?? 0) > 0, `the second call hits the cache (${two?.usage?.cachedTokens ?? 0} of ${two?.usage?.inputTokens ?? 0})`);
  const statuses = all.flatMap((r) => r.sent.map((s) => s.status));
  check(
    statuses.length === all.length && statuses.every((s) => s === 200),
    `no 4xx and no silent re-send: one 200 per call (HTTP ${statuses.join(",")})`,
  );
  const firstBody = one.sent[0]?.body ?? {};
  check(
    JSON.stringify(firstBody.messages ?? []).includes("data:image/png;base64,") && one.sent[0]?.status === 200,
    "the image is sent and accepted",
  );
  check(firstBody.max_tokens === MAX_OUTPUT_TOKENS && one.sent[0]?.status === 200, `max_tokens ${MAX_OUTPUT_TOKENS} accepted`);
  check(
    typeof firstBody.prompt_cache_key === "string" && !("user" in firstBody),
    `affinity rides on prompt_cache_key, not user (${String(firstBody.prompt_cache_key)})`,
  );
  const lowBody = three?.sent[0]?.body ?? {};
  const expectedLow = deepinfra.dialect.effortStyle === "word" ? "low" : 25;
  check(
    lowBody.reasoning_effort === expectedLow && three?.sent[0]?.status === 200,
    `effort low sends reasoning_effort ${JSON.stringify(expectedLow)} and is accepted (sent ${JSON.stringify(lowBody.reasoning_effort)})`,
  );
  check(
    all.every((r) => r.stop !== null && r.stop.kind !== "error"),
    `no call ends in error (${all.map((r) => r.stop?.kind ?? "none").join("/")})`,
  );

  console.log(`\nspent ≈ $${(spentMicroUsd / 1e6).toFixed(4)} · ${checks.filter((c) => c.ok).length}/${checks.length} PASS`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
