import { describe, expect, it } from "vitest";
import { renderCacheKey, withRenderSlot } from "./render";

describe("renderCacheKey", () => {
  it("is stable for same inputs and changes with content", () => {
    const a = renderCacheKey("abc123def456", "<html>1</html>");
    expect(a).toBe(renderCacheKey("abc123def456", "<html>1</html>"));
    expect(a).toMatch(/^marketing\/abc123def456-[0-9a-f]{16}\.png$/);
    expect(a).not.toBe(renderCacheKey("abc123def456", "<html>2</html>"));
  });

  it("changes with contentHash even for the same filled html", () => {
    const html = "<html>same</html>";
    expect(renderCacheKey("hash-one", html)).not.toBe(renderCacheKey("hash-two", html));
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("withRenderSlot", () => {
  it("caps concurrent executions at 2 and admits waiters as slots free", async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      withRenderSlot(() => {
        started.push(i);
        return g.promise;
      }),
    );
    await settle();
    expect(started).toEqual([0, 1]); // 3rd waits for a slot

    gates[0].resolve("a");
    await settle();
    expect(started).toEqual([0, 1, 2]); // freed slot admits the 3rd

    gates[1].resolve("b");
    gates[2].resolve("c");
    expect(await Promise.all(runs)).toEqual(["a", "b", "c"]);
  });

  it("frees the slot when the wrapped fn throws", async () => {
    const boom = withRenderSlot(async () => {
      throw new Error("render exploded");
    });
    await expect(boom).rejects.toThrow("render exploded");

    // Both slots must be free again: two new calls start immediately.
    const gates = [deferred<void>(), deferred<void>()];
    const started: number[] = [];
    const runs = gates.map((g, i) =>
      withRenderSlot(() => {
        started.push(i);
        return g.promise;
      }),
    );
    await settle();
    expect(started).toEqual([0, 1]);
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
  });
});
