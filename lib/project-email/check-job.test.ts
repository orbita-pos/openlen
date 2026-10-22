import { describe, expect, it, vi } from "vitest";

import { runEmailDomainsCheck } from "./check-job";
import { memoryEmailStore } from "./store";
import type { EmailDomainStatus } from "./types";

const NOW = new Date("2026-10-22T10:00:00Z");
const HOUR = 60 * 60 * 1000;

async function world() {
  let clock = new Date(NOW.getTime() - 31 * 24 * HOUR);
  const store = memoryEmailStore(() => clock);
  const put = (projectId: string, status: EmailDomainStatus, lastCheckedAt: Date | null) =>
    store.putDomain({ projectId, domain: `${projectId}.mx`, sendingHost: `notify.${projectId}.mx`, showAsRoot: false, resendDomainId: `rd_${projectId}`, records: [], status, lastCheckedAt, verifiedAt: null });
  await put("pend", "pending", null);
  await put("verif", "verifying", new Date(NOW.getTime() - 5 * 60 * 1000));
  await put("off", "offline", new Date(NOW.getTime() - HOUR));
  await put("readyfresh", "ready", new Date(NOW.getTime() - 2 * HOUR));
  await put("readyold", "ready", new Date(NOW.getTime() - 25 * HOUR));
  await put("failed", "failed", null);
  // One message from 31 days ago, one from today: only the old one goes.
  await store.logMessage({ projectId: "pend", ownerId: "u1", environment: "live", kind: "app", toAddress: "a@x.com", subject: "viejo", status: "sent", reason: null, resendId: null, tag: null });
  clock = NOW;
  await store.logMessage({ projectId: "pend", ownerId: "u1", environment: "live", kind: "app", toAddress: "a@x.com", subject: "nuevo", status: "sent", reason: null, resendId: null, tag: null });
  return store;
}

describe("runEmailDomainsCheck", () => {
  it("pending and verifying are checked every run, ready once a day, and old messages are deleted", async () => {
    const store = await world();
    const check = vi.fn(async (_projectId: string) => {});
    const r = await runEmailDomainsCheck({ store, check, now: () => NOW, pause: async () => {} });
    expect(check.mock.calls.map((c) => c[0]).sort()).toEqual(["off", "pend", "readyold", "verif"]);
    expect(r).toEqual({ checked: 4, failed: 0, deleted: 1 });
    expect((await store.recentMessages("pend", 5)).map((m) => m.subject)).toEqual(["nuevo"]);
  });

  it("one domain that fails doesn't stop the others", async () => {
    const store = await world();
    const check = vi.fn(async (projectId: string) => {
      if (projectId === "pend") throw new Error("Resend 500");
    });
    const r = await runEmailDomainsCheck({ store, check, now: () => NOW, pause: async () => {} });
    expect(check).toHaveBeenCalledTimes(4);
    expect(r).toMatchObject({ checked: 3, failed: 1 });
  });

  it("it pauses between domains (Resend's rate limit) and stops at the run's cap", async () => {
    const store = memoryEmailStore(() => NOW);
    for (let i = 0; i < 205; i++) await store.putDomain({ projectId: `p${i}`, domain: `p${i}.mx`, sendingHost: `notify.p${i}.mx`, showAsRoot: false, resendDomainId: `rd${i}`, records: [], status: "pending", lastCheckedAt: null, verifiedAt: null });
    const pause = vi.fn(async () => {});
    const r = await runEmailDomainsCheck({ store, check: async () => {}, now: () => NOW, pause });
    expect(r.checked).toBe(200);
    expect(pause).toHaveBeenCalledTimes(199);
  });
});
