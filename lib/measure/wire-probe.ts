// THE WIRE PROBE: two facts about Len's providers that two cache fixes depend on and no document gives.
//
// (1) A `system` message in the MIDDLE of a conversation. DeepSeek's harness (39163dd, note
//     2026-09-02-in-history-system-prompt-replacement) changes the system prompt without losing the provider's
//     cache by appending the whole new prompt as a later `system` message, on a model fact of its own API: the
//     model «accepts a system message at any position and treats the latest one as the complete effective
//     system prompt». Len's plan mode rewrites message 0 instead, and pays the whole conversation again on
//     entering and on leaving. Whether DeepInfra and Fireworks take that message, leave it where it is (what
//     comes before it still read from the cache) and whether the model follows it is what this asks — also
//     right after a tool result, where approving a plan mid-turn would put it.
// (2) Images. Screenshots are dropped from the conversation past three because «Fireworks does not cache
//     them» (lib/agent/screenshots-in-context.ts); Claude Code and DeepSeek keep them. Whether the images of a
//     request are part of what each provider caches is the second question.
//
// Seven short calls per provider, every request known in advance (the assistant messages are written here,
// not the model's), so each step that reads the cache sends, byte for byte, the earlier step plus something.
// Pure: the steps, the worst case and the verdicts. The runner is scripts/measure/wire-probe.ts.
import type { InlineImage, Message } from "@/lib/ai-gateway";

export type WireProvider = "deepinfra" | "fireworks";
export type WireStepId =
  | "base"
  | "control"
  | "system_in_history"
  | "tools_base"
  | "system_after_tool"
  | "images_base"
  | "images_again"
  // The position steps (`wirePositionSteps`).
  | "long_base"
  | "long_control"
  | "long_system";

export const WIRE_PROBE_CAP_USD_DEFAULT = 0.08;
export const WIRE_PROBE_MAX_OUTPUT_TOKENS = 48;
/** Words of the made-up notes in the system prompt: about 6.000 tokens, well over any provider's minimum to cache. */
export const WIRE_PROBE_PREFIX_WORDS = 5_000;
/** What a step waits before reading what the step before it left in the cache. */
export const WIRE_PROBE_SETTLE_MS = 8_000;
/** List prices, USD per million tokens (lib/ai/tarifas.ts; DeepInfra's without its promotion). */
export const WIRE_PROBE_PRICES: Readonly<Record<WireProvider, { input: number; cached: number; output: number }>> = {
  deepinfra: { input: 0.2, cached: 0.006, output: 0.6 },
  fireworks: { input: 0.3, cached: 0.006, output: 1.2 },
};
/** For the worst case: an image counted at this many tokens, a token at three characters, nothing cached. */
const WORST_IMAGE_TOKENS = 2_048;
const WORST_CHARS_PER_TOKEN = 3;
/** From what share of the prefix read from the cache it counts as read. */
const READ_SHARE = 0.8;

export interface WireStep {
  readonly id: WireStepId;
  readonly messages: Message[];
  /** Len's own declaration shape; the runner passes it through `toolsForFireworks`. */
  readonly tools?: readonly Record<string, unknown>[];
  /** The earlier step whose request is this one's prefix. */
  readonly reads?: WireStepId;
}

export interface WireCall {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly text: string;
  readonly toolCalls: number;
  readonly ms: number;
  readonly error?: string;
}

const WORDS = "river stone garden window paper silver quiet morning ladder basket copper winter candle harbor meadow thread pocket lantern marble orchard feather bridge kettle saddle timber velvet anchor barrel cotton ribbon mirror pepper walnut blanket compass drawer engine fabric gravel hammer island jacket kernel ledger magnet napkin pebble quarry rudder shovel tunnel valley wagon yarn".split(" ");

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function notes(runId: string, words: number): string {
  let state = seedOf(runId) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  return Array.from({ length: words }, () => WORDS[next() % WORDS.length]!).join(" ");
}

const systemPrompt = (runId: string, word: string): string =>
  `Test session ${seedOf(runId).toString(36)}-${runId}. You are a careful assistant.\nRULE: end every answer with the word ${word}.\n\nReference notes, to ignore unless asked about:\n${notes(runId, WIRE_PROBE_PREFIX_WORDS)}\n\nRemember the rule: end every answer with the word ${word}.`;

