import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the seed core so the route test never loads the native html-engine
// binding (vitest can't load .node); we only exercise the token guard here.
vi.mock("@/lib/community/seed", () => ({
  seedExplore: vi.fn(async () => ({ ok: ["showcase-x"], failed: [] })),
}));

import { POST } from "./route";
import { seedExplore } from "@/lib/community/seed";

const post = (headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/admin/explore-seed", { method: "POST", headers }));

describe("POST /api/admin/explore-seed", () => {
  beforeEach(() => {
    delete process.env.EXPLORE_SEED_TOKEN;
  });

  it("404 when the token env is unset (inert by default)", async () => {
    expect((await post()).status).toBe(404);
  });

  it("403 on a wrong token", async () => {
    process.env.EXPLORE_SEED_TOKEN = "secret";
    expect((await post({ "x-seed-token": "nope" })).status).toBe(403);
  });

  it("403 when the token env is set but no header is sent", async () => {
    process.env.EXPLORE_SEED_TOKEN = "secret";
    expect((await post()).status).toBe(403);
  });

  it("200 + result on the correct token", async () => {
    process.env.EXPLORE_SEED_TOKEN = "secret";
    const res = await post({ "x-seed-token": "secret" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toEqual(["showcase-x"]);
  });

  it("?only= filtra las entries que llegan a seedExplore; sin match → 400", async () => {
    process.env.EXPLORE_SEED_TOKEN = "secret";
    const { SEED_ENTRIES } = await import("@/lib/community/explore-seed.config");
    const first = SEED_ENTRIES[0].templateId;
    const res = await POST(
      new Request(`http://x/api/admin/explore-seed?only=${first}`, {
        method: "POST",
        headers: { "x-seed-token": "secret" },
      }),
    );
    expect(res.status).toBe(200);
    expect(seedExplore).toHaveBeenLastCalledWith([SEED_ENTRIES[0]]);

    const none = await POST(
      new Request("http://x/api/admin/explore-seed?only=no-such-template", {
        method: "POST",
        headers: { "x-seed-token": "secret" },
      }),
    );
    expect(none.status).toBe(400);
  });
});
