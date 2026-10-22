import { describe, expect, it } from "vitest";

import { readUnsubscribeToken, unsubscribeToken } from "./unsubscribe";

describe("the unsubscribe token", () => {
  it("round-trips the project and the address", () => {
    const t = unsubscribeToken("p1", "Ana@X.com", "secret");
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(readUnsubscribeToken(t, "secret")).toEqual({ projectId: "p1", address: "ana@x.com" });
  });

  it("another secret, a changed project or a broken token reads as null", () => {
    const t = unsubscribeToken("p1", "ana@x.com", "secret");
    expect(readUnsubscribeToken(t, "other")).toBeNull();
    const forged = `${Buffer.from(JSON.stringify({ p: "p2", a: "ana@x.com" })).toString("base64url")}.${t.split(".")[1]}`;
    expect(readUnsubscribeToken(forged, "secret")).toBeNull();
    expect(readUnsubscribeToken("nope", "secret")).toBeNull();
  });
});
