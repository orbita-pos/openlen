import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@/lib/ai-gateway";
import { isRetryableStreamError, streamWithRetry } from "./retry";

const noSleep = async () => {};
const ev = (text: string): StreamEvent => ({ type: "text_delta", text });

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** A stream factory whose behavior is scripted per attempt. */
function scriptedOpen(...attempts: (StreamEvent[] | Error)[]): () => AsyncIterable<StreamEvent> {
  let i = 0;
  return () => {
    const plan = attempts[Math.min(i, attempts.length - 1)];
    i += 1;
    return (async function* () {
      if (plan instanceof Error) throw plan;
      for (const e of plan) yield e;
    })();
  };
}

const err503 = () => Object.assign(new Error("upstream API returned HTTP 503: high demand"), { retryable: true });

describe("isRetryableStreamError", () => {
  it("flags a GatewayError-shaped retryable error", () => {
    expect(isRetryableStreamError(err503())).toBe(true);
  });
  it("flags a 503/overloaded message even without the retryable flag", () => {
    expect(isRetryableStreamError(new Error("HTTP 503 unavailable"))).toBe(true);
    expect(isRetryableStreamError(new Error("model is overloaded"))).toBe(true);
  });
  it("does NOT flag a normal error", () => {
    expect(isRetryableStreamError(new Error("invalid argument: bad tool"))).toBe(false);
    expect(isRetryableStreamError(new Error("400 bad request"))).toBe(false);
  });
});

describe("streamWithRetry", () => {
  it("retries a stream that throws at open, then succeeds", async () => {
    const open = scriptedOpen(err503(), err503(), [ev("hola"), ev(" mundo")]);
    const out = await collect(streamWithRetry(open, { attempts: 5, sleep: noSleep }));
    expect(out.map((e) => (e.type === "text_delta" ? e.text : ""))).toEqual(["hola", " mundo"]);
  });

  it("does NOT retry once events have been yielded (no double-execution)", async () => {
    // Yields one event, THEN throws mid-stream — must propagate, not restart.
    let opens = 0;
    const open = () => {
      opens += 1;
      return (async function* () {
        yield ev("parcial");
        throw err503();
      })();
    };
    const got: StreamEvent[] = [];
    await expect(
      (async () => {
        for await (const e of streamWithRetry(open, { attempts: 5, sleep: noSleep })) got.push(e);
      })(),
    ).rejects.toThrow(/503/);
    expect(opens).toBe(1); // never re-opened
    expect(got).toHaveLength(1); // the partial event was still delivered
  });

  it("does NOT retry a non-retryable error", async () => {
    let opens = 0;
    const open = () => {
      opens += 1;
      return (async function* (): AsyncIterable<StreamEvent> {
        throw new Error("400 invalid tool call");
      })();
    };
    await expect(collect(streamWithRetry(open, { attempts: 5, sleep: noSleep }))).rejects.toThrow(/400/);
    expect(opens).toBe(1);
  });

  it("gives up after `attempts` retryable failures", async () => {
    let opens = 0;
    const open = () => {
      opens += 1;
      return (async function* (): AsyncIterable<StreamEvent> {
        throw err503();
      })();
    };
    await expect(collect(streamWithRetry(open, { attempts: 3, sleep: noSleep }))).rejects.toThrow(/503/);
    expect(opens).toBe(3);
  });

  it("does not retry once the signal is aborted (respects the overall timeout)", async () => {
    let opens = 0;
    const signal = { aborted: false };
    const open = () => {
      opens += 1;
      signal.aborted = true; // the route's 360s timeout fired between attempts
      return (async function* (): AsyncIterable<StreamEvent> {
        throw err503();
      })();
    };
    await expect(collect(streamWithRetry(open, { attempts: 5, sleep: noSleep, signal }))).rejects.toThrow();
    expect(opens).toBe(1);
  });
});
