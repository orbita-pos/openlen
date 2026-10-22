// lib/project-email/notices.ts — WHAT THE PROJECT EMAIL ALERTS SAY (spec local
// 2026-10-22-email-integration, 6.1 and 6.6). Pure and LIGHT on purpose, like
// lib/app-ai/cap-messages.ts: the notifications drain is a cron bundle that
// imports it. The push carries no prose; the owner's email is in English, like
// the other owner alerts.

/** The project's Database view, where the Correos tab is. */
export function emailTabUrl(projectId: string): string {
  return `/new?project=${encodeURIComponent(projectId)}&view=database`;
}

export interface DomainNotice {
  readonly projectId: string;
  readonly projectTitle: string | null;
  readonly domain: string;
  readonly status: "ready" | "offline";
}

export function domainNoticePush(n: DomainNotice): { title: string; body: string; url: string } {
  const title = n.projectTitle?.trim();
  return { title: title ? `Email · ${title}` : "Email", body: `${n.domain} ${n.status === "ready" ? "✓" : "✗"}`, url: emailTabUrl(n.projectId) };
}

export function domainNoticeEmail(n: DomainNotice & { readonly siteUrl: string }): { subject: string; text: string } {
  const link = `${n.siteUrl}${emailTabUrl(n.projectId)}`;
  if (n.status === "ready") {
    return {
      subject: `${n.domain} is ready to send email`,
      text: ["Hi,", "", `Your domain ${n.domain} is verified: your project's emails now go out from it.`, "", `See it in your project: ${link}`].join("\n"),
    };
  }
  return {
    subject: `${n.domain} stopped sending email`,
    text: [
      "Hi,",
      "",
      `The DNS records of ${n.domain} no longer verify, so your project's emails stopped going out from it.`,
      "Meanwhile your sign-in emails go out from OpenLen, so nobody is locked out.",
      "Check that the records are still at your domain provider; the Correos tab shows them.",
      "",
      `See it in your project: ${link}`,
    ].join("\n"),
  };
}

export interface QuotaNotice {
  readonly projectId: string;
  readonly percent: 80 | 100;
  readonly sent: number;
  readonly included: number;
  readonly noCredits: boolean;
}

export function quotaNoticePush(n: QuotaNotice & { readonly projectTitle: string | null }): { title: string; body: string; url: string } {
  const title = n.projectTitle?.trim();
  return { title: title ? `Email · ${title}` : "Email", body: `${n.percent}% · ${n.sent} / ${n.included}`, url: emailTabUrl(n.projectId) };
}

export function quotaNoticeEmail(n: QuotaNotice & { readonly siteUrl: string }): { subject: string; text: string } {
  const link = `See it in your project: ${n.siteUrl}${emailTabUrl(n.projectId)}`;
  if (n.noCredits) {
    return {
      subject: "Your projects' emails stopped: no credits left",
      text: ["Hi,", "", `Your projects sent the ${n.included} emails included this month, and there are no credits left for more.`, "Their emails are refused until you add credits or the month ends; sign-in emails keep going out from OpenLen.", "", link].join("\n"),
    };
  }
  return {
    subject: `Your projects used ${n.percent}% of this month's emails`,
    text: [
      "Hi,",
      "",
      `Your projects have sent ${n.sent} of the ${n.included} emails included this month (${n.percent}%).`,
      "Past that, each email costs credits: 150 credits per 1,000.",
      "",
      link,
    ].join("\n"),
  };
}
