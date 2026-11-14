import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import type { AgentLoopArgs, runAgentLoop } from "@/lib/agent/loop";
import { checkReplay, jsonbRoundTrip, withReplayInvariant } from "./replay-invariant";

describe("jsonbRoundTrip", () => {
  it("orders keys like Postgres did in production", () => {
    expect(JSON.stringify(jsonbRoundTrip({ file_path: "/a", offset: 1, limit: 50 }))).toBe('{"limit":50,"offset":1,"file_path":"/a"}');
    expect(JSON.stringify(jsonbRoundTrip({ steps: [{ action: "click", url: "/" }], ok: true, "ñu": 1, zz: 2 }))).toBe(
      '{"ok":true,"zz":2,"ñu":1,"steps":[{"url":"/","action":"click"}]}',
    );
  });
});

describe("checkReplay", () => {
  const initial: Message[] = [{ role: "system", content: "S" }, { role: "user", content: "hola" }];
  const turn: Message[] = [
    { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/a", offset: 1, limit: 50 } }] },
    { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "x" } }] },
    { role: "assistant", content: "Listo." },
  ];

  it("a turn whose saved transcript rebuilds the same wire passes", () => {
    expect(checkReplay({ initialMessages: initial, lastRequest: [...initial, ...turn.slice(0, 2)], transcript: turn, leidos: new Map() })).toEqual({ ok: true });
  });

  it("a message the transcript changed is bytes_differ at its wire index", () => {
    const saved = [turn[0]!, { ...turn[1]!, functionResponses: [{ name: "Read", response: { ok: true, tool_result: "y" } }] }, turn[2]!];
    expect(checkReplay({ initialMessages: initial, lastRequest: [...initial, ...turn.slice(0, 2)], transcript: saved, leidos: new Map() })).toEqual({
      ok: false,
      firstMismatch: 3,
      cause: "bytes_differ",
    });
  });

  it("a screenshot the transcript does not keep is images_dropped", () => {
    const withShot: Message = { ...turn[1]!, images: [{ mimeType: "image/png", dataBase64: "AAAA" }] };
    const r = checkReplay({ initialMessages: initial, lastRequest: [...initial, turn[0]!, withShot], transcript: [turn[0]!, withShot, turn[2]!], leidos: new Map() });
    expect(r).toMatchObject({ ok: false, cause: "images_dropped" });
  });
});

// A11: after a summary, the next turn rebuilds from the saved mark (Claude Code's
// `compact_boundary`), so the requests after it must replay byte for byte too.
describe("checkReplay with a compaction mark", () => {
  const initial: Message[] = [
    { role: "system", content: "S" },
    { role: "user", content: "manual" },
    { role: "user", content: "old 1" },
    { role: "assistant", content: "old 2" },
    { role: "user", content: "now" },
  ];
  const summary: Message = { role: "user", content: "<compacted-summary>\nold\n</compacted-summary>" };
  const own: Message[] = [
    { role: "assistant", content: "before the summary" },
    { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: "/a", offset: 1, limit: 50 } }] },
    { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: "x" } }] },
    { role: "assistant", content: "Done." },
  ];
  const mark = { messages: [summary, initial[4]!], fromTranscript: 1, trigger: "pressure" as const, preTokens: 50, postTokens: 10 };
  const afterSummary: Message[] = [initial[0]!, initial[1]!, summary, initial[4]!, own[1]!, own[2]!];

  it("🔴 C04/C12: a request after the summary replays from the mark (through jsonb) and the transcript's tail", () => {
    expect(checkReplay({ initialMessages: initial, lastRequest: afterSummary, transcript: own, leidos: new Map(), compactionMark: mark, firstIndex: 2 })).toEqual({ ok: true });
  });

  it("CONTROL: without the mark the same request does not replay", () => {
    expect(checkReplay({ initialMessages: initial, lastRequest: afterSummary, transcript: own, leidos: new Map() }).ok).toBe(false);
  });
});

// 14/11 · the wrapper around every loop test stores the screenshots as the route does and asks them back: a
// picture that stops coming back is a failed test, no longer an allowed difference.
describe("withReplayInvariant and the screenshots a turn took", () => {
  const picture = { mimeType: "image/jpeg", dataBase64: "AAAA" };
  const initial: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "mira" }];
  const call: Message = { role: "assistant", content: "", functionCalls: [{ name: "view_page", args: {} }] };
  const seen = (screenshots?: string[]): Message => ({
    role: "user",
    content: "Screenshots below, in order: image 1 from view_page. Look at them yourself.",
    functionResponses: [{ name: "view_page", response: { ok: true } }],
    images: [picture],
    ...(screenshots ? { screenshots } : {}),
  });
  /** A loop that looks once: it stores the picture through the wrapper, sends it, and saves what `saved` says. */
  const looking = (saved: (urls: readonly string[]) => Message): typeof runAgentLoop =>
    (async (args: AgentLoopArgs) => {
      const urls = (await args.storeScreenshots?.([picture])) ?? [];
      const sent = [...args.messages, call, seen(urls.length ? [...urls] : undefined)];
      for await (const _ of args.openStream(sent)) void _;
      return { finalText: "", turns: 1, toolCalls: 1, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, terminalError: false, transcripcion: [call, saved(urls), { role: "assistant", content: "Visto." }] } as never;
    }) as never;
  const args = (extra: Partial<AgentLoopArgs> = {}): AgentLoopArgs =>
    ({ messages: initial, tools: [], openStream: () => (async function* () {})(), runTool: async () => ({ response: { ok: true } }), emit: () => {}, ...extra }) as never;

  it("the row kept the picture's address: the turn replays, with no allowance", async () => {
    await expect(withReplayInvariant(looking((urls) => seen([...urls])))(args())).resolves.toBeDefined();
  });

  it("🔴 the row lost the address — the picture would not come back: the test fails", async () => {
    await expect(withReplayInvariant(looking(() => seen()))(args())).rejects.toThrow(/does not replay from the saved transcript \(message \d+, images_dropped\)/);
  });

  it("a turn whose pictures could not be stored has nothing to bring back: that is let through", async () => {
    const failing = args({ storeScreenshots: async () => [] });
    await expect(withReplayInvariant(looking(() => seen()))(failing)).resolves.toBeDefined();
  });

  it("the test's own store is used, and its addresses are the ones asked back", async () => {
    const asked: number[] = [];
    const own = args({ storeScreenshots: async (images) => (asked.push(images.length), ["https://files.example/own.jpg"]) });
    await expect(withReplayInvariant(looking((urls) => seen([...urls])))(own)).resolves.toBeDefined();
    expect(asked).toEqual([1]);
  });
});
