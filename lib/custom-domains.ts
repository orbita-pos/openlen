import "server-only";

import { randomBytes } from "node:crypto";
import { promises as dnsPromises } from "node:dns";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Custom domains — user-owned hostnames that point at an OpenLen project.
//
// The lifecycle is three discrete states:
//
//   claim      — row inserted, verifiedAt null. User shown DNS instructions.
//   verified   — TXT challenge passed, verifiedAt set. Caddy will auto-issue
//                a Let's Encrypt cert on the next handshake to this host.
//   released   — row deleted. Cert lingers in Caddy's storage until it
//                expires; no traffic reaches the project.
//
// The Caddy `on_demand_tls.ask` endpoint hits `lookupDomain` — it ONLY
// returns "OK, issue a cert" when verifiedAt is non-null. Without the
// gate, anyone could point a DNS record at our IP and force us to attempt
// (and rate-limit-burn) cert issuance for arbitrary hostnames.
// ─────────────────────────────────────────────────────────────────────────────

// Hostnames we never let a user claim — reserved for the platform itself.
// Suffix match; the leading dot is required so `myopenlen.com` doesn't match.
const RESERVED_HOST_SUFFIXES = [
  ".openlen.com",
  ".inari.watch",
  ".inariwatch.com",
];

const RESERVED_EXACT_HOSTS = new Set([
  "openlen.com",
  "www.openlen.com",
  "templates.openlen.com",
  "images.openlen.com",
  "uploads.openlen.com",
  "inari.watch",
  "www.inari.watch",
  "inariwatch.com",
  "www.inariwatch.com",
  "localhost",
]);

