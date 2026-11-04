// @vitest-environment node
// GitHub's REST API as OpenLen calls it: a request that hangs gives up (final review, minor 11 → important: a hung call
// held the event tasks' whole pass).
import { afterEach, describe, expect, it, vi } from "vitest";

import { GITHUB_TIMEOUT_MS, githubApi } from "./rest";

afterEach(() => vi.unstubAllGlobals());

describe("githubApi", () => {
  it("every request carries a timeout, and reads how much of the rate limit is left", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "x-ratelimit-remaining": "4999" } });
    });
    expect(await githubApi("GET", "/repos/ana/web", "ghs_x")).toMatchObject({ status: 200, body: { ok: 1 }, rateRemaining: 4999 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(GITHUB_TIMEOUT_MS).toBe(30_000);
  });
});
