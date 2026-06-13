// Shared plumbing for the visitor-facing bookings API (/api/bk/[sub]/…).
// Same-host (so the host-only ol_member cookie is first-party), every response
// no-store. Mirrors app/api/cm/[sub]/_shared.ts.

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { readMemberCookie } from "@/lib/members/session";
import { getMemberById, getMemberSession } from "@/lib/members/store";

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export interface BookingsSite {
  projectId: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  bookingsEnabled: boolean;
  requireLogin: boolean;
  autoConfirm: boolean;
  sendReminders: boolean;
  /** The site's primary language (from <html lang>), for transactional email. */
  locale: string;
  subdomain: string;
}

/** Two-letter site language from the home document's <html lang>, default en. */
export function localeFromHtml(html: string | undefined | null): string {
  const m = html ? /<html[^>]*\blang=["']?([a-zA-Z]{2})/i.exec(html) : null;
  return m ? m[1].toLowerCase() : "en";
}

/** Resolve a published sub → its project + the bookings switches + the owner's
 *  contact (for creator emails) in one query. Null = unknown subdomain. */
export async function loadBookingsSite(sub: string): Promise<BookingsSite | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  const rows = await db
    .select({
      projectId: schema.projects.id,
      ownerUserId: schema.projects.userId,
      data: schema.projects.data,
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
    })
    .from(schema.projects)
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(eq(schema.projects.subdomain, sub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const b = row.data?.settings?.bookings;
  const membersOn = row.data?.settings?.members?.enabled === true;
  return {
    projectId: row.projectId,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail ?? null,
    ownerName: row.ownerName ?? null,
    bookingsEnabled: b?.enabled === true,
    // require-login depends on the members module — without it there's no way
    // to log in, so a stale requireLogin would make the site unbookable. Treat
    // it as off (guests allowed) whenever members is off. Defense in depth:
    // reconcileModuleSettings already normalizes this on write.
    requireLogin: b?.requireLogin === true && membersOn,
    autoConfirm: b?.autoConfirm !== false, // default ON
    sendReminders: b?.sendReminders !== false, // default ON
    locale: localeFromHtml(row.data?.html),
    subdomain: sub,
  };
}

export interface MemberIdentity {
  memberId: string;
  name: string | null;
  email: string;
}

/** Resolve the ol_member session against THIS project, returning the active
 *  member or null. Mirrors the comments/protected-page identity check. */
export async function resolveMember(
  req: Request,
  projectId: string,
): Promise<MemberIdentity | null> {
  const cookie = readMemberCookie(req);
  const session = cookie ? await getMemberSession(cookie) : null;
  if (!session || session.projectId !== projectId) return null;
  const member = await getMemberById(session.memberId);
  if (!member || member.status !== "active") return null;
  return { memberId: member.id, name: member.name, email: member.email };
}

/** The site's external base URL (https://<host>), rebuilt from forwarding
 *  headers — req.url leaks 127.0.0.1:3000 behind Caddy. Used for manage links. */
export function siteBaseUrl(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}
