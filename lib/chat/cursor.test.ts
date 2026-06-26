import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/chat/cursor";

describe("chat cursor", () => {
  it("round-trips createdAt + id", () => {
    const d = new Date("2026-06-25T12:00:00.000Z");
    const c = encodeCursor({ createdAt: d, id: "abc-123" });
    expect(typeof c).toBe("string");
    expect(decodeCursor(c)).toEqual({ ms: d.getTime(), id: "abc-123" });
  });

  it("returns null on garbage", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from("nodot").toString("base64url"))).toBeNull();
  });
});
