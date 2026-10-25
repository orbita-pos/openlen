import { describe, expect, it } from "vitest";
import { diffConsecutive } from "./request-diff";

describe("diffConsecutive", () => {
  it("a system prompt changed by one date is reported at the exact character", () => {
    const a = { model: "m", messages: [{ role: "system", content: "Be concise." }] };
    const b = { model: "m", messages: [{ role: "system", content: "Be concise. Today 2026-10-24." }] };
    // {"role":"system","content":"Be concise.  ← the 40th character (index 39) is where they part.
    expect(diffConsecutive(a, b)).toMatchObject({ match: false, part: "system", index: 0, at: 39 });
  });

  it("an appended message is a match", () => {
    const a = { model: "m", messages: [{ role: "system", content: "S" }, { role: "user", content: "hola" }] };
    const b = { model: "m", messages: [...a.messages, { role: "assistant", content: "¡Hola!" }, { role: "user", content: "gracias" }] };
    expect(diffConsecutive(a, b)).toEqual({ match: true });
  });

  it("a tool list that changed is part tools", () => {
    const tools = [{ type: "function", function: { name: "Read" } }];
    const a = { model: "m", messages: [{ role: "user", content: "x" }], tools };
    expect(diffConsecutive(a, { ...a, tools: [...tools, { type: "function", function: { name: "Write" } }] })).toMatchObject({ match: false, part: "tools" });
    // The closing call sends no tools at all.
    expect(diffConsecutive(a, { model: "m", messages: a.messages })).toMatchObject({ match: false, part: "tools" });
  });

  it("a rewritten earlier message is part messages at its index, with the text around the change", () => {
    const a = { model: "m", messages: [{ role: "system", content: "S" }, { role: "assistant", content: "", tool_calls: [{ function: { arguments: '{"file_path":"/a","limit":5}' } }] }] };
    const b = { model: "m", messages: [{ role: "system", content: "S" }, { role: "assistant", content: "", tool_calls: [{ function: { arguments: '{"limit":5,"file_path":"/a"}' } }] }, { role: "user", content: "más" }] };
    const v = diffConsecutive(a, b);
    expect(v).toMatchObject({ match: false, part: "messages", index: 1 });
    if (v.match) throw new Error("unreachable");
    expect(v.before).toContain("file_path");
    expect(v.after).toContain("limit");
  });

  it("a shorter next request is a mismatch at the first missing message", () => {
    const a = { model: "m", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] };
    expect(diffConsecutive(a, { model: "m", messages: [{ role: "user", content: "a" }] })).toMatchObject({ match: false, part: "messages", index: 1 });
  });
});
