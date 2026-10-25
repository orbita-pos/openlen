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