const NOTE_TOOL: Record<string, unknown> = {
  name: "note",
  description: "Saves a short note.",
  parameters: { type: "object", properties: { text: { type: "string", description: "The note." } }, required: ["text"] },
};

/** The seven requests of a run. `images`: two small pictures, different from each other. */
export function wireProbeSteps(runId: string, images: readonly [InlineImage, InlineImage]): WireStep[] {
  const first: Message = { role: "system", content: systemPrompt(runId, "ALFA") };
  const second: Message = { role: "system", content: systemPrompt(runId, "BETA") };
  const hello: Message = { role: "user", content: "Say hello in three words." };
  const helloAnswer: Message = { role: "assistant", content: "Hello to you. ALFA" };
  const bye: Message = { role: "user", content: "Say goodbye in three words." };
  const byeAnswer: Message = { role: "assistant", content: "See you soon. ALFA" };
  const thanks: Message = { role: "user", content: "Say thanks in three words." };
  const saveIt: Message = { role: "user", content: "Save the note «hello» with the tool. After that, say hello in three words." };
  const called: Message = { role: "assistant", content: "", functionCalls: [{ name: "note", args: { text: "hello" } }] };
  const result: Message = { role: "user", content: "", functionResponses: [{ name: "note", response: { ok: true, tool_result: "Saved." } }] };
  const helloWithPictures: Message = { ...hello, images: [...images] };
  return [
    { id: "base", messages: [first, hello] },
    { id: "control", messages: [first, hello, helloAnswer, bye], reads: "base" },
    { id: "system_in_history", messages: [first, hello, helloAnswer, bye, byeAnswer, second, thanks], reads: "control" },
    { id: "tools_base", messages: [first, saveIt], tools: [NOTE_TOOL] },
    { id: "system_after_tool", messages: [first, saveIt, called, result, second], tools: [NOTE_TOOL], reads: "tools_base" },
    { id: "images_base", messages: [first, helloWithPictures] },
    { id: "images_again", messages: [first, helloWithPictures, helloAnswer, bye], reads: "images_base" },
  ];
}

// ── THE POSITION STEPS ──────────────────────────────────────────────────────────────────────────────────
// The first run (20261114T085329) showed both providers take the second system message and the model follow
// it, but not WHERE it ends up: only ~30 tokens of conversation sat between the two prompts, under the cache's
// granularity (128 tokens on DeepInfra), and the first prompt was 5.000 — «left in place» and «moved up behind
// the first prompt» read the same. Here the prompt is two lines and the conversation between them is long: in
// place, nearly the whole earlier request is read from the cache; moved up, almost nothing is.
export const WIRE_POSITION_CAP_USD_DEFAULT = 0.03;
/** Longer than the first run's wait: there Fireworks had nothing cached nine seconds after a request. */
export const WIRE_POSITION_SETTLE_MS = 20_000;
const POSITION_PARTS = 6;
const POSITION_WORDS_PER_PART = 700;

const shortPrompt = (runId: string, word: string): string => `Test session ${seedOf(runId).toString(36)}-${runId}. You are a careful assistant.\nRULE: end every answer with the word ${word}.`;

export function wirePositionSteps(runId: string): WireStep[] {
  const first: Message = { role: "system", content: shortPrompt(runId, "ALFA") };
  const second: Message = { role: "system", content: shortPrompt(runId, "BETA") };
  const talk: Message[] = [];
  for (let k = 0; k < POSITION_PARTS; k++) {
    talk.push({ role: "user", content: `Notes to keep for later, part ${k + 1} of ${POSITION_PARTS}:\n${notes(`${runId}/${k}`, POSITION_WORDS_PER_PART)}\n\nAnswer only: noted.` });
    talk.push({ role: "assistant", content: "Noted. ALFA" });
  }
  const hello: Message = { role: "user", content: "Say hello in three words." };
  const helloAnswer: Message = { role: "assistant", content: "Hello to you. ALFA" };
  const thanks: Message = { role: "user", content: "Say thanks in three words." };
  const base = [first, ...talk, hello];
  return [
    { id: "long_base", messages: base },
    // The same request again: by then, does the provider have it?
    { id: "long_control", messages: [...base], reads: "long_base" },
    { id: "long_system", messages: [...base, helloAnswer, second, thanks], reads: "long_base" },
  ];
}

