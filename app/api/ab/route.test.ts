// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ab", () => {
  it("🔴 off: 404, so the chat's cards don't ask anything else, ever", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("on: 200", async () => {
    vi.stubEnv("OPENLEN_AB_TESTING", "1");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });
});
