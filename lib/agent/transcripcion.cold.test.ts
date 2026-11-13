import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";
import { COLD_CHARS_PER_TOKEN, COLD_CLEARABLE_TOOLS, COLD_TRIM_MARK } from "./cold-return";
import { CHARS_PER_TOKEN } from "./compaction/estimate";
import type { CompactionMark } from "./compaction/mark";
import {
  CUT_OFF_TURN_MARK,
  RESULTADO_VACIADO,
  WHOLE_HISTORY,
  coldTrim,
  historialDesdeLaBase,
  leidosSembrados,
  type FilaDelHistorial,
  type TranscripcionGuardada,
} from "./transcripcion";

// THE COLD RETURN (spec local 2026-11-13-conversar-todo-el-mes, piece A): a turn that starts after the
// provider's cache expired sends the history trimmed, and every later turn must rebuild those same
// bytes from the rows — or the conversation is paid in full a second time.

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const fileText = (n: number, k: number, size: number) => `${n}-${k}:`.padEnd(size, "x");
const fileOf = (n: number, k: number) => `/src/f${n}-${k}.ts`;

/** One turn's own messages: `results` Reads of `size` characters each, then its answer, which carries the reasoning. */
function turn(n: number, o: { reasoning?: string; results?: number; size?: number } = {}): Message[] {
  const out: Message[] = [];
  for (let k = 0; k < (o.results ?? 0); k++) {
    out.push(
      { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: fileOf(n, k) } }] },
      { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: fileText(n, k, o.size ?? 100) } }] },
    );
  }
  out.push({ role: "assistant", content: `done ${n}`, ...(o.reasoning ? { reasoning: o.reasoning } : {}) });
  return out;
}

const row = (n: number, messages: Message[], extra: Partial<TranscripcionGuardada> = {}): FilaDelHistorial => ({
  userText: `ask ${n}`,
  assistantReasoning: "",
  transcript: { mensajes: messages, leidos: [], ...extra },
});

const results = (ms: readonly { functionResponses?: Message["functionResponses"] }[]) =>
  ms.flatMap((m) => m.functionResponses ?? []).map((r) => r.response.tool_result);
const emptied = (ms: Parameters<typeof results>[0]) => results(ms).filter((t) => t === RESULTADO_VACIADO).length;
const thoughts = (ms: readonly { reasoning?: string }[]) => ms.flatMap((m) => (m.reasoning ? [m.reasoning] : []));

describe("coldTrim", () => {
  it("counts tokens as the compaction does", () => {
    expect(COLD_CHARS_PER_TOKEN).toBe(CHARS_PER_TOKEN);
  });

  it("drops what was thought in every turn but the last", () => {
    const ms = [...turn(1, { reasoning: "old" }), ...turn(2, { reasoning: "last" })];
    const out = coldTrim(ms, 1, COLD_TRIM_MARK);
    expect(thoughts(out)).toEqual(["last"]);
    expect("reasoning" in out[0]!).toBe(false);
  });

  it("keeps the 12 most recent results, the last turn's included, and empties the rest", () => {
    // 30 results of 7.000 characters: 18 to clear = 126.000 characters = 36.000 tokens, over the floor.
    const out = coldTrim(turn(1, { results: 30, size: 7_000 }), 0, COLD_TRIM_MARK);
    expect(emptied(out)).toBe(18);
    expect(results(out).slice(0, 18).every((t) => t === RESULTADO_VACIADO)).toBe(true);
    expect(results(out).slice(-12)).toEqual(Array.from({ length: 12 }, (_, i) => fileText(1, 18 + i, 7_000)));
  });

  it("an emptied result keeps whether the call had worked", () => {
    const out = coldTrim(turn(1, { results: 30, size: 7_000 }), 0, COLD_TRIM_MARK);
    expect(out[1]!.functionResponses![0]).toEqual({ name: "Read", response: { ok: true, tool_result: RESULTADO_VACIADO } });
  });

  it("under 20.000 tokens to free it leaves the results alone, and still drops the old reasoning", () => {
    // 20 results of 7.000 characters: 8 to clear = 56.000 characters = 16.000 tokens, under the floor.
    const first = turn(1, { reasoning: "old", results: 20, size: 7_000 });
    const ms = [...first, ...turn(2, { reasoning: "last" })];
    const out = coldTrim(ms, first.length, COLD_TRIM_MARK);
    expect(emptied(out)).toBe(0);
    expect(thoughts(out)).toEqual(["last"]);
  });

  it("a loaded skill is never emptied and does not count among the 12", () => {
    const skill: Message[] = [
      { role: "assistant", content: "", functionCalls: [{ name: "skill", args: { name: "pdf" } }] },
      { role: "user", content: "", functionResponses: [{ name: "skill", response: { ok: true, tool_result: "S".repeat(50_000) } }] },
    ];
    const out = coldTrim([...turn(1, { results: 30, size: 7_000 }), ...skill], 0, COLD_TRIM_MARK);
    expect(results(out).at(-1)).toBe("S".repeat(50_000));
    expect(emptied(out)).toBe(18);
  });

  // Final review, finding 1: `ask_user_question` returns the OWNER'S ANSWER as its result. Only what Len can
  // ask for again is emptied, as in Claude Code (Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit, Write).
  it("what the owner answered, and every result Len cannot ask for again, is never emptied and does not count among the 12", () => {
    const asked: Message[] = [
      { role: "assistant", content: "", functionCalls: [{ name: "ask_user_question", args: { question: "phone?" } }] },
      { role: "user", content: "", functionResponses: [{ name: "ask_user_question", response: { ok: true, tool_result: "555 0100" } }] },
      { role: "assistant", content: "", functionCalls: [{ name: "subagent", args: { description: "look" } }] },
      { role: "user", content: "", functionResponses: [{ name: "subagent", response: { ok: true, tool_result: "R".repeat(30_000) } }] },
    ];
    const out = coldTrim([...asked, ...turn(1, { results: 30, size: 7_000 })], 0, COLD_TRIM_MARK);
    expect(results(out).slice(0, 2)).toEqual(["555 0100", "R".repeat(30_000)]);
    expect(emptied(out)).toBe(18);
    // 13 answers after 30 Reads: the 12 Reads kept are still the 12 most recent Reads.
    const answers = Array.from({ length: 13 }, () => asked.slice(0, 2)).flat();
    const mixed = coldTrim([...turn(1, { results: 30, size: 7_000 }).slice(0, -1), ...answers], 0, COLD_TRIM_MARK);
    expect(emptied(mixed)).toBe(18);
    expect(results(mixed).filter((t) => t === "555 0100")).toHaveLength(13);
  });

  it("the list of what may be emptied is the tools whose result can be asked for again", () => {
    expect([...COLD_CLEARABLE_TOOLS].sort()).toEqual(["Edit", "Glob", "Grep", "Read", "Write", "bash", "use_page", "view_page", "web_fetch", "web_search"]);
  });

  it("leaves call arguments, text and its input untouched; twice gives the same as once", () => {
    const ms = turn(1, { reasoning: "x", results: 30, size: 7_000 });
    const copy = structuredClone(ms);
    const once = coldTrim(ms, 0, COLD_TRIM_MARK);
    expect(ms).toEqual(copy);
    expect(coldTrim(once, 0, COLD_TRIM_MARK)).toEqual(once);
    expect(once.map((m) => m.functionCalls)).toEqual(ms.map((m) => m.functionCalls));
    expect(once.map((m) => m.content)).toEqual(ms.map((m) => m.content));
  });
});