export interface WirePositionReport {
  readonly provider: WireProvider;
  /** The same request, sent again, was read from the cache. */
  readonly control: boolean | null;
  readonly accepted: boolean;
  /** The conversation before the second prompt was read from the cache. `null`: cannot be told. */
  readonly inPlace: boolean | null;
  readonly followsLatest: boolean | null;
  readonly spentUsd: number;
  readonly lines: string[];
}

export function wirePositionReport(provider: WireProvider, calls: Partial<Record<WireStepId, WireCall>>): WirePositionReport {
  const { long_base: base, long_control: again, long_system: system } = calls;
  const control = ok(base) && ok(again) ? share(again, base) >= READ_SHARE : null;
  const accepted = ok(system);
  const read = accepted && ok(base) ? share(system, base) : null;
  // A high reading stands on its own; a low one only means «moved» if the cache was there to be read.
  const inPlace = read === null ? null : read >= READ_SHARE ? true : control === true ? false : null;
  const answer = accepted ? system.text.trim() : "";
  const followsLatest = !accepted || answer.length === 0 ? null : /\bBETA\b\W*$/i.test(answer);
  const spentUsd = [base, again, system].reduce((sum, call) => sum + (call ? wireProbeCostUsd(provider, call) : 0), 0);
  const lines = [
    `${provider} · spent $${spentUsd.toFixed(4)} at list price`,
    control === null ? "  control: not run or refused" : `  control: the same request again was ${control ? "" : "NOT "}read from the cache (${pct(share(again!, base!))})`,
    !system
      ? "  system message after a long conversation: not run"
      : system.error
        ? `  system message after a long conversation: REFUSED — ${system.error}`
        : `  system message after a long conversation: accepted · ${inPlace === null ? "position not known" : inPlace ? "left in place" : "NOT left in place"} (${read === null ? "?" : pct(read)} of the earlier request read from the cache: ${system.cachedTokens} of ${base?.inputTokens ?? "?"} tokens) · ${followsLatest === null ? "no answer to judge" : followsLatest ? "follows the latest prompt" : "does NOT follow the latest prompt"} — «${answer.slice(0, 60)}»`,
  ];
  return { provider, control, accepted, inPlace, followsLatest, spentUsd, lines };
}

/** What a step can cost at most: its whole request at the dearest input price, nothing cached. */
function worstStepUsd(step: WireStep): number {
  const chars = step.messages.reduce((n, m) => n + m.content.length + JSON.stringify(m.functionCalls ?? "").length + JSON.stringify(m.functionResponses ?? "").length, 0) + JSON.stringify(step.tools ?? "").length;
  const pictures = step.messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
  const input = Math.max(...Object.values(WIRE_PROBE_PRICES).map((p) => p.input));
  const output = Math.max(...Object.values(WIRE_PROBE_PRICES).map((p) => p.output));
  return ((chars / WORST_CHARS_PER_TOKEN + pictures * WORST_IMAGE_TOKENS) * input + WIRE_PROBE_MAX_OUTPUT_TOKENS * output) / 1e6;
}

/** The worst case of the given steps on ONE provider. */
export function wireProbeWorstCaseUsd(steps: readonly WireStep[]): number {
  return steps.reduce((sum, step) => sum + worstStepUsd(step), 0);
}

/** What a call cost at its provider's list price. */
export function wireProbeCostUsd(provider: WireProvider, call: WireCall): number {
  const price = WIRE_PROBE_PRICES[provider];
  const cached = Math.min(call.cachedTokens, call.inputTokens);
  return ((call.inputTokens - cached) * price.input + cached * price.cached + call.outputTokens * price.output) / 1e6;
}

export interface WireRow {
  /** The provider answered the request instead of refusing it. */
  readonly accepted: boolean;
  /** What came before the new system message was still read from the cache. `null`: cannot be told. */
  readonly inPlace: boolean | null;
  /** The answer ends with the word of the LATEST prompt. `null`: there was no answer to judge. */
  readonly followsLatest: boolean | null;
}

export interface WireReport {
  readonly provider: WireProvider;
  /** The plain continuation was read from the cache: without it, nothing is said about position. */
  readonly control: boolean | null;
  readonly systemInHistory: WireRow;
  readonly systemAfterTool: WireRow;
  readonly images: { readonly cached: boolean | null; readonly tokensEach: number | null };
  /** A system message mid-conversation can be used for plan mode on this provider. `null`: not known. */
  readonly usable: boolean | null;
  readonly spentUsd: number;
  readonly lines: string[];
}

