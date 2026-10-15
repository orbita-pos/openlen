// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ObjectCache } from "./object-cache";
import { blobOf } from "./objects";

describe("the object cache is capped by bytes, not by entries", () => {
  it("evicts the least recently used objects once the bytes pass the cap", () => {
    const cache = new ObjectCache(100);
    const a = blobOf("a".repeat(40));
    const b = blobOf("b".repeat(40));
    const c = blobOf("c".repeat(40));
    cache.set("a", a);
    cache.set("b", b);
    expect(cache.get("a")).toBe(a);
    cache.set("c", c);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(a);
    expect(cache.get("c")).toBe(c);
    expect(cache.totalBytes).toBe(80);
  });

  it("never keeps an object larger than the whole cap", () => {
    const cache = new ObjectCache(100);
    cache.set("big", blobOf("x".repeat(101)));
    expect(cache.get("big")).toBeUndefined();
    expect(cache.totalBytes).toBe(0);
  });

  it("setting the same key twice counts its bytes once", () => {
    const cache = new ObjectCache(100);
    const a = blobOf("a".repeat(40));
    cache.set("a", a);
    cache.set("a", a);
    expect(cache.totalBytes).toBe(40);
  });
});
