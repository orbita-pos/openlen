// lib/project-email/store-contract.ts — what any EmailStore must do, as a suite
// both implementations run: memory (store.test.ts) and Postgres
// (store-pg.pg.test.ts). Not a test file itself: the two test files call it.

import { describe, expect, it } from "vitest";

import type { EmailMessageRow, EmailStore } from "./types";

export interface EmailStoreSetup {
  readonly store: EmailStore;
  /** Two projects and their owner that exist (Postgres needs the rows for its foreign keys). */
  readonly projectA: string;
  readonly projectB: string;
  readonly owner: string;
}

const domain = (projectId: string, host = "notify.taller.mx") => ({
  projectId,
  domain: "taller.mx",
  sendingHost: host,
  showAsRoot: false,
  resendDomainId: `rd_${projectId}`,
  records: [
    { type: "TXT" as const, name: "resend._domainkey.notify", value: "p=MIGf" },
    { type: "MX" as const, name: "send.notify", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10 },
    { type: "TXT" as const, name: "send.notify", value: "v=spf1 include:amazonses.com ~all" },
  ],
  status: "pending" as const,
  lastCheckedAt: null,
  verifiedAt: null,
});

const message = (o: Partial<Omit<EmailMessageRow, "id" | "createdAt">> & Pick<EmailMessageRow, "projectId" | "ownerId">): Omit<EmailMessageRow, "id" | "createdAt"> => ({
  environment: "live",
  kind: "app",
  toAddress: "ana@cliente.mx",
  subject: "Tu pedido",
  status: "sent",
  reason: null,
  resendId: null,
  tag: null,
  ...o,
});

