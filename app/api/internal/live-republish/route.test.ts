// @vitest-environment node
//
// Guard tests for the machine-to-machine live-republish trigger (spec
// 2026-07-14, Task 12). Mocks lib/live/deps — that module's import chain pulls
// in lib/projects.ts → lib/normalize → the native @openlen/html-engine .node
// binding, which vitest cannot load (same reason app/api/admin/explore-seed/
// route.test.ts mocks lib/community/seed). The 401 paths return before
// liveRepublishDeps() is ever called, so the mock never needs to do anything.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/live/deps", () => ({
  liveRepublishDeps: vi.fn(() => ({
    listTargets: vi.fn(async () => []),
    fetchSheet: vi.fn(),
    syncCollection: vi.fn(),
    republish: vi.fn(),
  })),
}));

import { POST } from "./route";
import { liveRepublishDeps } from "@/lib/live/deps";

const post = (headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/internal/live-republish", { method: "POST", headers }));

describe("POST /api/internal/live-republish", () => {
  beforeEach(() => {
    delete process.env.OPENLEN_INTERNAL_SECRET;
    delete process.env.OPENLEN_LIVE_DATA;
    vi.clearAllMocks();
  });

  it("401 sin header de secreto", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("401 con secreto equivocado", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    const res = await post({ "x-internal-secret": "nope" });
    expect(res.status).toBe(401);
  });

  it("401 si el secreto del entorno no está seteado (fail-closed)", async () => {
    delete process.env.OPENLEN_INTERNAL_SECRET;
    const res = await post({ "x-internal-secret": "anything" });
    expect(res.status).toBe(401);
  });

  it("401 nunca llama a liveRepublishDeps (falla antes)", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    await post({ "x-internal-secret": "nope" });
    expect(liveRepublishDeps).not.toHaveBeenCalled();
  });

  it("503 cuando el kill-switch de datos vivos está apagado", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    process.env.OPENLEN_LIVE_DATA = "0";
    const res = await post({ "x-internal-secret": "s3cr3t" });
    expect(res.status).toBe(503);
  });

  it("200 + summary con secreto correcto y kill-switch encendido", async () => {
    process.env.OPENLEN_INTERNAL_SECRET = "s3cr3t";
    const res = await post({ "x-internal-secret": "s3cr3t" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toEqual({ processed: 0, synced: 0, failures: 0 });
  });
});
