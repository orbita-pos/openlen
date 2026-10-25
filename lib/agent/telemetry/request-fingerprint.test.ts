import { describe, expect, it } from "vitest";
import { fingerprintWire } from "./request-fingerprint";

describe("fingerprintWire", () => {
  it("hashes each wire message as the exact JSON element that is sent", () => {
    const a = fingerprintWire({ model: "m", messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }] });
    const b = fingerprintWire({
      model: "m",
      messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }, { role: "assistant", content: "yo" }],
    });
    expect(a.systemHash).toBe(b.systemHash);
    expect(b.messageHashes.slice(0, 1)).toEqual(a.messageHashes);
    expect(a.messageCount).toBe(1);
    expect(a.prefixHash).not.toBe(b.prefixHash);
  });

  it("a reordered key is a different message", () => {
    const x = fingerprintWire({ model: "m", messages: [{ role: "user", content: "a", name: "n" }] });
    const y = fingerprintWire({ model: "m", messages: [{ name: "n", role: "user", content: "a" }] });
    expect(x.messageHashes[0]).not.toBe(y.messageHashes[0]);
  });

  it("no system message and no tools give null hashes", () => {
    const f = fingerprintWire({ model: "m", messages: [{ role: "user", content: "a" }] });
    expect(f.systemHash).toBeNull();
    expect(f.toolsHash).toBeNull();
    expect(f.messageHashes[0]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("tools are hashed as one list", () => {
    const t = [{ type: "function", function: { name: "Read" } }];
    expect(fingerprintWire({ model: "m", messages: [], tools: t }).toolsHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
