// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/figures", () => {
  it("answers the switch, never cached", async () => {
    const on = await GET(new Request("http://localhost/api/figures"));
    expect(await on.json()).toEqual({ enabled: true });
    expect(on.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("OPENLEN_FIGURES", "0");
    expect(await (await GET(new Request("http://localhost/api/figures"))).json()).toEqual({ enabled: false });
  });
});
