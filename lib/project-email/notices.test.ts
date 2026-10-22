import { describe, expect, it } from "vitest";

import { domainNoticeEmail, domainNoticePush, quotaNoticeEmail, quotaNoticePush } from "./notices";

describe("what the email notices say (English, like the other owner alerts)", () => {
  it("a ready domain", () => {
    const e = domainNoticeEmail({ projectId: "p 1", projectTitle: "Taller", domain: "taller.mx", status: "ready", siteUrl: "https://openlen.com" });
    expect(e.subject).toBe("taller.mx is ready to send email");
    expect(e.text).toContain("https://openlen.com/new?project=p%201&view=database");
    expect(domainNoticePush({ projectId: "p 1", projectTitle: "Taller", domain: "taller.mx", status: "ready" })).toEqual({
      title: "Email · Taller",
      body: "taller.mx ✓",
      url: "/new?project=p%201&view=database",
    });
  });

  it("a domain that stopped verifying says the emails stopped and sign-in still works", () => {
    const e = domainNoticeEmail({ projectId: "p1", projectTitle: null, domain: "taller.mx", status: "offline", siteUrl: "https://openlen.com" });
    expect(e.subject).toBe("taller.mx stopped sending email");
    expect(e.text).toMatch(/DNS records/);
    expect(e.text).toMatch(/sign-in emails go out from OpenLen/);
  });

  it("the allowance at 80 %, at 100 %, and without credits", () => {
    expect(quotaNoticeEmail({ projectId: "p1", percent: 80, sent: 800, included: 1000, noCredits: false, siteUrl: "https://x" }).subject).toBe("Your projects used 80% of this month's emails");
    expect(quotaNoticeEmail({ projectId: "p1", percent: 100, sent: 1000, included: 1000, noCredits: false, siteUrl: "https://x" }).text).toMatch(/150 credits per 1,000/);
    expect(quotaNoticeEmail({ projectId: "p1", percent: 100, sent: 1000, included: 1000, noCredits: true, siteUrl: "https://x" }).subject).toBe("Your projects' emails stopped: no credits left");
    expect(quotaNoticePush({ projectId: "p1", projectTitle: "Taller", percent: 80, sent: 800, included: 1000, noCredits: false })).toMatchObject({ body: "80% · 800 / 1000" });
  });
});
