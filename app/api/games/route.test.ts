// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/games", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says games are on", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it("answers 404 with OPENLEN_GAMES=0, so the «Juego» card isn't drawn", async () => {
    vi.stubEnv("OPENLEN_GAMES", "0");
    expect((await GET()).status).toBe(404);
  });
});
