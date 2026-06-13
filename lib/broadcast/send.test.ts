// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendSpy, recordSpy } = vi.hoisted(() => ({
  sendSpy: vi.fn(),
  recordSpy: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendBroadcastBatch: sendSpy }));
vi.mock("@/lib/broadcast/store", () => ({ recordRecipients: recordSpy }));

import { runBroadcastSend } from "./send";
import type { AudienceMember } from "./audience";

const audienceOf = (n: number): AudienceMember[] =>
  Array.from({ length: n }, (_, i) => ({
    memberId: `m${i}`,
    email: `u${i}@x.co`,
    name: null,
  }));

const baseParams = (audience: AudienceMember[]) => ({
  broadcastId: "bc1",
  projectId: "p1",
  sub: "mysite",
  baseUrl: "https://mysite.openlen.com",
  siteTitle: "Mi Negocio",
  locale: "es",
  subject: "Hola",
  body: "Cuerpo",
  audience,
});

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
});
beforeEach(() => {
  sendSpy.mockReset();
  recordSpy.mockReset();
  recordSpy.mockResolvedValue(undefined);
});

describe("runBroadcastSend", () => {
  it("chunks into ≤100 with stable per-chunk idempotency keys", async () => {
    sendSpy.mockImplementation((items: unknown[]) =>
      Promise.resolve({ accepted: items.length, failedIndices: [] }),
    );
    const res = await runBroadcastSend(baseParams(audienceOf(250)));
    expect(res).toEqual({ accepted: 250, failed: 0 });
    expect(sendSpy).toHaveBeenCalledTimes(3);
    const sizes = sendSpy.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(sizes).toEqual([100, 100, 50]);
    const keys = sendSpy.mock.calls.map((c) => (c[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(["bcast:bc1:0", "bcast:bc1:1", "bcast:bc1:2"]);
  });

  it("each email carries that recipient's own unsubscribe link", async () => {
    sendSpy.mockResolvedValue({ accepted: 2, failedIndices: [] });
    await runBroadcastSend(baseParams(audienceOf(2)));
    const items = sendSpy.mock.calls[0][0] as Array<{ to: string; unsubUrl: string }>;
    expect(items[0].unsubUrl).toContain("/api/b/mysite/unsubscribe?m=m0&t=");
    expect(items[1].unsubUrl).toContain("m=m1&t=");
    expect(items[0].unsubUrl).not.toBe(items[1].unsubUrl);
  });

  it("accumulates accepted/failed and snapshots per-recipient status", async () => {
    sendSpy.mockResolvedValue({ accepted: 3, failedIndices: [1] });
    const res = await runBroadcastSend(baseParams(audienceOf(4)));
    expect(res).toEqual({ accepted: 3, failed: 1 });
    const snap = recordSpy.mock.calls[0][1] as Array<{ email: string; status: string }>;
    expect(snap.find((s) => s.email === "u1@x.co")!.status).toBe("failed");
    expect(snap.find((s) => s.email === "u0@x.co")!.status).toBe("accepted");
  });

  it("serializes concurrent sends (single-flight)", async () => {
    let active = 0;
    let maxActive = 0;
    sendSpy.mockImplementation(async (items: unknown[]) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { accepted: (items as unknown[]).length, failedIndices: [] };
    });
    await Promise.all([
      runBroadcastSend(baseParams(audienceOf(100))),
      runBroadcastSend(baseParams(audienceOf(100))),
    ]);
    expect(maxActive).toBe(1);
  });
});
