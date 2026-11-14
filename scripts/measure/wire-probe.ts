/**
 * THE WIRE PROBE's runner (what it asks and every number live in lib/measure/wire-probe.ts).
 *
 * ⚠️ It spends real money on Len's providers — the accounts production uses. Without `--yes` it only prints
 * the plan and its worst case. With it: seven short calls per provider through the real client and the real
 * bridge (`messagesForFireworks`, `toolsForFireworks`), a hard cap asked before EVERY call, and the state
 * saved after every call:
 *
 *   npm run measure:wire-probe                                        → the plan, nothing sent
 *   npm run measure:wire-probe -- --yes --budget-usd=0.08              → both providers
 *   npm run measure:wire-probe -- --yes --provider=deepinfra           → one of them
 *   npm run measure:wire-probe -- --only=position --yes --budget-usd=0.03 → the position steps alone (three calls per provider)
 *
 * The state and the report go to plans/conversar-todo-el-mes/wire-probe/ (local, never in the repo).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { InlineImage } from "@/lib/ai-gateway";
import { messagesForFireworks, toolsForFireworks } from "@/lib/agent/fireworks-bridge";
import { createFireworksStreamClient, type FireworksStreamRequest } from "@/lib/ai/fireworks-stream-client";
import { resolveAgentProviders } from "@/lib/ai/providers";
import {
  WIRE_POSITION_CAP_USD_DEFAULT,
  WIRE_POSITION_SETTLE_MS,
  WIRE_PROBE_CAP_USD_DEFAULT,
  WIRE_PROBE_MAX_OUTPUT_TOKENS,
  WIRE_PROBE_SETTLE_MS,
  wirePositionReport,
  wirePositionSteps,
  wireProbeCostUsd,
  wireProbeReport,
  wireProbeSteps,
  wireProbeWorstCaseUsd,
  type WireCall,
  type WireProvider,
  type WireStep,
  type WireStepId,
} from "@/lib/measure/wire-probe";

const DIR = path.join("plans", "conversar-todo-el-mes", "wire-probe");
const CALL_TIMEOUT_MS = 120_000;
const PROVIDERS: readonly WireProvider[] = ["deepinfra", "fireworks"];

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return found?.includes("=") ? found.slice(found.indexOf("=") + 1) : found ? "" : undefined;
}

// A PNG of coloured squares, written here so the probe needs no image library: 256×256, a few kilobytes.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
function squares(seed: number): InlineImage {
  const size = 256;
  const cell = 32;
  let state = seed >>> 0 || 1;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const colours = Array.from({ length: (size / cell) ** 2 }, () => [next() & 0xff, (next() >>> 8) & 0xff, (next() >>> 16) & 0xff] as const);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      const [r, g, b] = colours[Math.floor(y / cell) * (size / cell) + Math.floor(x / cell)]!;
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { mimeType: "image/png", dataBase64: png.toString("base64") };
}

type Calls = Partial<Record<WireStepId, WireCall>>;
interface State {
  readonly v: 1;
  readonly runId: string;
  readonly models: Partial<Record<WireProvider, string>>;
  readonly calls: Partial<Record<WireProvider, Calls>>;
}

async function main(): Promise<number> {
  const asked = arg("--provider") ?? "both";
  const names = asked === "both" ? PROVIDERS : PROVIDERS.filter((p) => p === asked);
  if (names.length === 0) throw new Error("--provider must be deepinfra, fireworks or both");
  const only = arg("--only");
  if (only !== undefined && only !== "position") throw new Error("--only takes one value: position");
  const position = only === "position";
  const cap = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : position ? WIRE_POSITION_CAP_USD_DEFAULT : WIRE_PROBE_CAP_USD_DEFAULT;
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--budget-usd must be a number above zero");

  const providers = names.flatMap((name) => {
    const [resolved] = resolveAgentProviders({ ...process.env, OPENLEN_AGENT_PROVIDERS: name }, [name]);
    if (!resolved) console.log(`provider  ${name}: no key in the environment, left out`);
    return resolved ? [{ name, resolved }] : [];
  });
  if (providers.length === 0) throw new Error("no provider key in the environment: nothing to probe");

  const runId = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}${position ? "-position" : ""}`;
  const steps = position ? wirePositionSteps(runId) : wireProbeSteps(runId, [squares(11), squares(29)]);
  const settleMs = position ? WIRE_POSITION_SETTLE_MS : WIRE_PROBE_SETTLE_MS;
  const worstEach = wireProbeWorstCaseUsd(steps);
  for (const p of providers) console.log(`provider  ${p.name} · ${p.resolved.dialect.endpoint} · ${p.resolved.modelId}`);
  console.log(`probe     ${runId} · ${steps.length} calls per provider: ${steps.map((s) => s.id).join(", ")}`);
  console.log(`worst     $${(worstEach * providers.length).toFixed(4)} (every request at the dearest input price, nothing cached) · cap $${cap.toFixed(2)}`);
  if (worstEach * providers.length > cap) throw new Error(`REFUSED: the worst case does not fit under --budget-usd=${cap.toFixed(2)}`);
  if (arg("--yes") === undefined) {
    console.log("\nDry run: nothing was sent. It spends real money on the accounts production uses; add --yes to run it.");
    return 0;
  }

  const state: State = { v: 1, runId, models: {}, calls: {} };
  const file = path.join(DIR, `${runId}.json`);
  const save = () => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  };
  const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);
  const spent = () => providers.reduce((sum, p) => sum + Object.values(state.calls[p.name] ?? {}).reduce((s, c) => s + (c ? wireProbeCostUsd(p.name, c) : 0), 0), 0);

  let stopped = false;
  for (const [index, p] of providers.entries()) {
    const client = createFireworksStreamClient({
      apiKey: p.resolved.apiKey,
      endpoint: p.resolved.dialect.endpoint,
      modelId: p.resolved.modelId,
      affinityField: p.resolved.dialect.affinityField,
      effortStyle: p.resolved.dialect.effortStyle,
    });
    state.models[p.name] = p.resolved.modelId;
    const calls: Calls = (state.calls[p.name] = {});

    const send = async (step: WireStep): Promise<WireCall> => {
      const started = Date.now();
      const request: FireworksStreamRequest = {
        messages: messagesForFireworks(step.messages),
        ...(step.tools ? { tools: toolsForFireworks(step.tools), toolChoice: "auto" as const } : {}),
        maxOutputTokens: WIRE_PROBE_MAX_OUTPUT_TOKENS,
        temperature: 0,
        // One cache key for the whole run on this provider, in the field a turn's project id travels in.
        requestId: `wire-probe-${runId}`,
        operation: "agent_turn",
        // No thinking: the answers are three words.
        esfuerzo: null,
      };
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
      let usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
      let text = "";
      let toolCalls = 0;
      let error: string | undefined;
      try {
        for await (const event of client.stream(request, { signal: abort.signal })) {
          if (event.type === "usage") usage = { inputTokens: event.inputTokens, cachedTokens: Math.min(event.cachedTokens, event.inputTokens), outputTokens: event.outputTokens };
          else if (event.type === "text_delta") text += event.text;
          else if (event.type === "function_call") toolCalls += 1;
          else if (event.type === "done" && event.stopReason.kind === "error") error = [event.stopReason.httpStatus, event.stopReason.code, event.stopReason.error].filter((x) => x !== undefined && x !== "").join(" ");
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(timer);
      }
      return { ...usage, text, toolCalls, ms: Date.now() - started, ...(error ? { error: error.slice(0, 400) } : {}) };
    };

    for (const [i, step] of steps.entries()) {
      // What is still to come can cost, at most: the rest of this provider's steps and all of the later ones'.
      const ahead = wireProbeWorstCaseUsd(steps.slice(i)) + worstEach * (providers.length - index - 1);
      if (spent() + ahead > cap) {
        log(`STOPPED before ${p.name}/${step.id}: $${spent().toFixed(4)} spent and up to $${ahead.toFixed(4)} to come do not fit under $${cap.toFixed(2)}`);
        stopped = true;
        break;
      }
      if (step.reads) await new Promise((resolve) => setTimeout(resolve, settleMs));
      const call = await send(step);
      calls[step.id] = call;
      save();
      log(`${p.name}/${step.id} · ${call.error ? `ERROR ${call.error}` : `${call.inputTokens} tokens, ${call.cachedTokens} cached · ${call.toolCalls ? `${call.toolCalls} tool call(s) ` : ""}«${call.text.trim().slice(0, 50)}»`} · ${call.ms} ms · spent $${spent().toFixed(4)}`);
    }
    if (stopped) break;
  }

  const reports = providers.map((p) => (position ? wirePositionReport(p.name, state.calls[p.name] ?? {}) : wireProbeReport(p.name, state.calls[p.name] ?? {})));
  const lines = [`THE WIRE PROBE · run ${runId}`, "", ...reports.flatMap((r) => [...r.lines, ""]), `Spent in all: $${spent().toFixed(4)} at list price · cap $${cap.toFixed(2)}`];
  console.log(`\n${lines.join("\n")}`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, `${runId}.report.txt`), `${lines.join("\n")}\n`);
  console.log(`\nFor plans/len-2/gastos.md:  ${new Date().toISOString().slice(0, 10)} · wire probe ${runId} · $${spent().toFixed(4)} at list price (${providers.map((p) => p.name).join(" + ")}) · cap $${cap.toFixed(2)}`);
  return stopped ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