export function describeEmailStoreContract(name: string, setup: () => Promise<EmailStoreSetup>): void {
  describe(`${name}: the EmailStore contract`, () => {
    it("a domain row round-trips and is found by its host", async () => {
      const { store, projectA } = await setup();
      await store.putDomain(domain(projectA));
      const row = await store.getDomain(projectA);
      expect(row).toMatchObject({ domain: "taller.mx", sendingHost: "notify.taller.mx", status: "pending", createdAt: expect.any(Date) });
      expect(row!.records).toHaveLength(3);
      expect(row!.records[1]).toMatchObject({ type: "MX", priority: 10 });
      expect((await store.domainByHost("notify.taller.mx"))?.projectId).toBe(projectA);
      expect(await store.domainByHost("notify.otro.mx")).toBeNull();
    });

    it("the same sendingHost in another project is refused", async () => {
      const { store, projectA, projectB } = await setup();
      await store.putDomain(domain(projectA));
      await expect(store.putDomain(domain(projectB))).rejects.toThrow();
      expect(await store.getDomain(projectB)).toBeNull();
    });

    it("putDomain replaces the project's own row", async () => {
      const { store, projectA } = await setup();
      await store.putDomain(domain(projectA));
      await store.putDomain({ ...domain(projectA, "taller.mx"), showAsRoot: true });
      expect(await store.getDomain(projectA)).toMatchObject({ sendingHost: "taller.mx", showAsRoot: true });
      expect(await store.domainByHost("notify.taller.mx")).toBeNull();
    });

    it("setDomainStatus stamps the check, and the first ready also stamps verifiedAt", async () => {
      const { store, projectA } = await setup();
      await store.putDomain(domain(projectA));
      const t1 = new Date("2026-10-22T10:00:00Z");
      const t2 = new Date("2026-10-22T11:00:00Z");
      await store.setDomainStatus(projectA, "verifying", t1);
      expect(await store.getDomain(projectA)).toMatchObject({ status: "verifying", lastCheckedAt: t1, verifiedAt: null });
      await store.setDomainStatus(projectA, "ready", t1);
      await store.setDomainStatus(projectA, "ready", t2);
      expect(await store.getDomain(projectA)).toMatchObject({ status: "ready", lastCheckedAt: t2, verifiedAt: t1 });
    });

    it("domainsToCheck leaves out the failed ones, and deleteDomain removes the row", async () => {
      const { store, projectA, projectB } = await setup();
      await store.putDomain(domain(projectA));
      await store.putDomain(domain(projectB, "notify.otro.mx"));
      await store.setDomainStatus(projectB, "failed", new Date());
      expect((await store.domainsToCheck()).map((d) => d.projectId).filter((p) => p === projectA || p === projectB)).toEqual([projectA]);
      await store.deleteDomain(projectA);
      expect(await store.getDomain(projectA)).toBeNull();
    });

    it("an unsubscribe blocks app and form but not auth; a bounce blocks all three", async () => {
      const { store, projectA } = await setup();
      await store.suppress(projectA, "ana@cliente.mx", "unsubscribed");
      await store.suppress(projectA, "beto@cliente.mx", "bounced");
      expect(await store.isSuppressed(projectA, "ana@cliente.mx", "app")).toBe(true);
      expect(await store.isSuppressed(projectA, "ana@cliente.mx", "form")).toBe(true);
      expect(await store.isSuppressed(projectA, "ana@cliente.mx", "auth")).toBe(false);
      for (const kind of ["app", "form", "auth"] as const) expect(await store.isSuppressed(projectA, "beto@cliente.mx", kind)).toBe(true);
    });

    it("suppression matches whatever the case and spaces, and is per project", async () => {
      const { store, projectA, projectB } = await setup();
      await store.suppress(projectA, "ana@x.com", "complained");
      expect(await store.isSuppressed(projectA, " Ana@X.com ", "app")).toBe(true);
      expect(await store.isSuppressed(projectB, "ana@x.com", "app")).toBe(false);
      await store.suppress(projectA, " ANA@x.com", "bounced");
      const list = await store.listSuppressions(projectA);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ address: "ana@x.com", createdAt: expect.any(Date) });
      await store.unsuppress(projectA, "Ana@X.com");
      expect(await store.isSuppressed(projectA, "ana@x.com", "app")).toBe(false);
    });

    it("usage adds up per owner and month", async () => {
      const { store, owner } = await setup();
      expect(await store.usage(owner, "2026-10")).toBe(0);
      expect(await store.addUsage(owner, "2026-10", 3)).toBe(3);
      expect(await store.addUsage(owner, "2026-10", 2)).toBe(5);
      expect(await store.addUsage(owner, "2026-11", 1)).toBe(1);
      expect(await store.usage(owner, "2026-10")).toBe(5);
    });

    it("countSentSince counts what went out for that owner and kind, not rejected nor draft", async () => {
      const { store, projectA, owner } = await setup();
      const since = new Date(Date.now() - 60 * 60 * 1000);
      for (const status of ["sent", "delivered", "bounced", "complained", "rejected", "not_sent_draft"] as const) {
        await store.logMessage(message({ projectId: projectA, ownerId: owner, status }));
      }
      await store.logMessage(message({ projectId: projectA, ownerId: owner, kind: "auth" }));
      await store.logMessage(message({ projectId: projectA, ownerId: owner, kind: "form" }));
      // A form reply counts against the app emails' cap.
      expect(await store.countSentSince(owner, "app", since)).toBe(5);
      expect(await store.countSentSince(owner, "auth", since)).toBe(1);
      expect(await store.countSentSince(owner, "app", new Date(Date.now() + 60_000))).toBe(0);
    });

    it("countMessages narrows by project, kind, address and tag", async () => {
      const { store, projectA, projectB, owner } = await setup();
      const since = new Date(Date.now() - 60 * 60 * 1000);
      await store.logMessage(message({ projectId: projectA, ownerId: owner, kind: "form", toAddress: "ana@x.com", tag: "contacto" }));
      await store.logMessage(message({ projectId: projectA, ownerId: owner, kind: "form", toAddress: "beto@x.com", tag: "contacto" }));
      await store.logMessage(message({ projectId: projectA, ownerId: owner, kind: "form", toAddress: "ana@x.com", tag: "otro", status: "rejected" }));
      await store.logMessage(message({ projectId: projectB, ownerId: owner, kind: "form", toAddress: "ana@x.com", tag: "contacto" }));
      expect(await store.countMessages({ projectId: projectA, kind: "form", toAddress: " ANA@x.com", since })).toBe(1);
      expect(await store.countMessages({ projectId: projectA, kind: "form", tag: "contacto", since })).toBe(2);
      expect(await store.countMessages({ projectId: projectA, kind: "app", since })).toBe(0);
    });

    it("setStatusByResendId updates the message and says whose it was; an unknown id is null", async () => {
      const { store, projectA, owner } = await setup();
      await store.logMessage(message({ projectId: projectA, ownerId: owner, resendId: "re_1", toAddress: "ana@x.com" }));
      expect(await store.setStatusByResendId("re_1", "bounced", "Permanent")).toEqual({ projectId: projectA, toAddress: "ana@x.com" });
      expect((await store.recentMessages(projectA, 10))[0]).toMatchObject({ status: "bounced", reason: "Permanent" });
      expect(await store.setStatusByResendId("re_nope", "delivered", null)).toBeNull();
    });

    it("recentMessages is newest first and limited; deleteMessagesBefore removes the old", async () => {
      const { store, projectA, owner } = await setup();
      for (const subject of ["uno", "dos", "tres"]) await store.logMessage(message({ projectId: projectA, ownerId: owner, subject }));
      const recent = await store.recentMessages(projectA, 2);
      expect(recent.map((m) => m.subject)).toEqual(["tres", "dos"]);
      expect(recent[0]).toMatchObject({ id: expect.any(String), createdAt: expect.any(Date), tag: null });
      expect(await store.deleteMessagesBefore(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(3);
      expect(await store.recentMessages(projectA, 10)).toEqual([]);
    });

    it("a blocked project or owner is blocked until unblocked", async () => {
      const { store, projectA, projectB, owner } = await setup();
      expect(await store.isBlocked(projectA, owner)).toBe(false);
      await store.block("project", projectA, "spam");
      expect(await store.isBlocked(projectA, owner)).toBe(true);
      expect(await store.isBlocked(projectB, "someone-else")).toBe(false);
      await store.block("owner", owner, "spam");
      expect(await store.isBlocked(projectB, owner)).toBe(true);
      await store.unblock("project", projectA);
      await store.unblock("owner", owner);
      expect(await store.isBlocked(projectA, owner)).toBe(false);
    });
  });
}
