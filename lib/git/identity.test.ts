// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gitIdentity } from "./identity";

describe("who signs a commit", () => {
  it("their name, and a noreply address: never the real email", () => {
    expect(gitIdentity("u1", { name: "Ana López", handle: "ana" })).toEqual({ name: "Ana López", email: "ana@users.noreply.openlen.com" });
    expect(gitIdentity("u1", { name: null, handle: "ana" })).toEqual({ name: "ana", email: "ana@users.noreply.openlen.com" });
    expect(gitIdentity("u1", { name: "Ana", handle: null })).toEqual({ name: "Ana", email: "u1@users.noreply.openlen.com" });
    expect(gitIdentity("u1", null)).toEqual({ name: "OpenLen user", email: "u1@users.noreply.openlen.com" });
  });
  it("a name can't break the signature line", () => {
    expect(gitIdentity("u1", { name: "Ana <x>\nY", handle: null }).name).toBe("Ana xY");
  });
});