// RFC 1123 hostname — labels are 1–63 chars of [a-z0-9-], can't start or end
// with hyphen. Full name is ≤253 chars. We require at least one dot (TLD).
const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type DomainValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/** Normalize + validate a hostname for use as a custom domain. */
export function validateDomain(input: string): DomainValidationResult {
  if (typeof input !== "string") return { ok: false, reason: "not a string" };
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return { ok: false, reason: "empty" };
  // Strip protocol + path if the user pasted a URL.
  const noProto = trimmed.replace(/^https?:\/\//, "").split("/")[0];
  const noPort = noProto.split(":")[0];
  if (!HOSTNAME_RE.test(noPort)) {
    return { ok: false, reason: "not a valid hostname" };
  }
  if (RESERVED_EXACT_HOSTS.has(noPort)) {
    return { ok: false, reason: "reserved hostname" };
  }
  for (const suffix of RESERVED_HOST_SUFFIXES) {
    if (noPort.endsWith(suffix)) {
      return { ok: false, reason: `reserved suffix (${suffix})` };
    }
  }
  return { ok: true, value: noPort };
}

function generateVerificationToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface CustomDomainRecord {
  id: string;
  projectId: string;
  domain: string;
  verificationToken: string;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClaimResult =
  | { ok: true; record: CustomDomainRecord }
  | { ok: false; reason: "invalid" | "taken"; detail: string };

/** Claim `domain` for `projectId`. If the same project already claimed it,
 *  returns the existing row (idempotent). If another project owns it, fails. */
export async function claimDomain(params: {
  projectId: string;
  domain: string;
}): Promise<ClaimResult> {
  const v = validateDomain(params.domain);
  if (!v.ok) return { ok: false, reason: "invalid", detail: v.reason };
  const domain = v.value;

  const existing = await db
    .select()
    .from(schema.customDomains)
    .where(eq(schema.customDomains.domain, domain))
    .limit(1);
  const prior = existing[0];
  if (prior) {
    if (prior.projectId === params.projectId) {
      return { ok: true, record: rowToRecord(prior) };
    }
    return {
      ok: false,
      reason: "taken",
      detail: "this domain is already claimed by another project",
    };
  }

  const token = generateVerificationToken();
  const inserted = await db
    .insert(schema.customDomains)
    .values({
      projectId: params.projectId,
      domain,
      verificationToken: token,
    })
    .returning();
  if (!inserted[0]) {
    return { ok: false, reason: "taken", detail: "insert failed" };
  }
  return { ok: true, record: rowToRecord(inserted[0]) };
}

/** Remove a domain claim. Scoped to the project so one user can't release
 *  another user's domain by guessing it. Idempotent — deleting a non-
 *  existent row is a no-op. */
export async function releaseDomain(params: {
  projectId: string;
  domain: string;
}): Promise<{ ok: true }> {
  const v = validateDomain(params.domain);
  if (!v.ok) return { ok: true };
  await db
    .delete(schema.customDomains)
    .where(
      and(
        eq(schema.customDomains.projectId, params.projectId),
        eq(schema.customDomains.domain, v.value),
      ),
    );
  return { ok: true };
}

export type VerifyResult =
  | { ok: true; record: CustomDomainRecord }
  | { ok: false; reason: "not-found" | "txt-missing" | "txt-mismatch" | "dns-error"; detail: string };

/** Resolve `_openlen-challenge.<domain>` TXT records and look for one
 *  whose value matches the row's verificationToken. On success, flip
 *  verifiedAt to now. */
export async function verifyDomain(params: {
  projectId: string;
  domain: string;
}): Promise<VerifyResult> {
  const v = validateDomain(params.domain);
  if (!v.ok) return { ok: false, reason: "not-found", detail: v.reason };
  const domain = v.value;

  const rows = await db
    .select()
    .from(schema.customDomains)
    .where(
      and(
        eq(schema.customDomains.projectId, params.projectId),
        eq(schema.customDomains.domain, domain),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, reason: "not-found", detail: "no claim for this project" };
  }

  const challengeHost = `_openlen-challenge.${domain}`;
  let records: string[][];
  try {
    records = await dnsPromises.resolveTxt(challengeHost);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "UNKNOWN";
    // Treat every DNS failure as "TXT not yet present" except for an
    // outright resolver bug (where the resolver itself is broken). This
    // is the user-friendly default — most of the time the TXT just isn't
    // propagated yet, and a generic "DNS error" message confuses them.
    // Node's resolver on Windows/Linux can return ENOTFOUND, ENODATA,
    // EREFUSED, ENXDOMAIN, or even unmapped codes depending on the OS
    // and which upstream server answered — collapse them all here.
    const transientErrors = new Set(["ESERVFAIL", "ETIMEOUT", "EAI_AGAIN"]);
    if (transientErrors.has(code)) {
      return {
        ok: false,
        reason: "dns-error",
        detail: `${code}: DNS resolver returned an error. Try again in a moment.`,
      };
    }
    return {
      ok: false,
      reason: "txt-missing",
      detail: `No TXT record at ${challengeHost} yet (${code}). Make sure you added it at your DNS provider and waited for propagation (~1–5 min).`,
    };
  }

  // Each record is an array of strings (TXT records can be split into multiple
  // strings by the resolver — we join them to compare the full value).
  const found = records.some((parts) => parts.join("") === row.verificationToken);
  if (!found) {
    return {
      ok: false,
      reason: "txt-mismatch",
      detail: `TXT record present but value doesn't match — re-copy the token`,
    };
  }

  const now = new Date();
  const updated = await db
    .update(schema.customDomains)
    .set({ verifiedAt: now, updatedAt: now })
    .where(eq(schema.customDomains.id, row.id))
    .returning();
  if (!updated[0]) {
    return { ok: false, reason: "dns-error", detail: "row vanished after verify" };
  }
  return { ok: true, record: rowToRecord(updated[0]) };
}

/** Resolve a host to its claimed project. Used by:
 *    - Caddy's on_demand_tls `ask` endpoint (gates cert issuance)
 *    - the /_custom/[host] serve route (resolves to the on-disk file path)
 *
 *  Returns null when the host is unclaimed or not yet verified. The
 *  verified gate is the security-critical part — without it, anyone with
 *  DNS control could trigger cert issuance attempts (which burn LE quota). */
export async function lookupDomain(
  host: string,
): Promise<{ projectId: string; subdomain: string | null; verified: boolean } | null> {
  const v = validateDomain(host);
  if (!v.ok) return null;
  const rows = await db
    .select({
      projectId: schema.customDomains.projectId,
      verifiedAt: schema.customDomains.verifiedAt,
      subdomain: schema.projects.subdomain,
    })
    .from(schema.customDomains)
    .innerJoin(
      schema.projects,
      eq(schema.customDomains.projectId, schema.projects.id),
    )
    .where(eq(schema.customDomains.domain, v.value))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    projectId: row.projectId,
    subdomain: row.subdomain,
    verified: row.verifiedAt !== null,
  };
}

/** Domains claimed by a given project. Used by the workspace UI to list
 *  current claims with verification status. */
export async function listDomainsForProject(
  projectId: string,
): Promise<CustomDomainRecord[]> {
  const rows = await db
    .select()
    .from(schema.customDomains)
    .where(eq(schema.customDomains.projectId, projectId))
    .orderBy(schema.customDomains.createdAt);
  return rows.map(rowToRecord);
}

function rowToRecord(
  row: typeof schema.customDomains.$inferSelect,
): CustomDomainRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    domain: row.domain,
    verificationToken: row.verificationToken,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
