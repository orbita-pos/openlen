import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import { checkReplay, jsonbRoundTrip } from "./replay-invariant";

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
