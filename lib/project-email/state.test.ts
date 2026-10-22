import { describe, expect, it } from "vitest";

import type { Plan } from "@/lib/plan";

import { emailStateFor, type EmailStateDeps } from "./state";
import { memoryEmailStore } from "./store";

const NOW = new Date("2026-10-22T10:00:00Z");

async function deps(o: { enabled?: boolean; plan?: Plan; status?: "verifying" | "ready" | null; sent?: number } = {}): Promise<EmailStateDeps> {
  const store = memoryEmailStore(() => NOW);
  if (o.status !== null) {
    await store.putDomain({ projectId: "p1", domain: "taller.mx", sendingHost: "notify.taller.mx", showAsRoot: false, resendDomainId: "rd", records: [], status: o.status ?? "ready", lastCheckedAt: null, verifiedAt: null });
  }
  if (o.sent) await store.addUsage("u1", "2026-10", o.sent);
  return { enabled: o.enabled ?? true, store, ownerOf: async () => ({ userId: "u1", email: "dueno@taller.mx" }), planOf: async () => o.plan ?? "pro", now: () => NOW };
}

describe("emailStateFor (PROJECT STATE's `email`)", () => {
  it("null with the email off", async () => {
    expect(await emailStateFor("p1", await deps({ enabled: false }))).toBeNull();
  });

  it("a ready domain says where it sends from and the month against what's included", async () => {
    expect(await emailStateFor("p1", await deps({ sent: 120 }))).toEqual({
      domain: "taller.mx",
      status: "ready",
      from: "noreply@notify.taller.mx",
      sent_this_month: 120,
      included_per_month: 1000,
      plan: "pro",
    });
  });

  it("no domain is `none`; a domain still verifying sends from nowhere yet", async () => {
    expect(await emailStateFor("p1", await deps({ status: null }))).toMatchObject({ domain: null, status: "none", from: null });
    expect(await emailStateFor("p1", await deps({ status: "verifying" }))).toMatchObject({ status: "verifying", from: null });
  });

  it("the free plan has nothing included", async () => {
    expect(await emailStateFor("p1", await deps({ plan: "free", status: null }))).toMatchObject({ plan: "free", included_per_month: 0 });
  });
});
