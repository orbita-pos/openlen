// lib/project-email/types.ts — THE SHAPES OF PROJECT EMAIL (spec local
// 2026-10-22-email-integration, §7): a project's sending domain, what was sent,
// who doesn't get more, and each owner's month. Pure.

export type EmailDomainStatus = "pending" | "verifying" | "ready" | "failed" | "offline";

/** One of the DNS records the owner puts at their provider (Resend's SPF and DKIM). */
export interface DnsRecord {
  readonly type: "TXT" | "MX";
  /** Relative to the root domain, as Resend gives it ("resend._domainkey.notify"). */
  readonly name: string;
  readonly value: string;
  readonly priority?: number;
}

export interface EmailDomainRow {
  readonly projectId: string;
  readonly domain: string;
  readonly sendingHost: string;
  readonly showAsRoot: boolean;
  readonly resendDomainId: string;
  readonly records: readonly DnsRecord[];
  readonly status: EmailDomainStatus;
  readonly lastCheckedAt: Date | null;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
}

export type EmailKind = "app" | "auth" | "form";
export type EmailMessageStatus = "sent" | "delivered" | "bounced" | "complained" | "rejected" | "not_sent_draft";

/** One recipient of one email: what the Correos tab lists. Never the body. */
export interface EmailMessageRow {
  readonly id: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly environment: "draft" | "live";
  readonly kind: EmailKind;
  readonly toAddress: string;
  readonly subject: string;
  readonly status: EmailMessageStatus;
  readonly reason: string | null;
  readonly resendId: string | null;
  /** The form's key for a form reply; null otherwise. */
  readonly tag: string | null;
  readonly createdAt: Date;
}

export type SuppressionReason = "unsubscribed" | "bounced" | "complained";

export interface EmailStore {
  getDomain(projectId: string): Promise<EmailDomainRow | null>;
  domainByHost(sendingHost: string): Promise<EmailDomainRow | null>;
  /** Creates or replaces the project's row; throws when another project has the host. */
  putDomain(row: Omit<EmailDomainRow, "createdAt">): Promise<void>;
  /** `at` is when it was checked; the first `ready` also stamps `verifiedAt`. */
  setDomainStatus(projectId: string, status: EmailDomainStatus, at: Date): Promise<void>;
  deleteDomain(projectId: string): Promise<void>;
  /** The ones the timer looks at: pending, verifying, ready and offline. */
  domainsToCheck(): Promise<EmailDomainRow[]>;
  logMessage(row: Omit<EmailMessageRow, "id" | "createdAt">): Promise<string>;
  setStatusByResendId(resendId: string, status: EmailMessageStatus, reason: string | null): Promise<{ projectId: string; toAddress: string } | null>;
  /** Newest first. */
  recentMessages(projectId: string, limit: number): Promise<EmailMessageRow[]>;
  deleteMessagesBefore(date: Date): Promise<number>;
  /** What went out (sent, delivered, bounced, complained) for an owner since a moment: the hourly cap. */
  countSentSince(ownerId: string, kind: "app" | "auth", since: Date): Promise<number>;
  /** What went out for a project, narrowed: the form replies' brakes. */
  countMessages(f: { readonly projectId: string; readonly kind: EmailKind; readonly toAddress?: string; readonly tag?: string; readonly since: Date }): Promise<number>;
  /** An unsubscribe stops app and form emails; a bounce or a complaint stops all three. */
  isSuppressed(projectId: string, address: string, kind: EmailKind): Promise<boolean>;
  suppress(projectId: string, address: string, reason: SuppressionReason): Promise<void>;
  unsuppress(projectId: string, address: string): Promise<void>;
  listSuppressions(projectId: string): Promise<{ address: string; reason: SuppressionReason; createdAt: Date }[]>;
  /** Adds and returns the new total of the owner's month ("YYYY-MM"). */
  addUsage(ownerId: string, month: string, n: number): Promise<number>;
  usage(ownerId: string, month: string): Promise<number>;
  isBlocked(projectId: string, ownerId: string): Promise<boolean>;
  block(scope: "project" | "owner", id: string, reason: string): Promise<void>;
  unblock(scope: "project" | "owner", id: string): Promise<void>;
}

/** How an address is compared everywhere: no spaces around, lower case. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** The statuses that mean the email went out (what counts for caps and brakes). */
export const WENT_OUT: readonly EmailMessageStatus[] = ["sent", "delivered", "bounced", "complained"];
