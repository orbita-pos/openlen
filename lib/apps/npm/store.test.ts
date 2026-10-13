import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diskStore, layeredStore, memoryStore, r2Store, sha256Hex } from "./store";

describe("module store", () => {
  it("disk: returns what was put, and nothing when the file no longer matches its hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "esm-store-"));
    const store = diskStore(dir, 1024 * 1024);
    const sha = sha256Hex("export default 1;");
    await store.put(sha, "export default 1;");
    expect(await store.get(sha)).toBe("export default 1;");
    writeFileSync(join(dir, sha.slice(0, 2), `${sha}.txt`), "tampered");
    expect(await store.get(sha)).toBeNull();
  });

  it("disk: past its cap, the oldest files go", async () => {
    const dir = mkdtempSync(join(tmpdir(), "esm-store-"));
    const store = diskStore(dir, 150);
    for (const n of [1, 2, 3, 4]) {
      const text = `${"x".repeat(60)}${n}`;
      await store.put(sha256Hex(text), text);
      await new Promise((r) => setTimeout(r, 20));
    }
    const total = readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)).map((f) => statSync(join(dir, d, f)).size)).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(150);
    expect(await store.get(sha256Hex(`${"x".repeat(60)}4`))).not.toBeNull();
  });

  it("🔴 memory: past its byte cap, the least recently used module goes (it lives in the server's process)", async () => {
    const store = memoryStore(150);
    const text = (n: string) => `${"x".repeat(59)}${n}`;
    await store.put(sha256Hex(text("a")), text("a"));
    await store.put(sha256Hex(text("b")), text("b"));
    // Read again: it becomes the most recent.
    expect(await store.get(sha256Hex(text("a")))).toBe(text("a"));
    await store.put(sha256Hex(text("c")), text("c"));
    expect(await store.get(sha256Hex(text("b")))).toBeNull();
    expect(await store.get(sha256Hex(text("a")))).toBe(text("a"));
    expect(await store.get(sha256Hex(text("c")))).toBe(text("c"));
  });

  it("layered: a hit in a slower layer fills the faster one", async () => {
    const fast = memoryStore();
    const slow = memoryStore();
    const sha = sha256Hex("a");
    await slow.put(sha, "a");
    expect(await layeredStore([fast, slow]).get(sha)).toBe("a");
    expect(await fast.get(sha)).toBe("a");
  });

  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("R2 is off without credentials", () => {
    delete process.env.R2_ACCOUNT_ID;
    expect(r2Store()).toBeNull();
  });
});