const ok = (call: WireCall | undefined): call is WireCall => call !== undefined && !call.error;
const share = (call: WireCall, prefix: WireCall): number => (prefix.inputTokens > 0 ? Math.min(1, call.cachedTokens / prefix.inputTokens) : 0);
const pct = (x: number): string => `${Math.round(x * 100)} %`;

export function wireProbeReport(provider: WireProvider, calls: Partial<Record<WireStepId, WireCall>>): WireReport {
  const { base, control: controlCall } = calls;
  const control = ok(base) && ok(controlCall) ? share(controlCall, base) >= READ_SHARE : null;

  const row = (id: WireStepId, prefixId: WireStepId): WireRow => {
    const call = calls[id];
    const prefix = calls[prefixId];
    if (!ok(call)) return { accepted: false, inPlace: null, followsLatest: null };
    const inPlace = control === true && ok(prefix) ? share(call, prefix) >= READ_SHARE : null;
    const answer = call.text.trim();
    const followsLatest = answer.length === 0 ? null : /\bBETA\b\W*$/i.test(answer);
    return { accepted: true, inPlace, followsLatest };
  };
  const systemInHistory = row("system_in_history", "control");
  const systemAfterTool = row("system_after_tool", "tools_base");

  const { images_base: picturesBase, images_again: picturesAgain } = calls;
  const pictureTokens = ok(base) && ok(picturesBase) ? picturesBase.inputTokens - base.inputTokens : null;
  const images = {
    tokensEach: pictureTokens !== null && pictureTokens > 0 ? Math.round(pictureTokens / 2) : null,
    // Cached = more of the request was read from the cache than its text alone, by at least half the pictures.
    cached: control === true && ok(base) && ok(picturesAgain) && pictureTokens !== null && pictureTokens > 0 ? picturesAgain.cachedTokens - base.inputTokens >= pictureTokens / 2 : null,
  };

  const facts = [systemInHistory, systemAfterTool].flatMap((r) => [r.accepted, r.inPlace, r.followsLatest]);
  const usable = facts.includes(false) ? false : facts.includes(null) ? null : true;
  const spentUsd = Object.values(calls).reduce((sum, call) => sum + (call ? wireProbeCostUsd(provider, call) : 0), 0);

  const say = (v: boolean | null, yes: string, no: string): string => (v === null ? "not known" : v ? yes : no);
  const rowLine = (label: string, id: WireStepId, prefixId: WireStepId, r: WireRow): string => {
    const call = calls[id];
    if (!call) return `  ${label}: not run`;
    if (call.error) return `  ${label}: REFUSED — ${call.error}`;
    const prefix = calls[prefixId];
    const read = ok(prefix) ? ` (${pct(share(call, prefix))} of what came before read from the cache)` : "";
    const answer = call.text.trim() ? `«${call.text.trim().slice(0, 60)}»` : call.toolCalls > 0 ? "a tool call, no words" : "no answer";
    return `  ${label}: accepted · ${say(r.inPlace, "left in place", "NOT left in place")}${read} · ${say(r.followsLatest, "follows the latest prompt", "does NOT follow the latest prompt")} — ${answer}`;
  };
  const lines = [
    `${provider} · spent $${spentUsd.toFixed(4)} at list price`,
    control === null
      ? "  control: not run or refused"
      : control
        ? `  control: the plain continuation was read from the cache (${pct(share(controlCall!, base!))})`
        : `  control: the plain continuation was not read from the cache (${pct(share(controlCall!, base!))}): nothing can be said about position`,
    rowLine("system message mid-conversation", "system_in_history", "control", systemInHistory),
    rowLine("system message after a tool result", "system_after_tool", "tools_base", systemAfterTool),
    `  images: ${images.tokensEach === null ? "their size is not known" : `about ${images.tokensEach} tokens each`} · ${say(images.cached, "part of what the provider caches", "NOT cached")}`,
    `  a system message mid-conversation for plan mode: ${say(usable, "usable", "NOT usable")}`,
  ];
  return { provider, control, systemInHistory, systemAfterTool, images, usable, spentUsd, lines };
}