describe("historialDesdeLaBase with a cold return", () => {
  const r0 = row(1, turn(1, { reasoning: "a", results: 30, size: 7_000 }));
  const r1 = row(2, turn(2, { reasoning: "b", results: 2, size: 500 }));

  it("this turn is cold: the old reasoning and the results before the last 12 do not travel", () => {
    const h = historialDesdeLaBase([r0, r1], undefined, undefined, COLD_TRIM_MARK);
    expect(thoughts(h)).toEqual(["b"]);
    // 32 results; the 12 kept are the last turn's 2 and the 10 before them.
    expect(emptied(h)).toBe(20);
    expect(results(h).slice(-12).includes(RESULTADO_VACIADO)).toBe(false);
  });

  it("🔴 the turn after a trim starts with the very same bytes the cold turn sent", () => {
    const sentByColdTurn = historialDesdeLaBase([r0, r1], undefined, undefined, COLD_TRIM_MARK);
    const r2 = row(3, turn(3, { reasoning: "c", results: 1, size: 500 }), { coldTrim: COLD_TRIM_MARK });
    const next = historialDesdeLaBase([r0, r1, r2]);
    expect(next.slice(0, sentByColdTurn.length)).toEqual(sentByColdTurn);
    expect(thoughts(next)).toEqual(["b", "c"]);
    // And the turn after that one, with one more warm turn behind.
    const r3 = row(4, turn(4, { reasoning: "d" }));
    expect(historialDesdeLaBase([r0, r1, r2, r3]).slice(0, next.length)).toEqual(next);
  });

  it("without a mark and without `cold`, nothing changes (control)", () => {
    const h = historialDesdeLaBase([r0, r1]);
    expect(thoughts(h)).toEqual(["a", "b"]);
    expect(emptied(h)).toBe(0);
  });

  it("two cold returns add up: what the first emptied stays emptied when the second frees too little", () => {
    const r2 = row(3, turn(3, { reasoning: "c", results: 1, size: 500 }), { coldTrim: COLD_TRIM_MARK });
    const r3 = row(4, turn(4, { reasoning: "d", results: 2, size: 500 }));
    const r4 = row(5, turn(5, { reasoning: "e" }), { coldTrim: COLD_TRIM_MARK });
    const h = historialDesdeLaBase([r0, r1, r2, r3, r4]);
    // At the second return 15 results are whole and only 3 are past the 12: 21.000 characters, under the floor.
    expect(emptied(h)).toBe(20);
    expect(thoughts(h)).toEqual(["d", "e"]);
  });

  it("a cold turn that left no transcript: the next one builds the whole history and does not throw", () => {
    const dead: FilaDelHistorial = { userText: "x", assistantReasoning: "", transcript: null, cutOff: true };
    const h = historialDesdeLaBase([r0, r1, dead]);
    expect(thoughts(h)).toEqual(["a", "b"]);
    expect(emptied(h)).toBe(0);
    expect(h.at(-1)!.content).toBe(CUT_OFF_TURN_MARK);
  });

  // Final review, finding 4: the «published» note is a row, not a turn — the last TURN keeps its reasoning.
  it("a published note after the last turn does not make that turn an old one", () => {
    const note: FilaDelHistorial = { userText: "✓ Publicada", assistantReasoning: "Tu página está en línea.", transcript: null };
    const sentByColdTurn = historialDesdeLaBase([r0, r1, note], undefined, undefined, COLD_TRIM_MARK);
    expect(thoughts(sentByColdTurn)).toEqual(["b"]);
    const r3 = row(4, turn(4, { reasoning: "d" }), { coldTrim: COLD_TRIM_MARK });
    const next = historialDesdeLaBase([r0, r1, note, r3]);
    expect(next.slice(0, sentByColdTurn.length)).toEqual(sentByColdTurn);
    expect(thoughts(next)).toEqual(["b", "d"]);
  });

  // Review Focus 5, as the plan wrote it: the enormous turn is the LAST one.
  it("an enormous last turn: its own results before the last 12 are emptied, and a file read in it stops counting as read", () => {
    const h = historialDesdeLaBase([r0], undefined, undefined, COLD_TRIM_MARK);
    expect(emptied(h)).toBe(18);
    expect(thoughts(h)).toEqual(["a"]);
    const text = (k: number) => fileText(1, k, 7_000);
    const seeded = leidosSembrados([{ ruta: fileOf(1, 0), huella: sha1(text(0)) }, { ruta: fileOf(1, 29), huella: sha1(text(29)) }], h, (p) => (p === fileOf(1, 0) ? text(0) : text(29)));
    expect(seeded.has(fileOf(1, 0))).toBe(false);
    expect(seeded.has(fileOf(1, 29))).toBe(true);
  });

  // Final review, finding 2: a reader that is not the model (Len-Bench's judge) sees what happened.
  it("WHOLE_HISTORY: a reader that is not the model gets the conversation with no mark applied", () => {
    const r2 = row(3, turn(3, { reasoning: "c" }), { coldTrim: COLD_TRIM_MARK });
    const whole = historialDesdeLaBase([r0, r1, r2], undefined, undefined, WHOLE_HISTORY);
    expect(thoughts(whole)).toEqual(["a", "b", "c"]);
    expect(emptied(whole)).toBe(0);
  });

  it("a mark that is not ours is ignored", () => {
    const junk = row(3, turn(3), { coldTrim: { v: 2 } as never });
    expect(thoughts(historialDesdeLaBase([r0, r1, junk]))).toEqual(["a", "b"]);
  });

  it("team rows: what a person said, with its envelope, comes back byte for byte", () => {
    const team: FilaDelHistorial = { ...r0, prefijoDelEquipo: "[team] Ana asked:" };
    const said = (h: ReturnType<typeof historialDesdeLaBase>) => h.filter((m) => m.role === "user" && !m.functionResponses).map((m) => m.content);
    const plain = historialDesdeLaBase([team, r1]);
    const cold = historialDesdeLaBase([team, r1], undefined, undefined, COLD_TRIM_MARK);
    expect(said(cold)).toEqual(said(plain));
    expect(said(cold)[0]).toContain("[team] Ana asked:");
  });

  it("read-state after the trim: a file whose Read was emptied no longer counts as read", () => {
    const h = historialDesdeLaBase([r0, r1], undefined, undefined, COLD_TRIM_MARK);
    const gone = fileOf(1, 0);
    const kept = fileOf(2, 0);
    const now = (path: string) => (path === gone ? fileText(1, 0, 7_000) : fileText(2, 0, 500));
    const seeded = leidosSembrados([{ ruta: gone, huella: sha1(now(gone)) }, { ruta: kept, huella: sha1(now(kept)) }], h, now);
    expect(seeded.has(gone)).toBe(false);
    expect(seeded.has(kept)).toBe(true);
  });

  it("with a compaction mark on the row, a cold mark on that same row trims nothing", () => {
    const mark: CompactionMark = {
      messages: [{ role: "user", content: "<compacted-summary>s</compacted-summary>" }, { role: "assistant", content: "kept", reasoning: "from before" }],
      fromTranscript: 0,
      trigger: "pressure",
      preTokens: 10,
      postTokens: 5,
    };
    const summarized = { ...row(3, turn(3, { reasoning: "c" })), compaction: mark };
    const both = { ...row(3, turn(3, { reasoning: "c" }), { coldTrim: COLD_TRIM_MARK }), compaction: mark };
    expect(historialDesdeLaBase([r0, r1, both])).toEqual(historialDesdeLaBase([r0, r1, summarized]));
    expect(thoughts(historialDesdeLaBase([r0, r1, both]))).toEqual(["from before", "c"]);
  });
});
