// Shared plumbing for the visitor-facing members API (/api/m/[sub]/…).
//
// These endpoints run on the SITE's own host — Caddy proxies /api/m/* from
// the *.openlen.com wildcard, and the custom-domain block's /api/* pass-
// through covers them too — so the session cookie they set is first-party.
// Every response is no-store: there is no cacheable byte on this surface
// (and the Caddyfile's @doc matcher excludes /api/m/* so the origin header
// survives to Cloudflare).

import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Same slug shape lib/projects/site-pages.ts accepts.
export const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export function seeOther(location: string, setCookie?: string): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

export interface MemberSiteContext {
  projectId: string;
  userId: string;
  title: string;
  membersEnabled: boolean;
  membersMode: "open" | "invite";
  /** Preset «Cuentas»: login con contraseña habilitado. */
  membersPasswordLogin: boolean;
  /** Reservas module on — gates the bookings list in GET /me. */
  bookingsEnabled: boolean;
  /** Site language — drives the email + interstitial copy. */
  locale: string;
}

/** Resolve a published sub to its project + members settings in one query.
 *  Null = unknown subdomain (404 territory). */
export async function loadMemberSite(
  sub: string,
): Promise<MemberSiteContext | null> {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(sub)) return null;
  const rows = await db
    .select({
      projectId: schema.projects.id,
      userId: schema.projects.userId,
      title: schema.projects.title,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(eq(schema.projects.subdomain, sub))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const members = row.data?.settings?.members;
  return {
    projectId: row.projectId,
    userId: row.userId,
    title: row.title?.trim() || sub,
    membersEnabled: members?.enabled === true,
    membersMode: members?.mode === "invite" ? "invite" : "open",
    membersPasswordLogin: members?.passwordLogin === true,
    bookingsEnabled: row.data?.settings?.bookings?.enabled === true,
    locale: detectLang(row.data?.html ?? ""),
  };
}

function detectLang(html: string): string {
  const m = /<html[^>]*\blang=["']?([a-zA-Z-]{2,10})/.exec(html);
  return m ? m[1].slice(0, 2).toLowerCase() : "en";
}

/** The host the magic link should target. The request's Host header is
 *  attacker-influencable, so it only wins when it matches the site's OWN
 *  canonical host or one of its VERIFIED custom domains; anything else
 *  falls back to the canonical subdomain host. localhost is honored in dev
 *  so the printed magic link is clickable against the dev server. */
export async function memberLinkBase(
  req: Request,
  sub: string,
  projectId: string,
): Promise<string> {
  const baseHost = process.env.PUBLISH_BASE_HOST?.trim() || "openlen.com";
  const canonical = `https://${sub}.${baseHost}`;
  const host = req.headers.get("host")?.trim().toLowerCase() ?? "";
  if (!host) return canonical;
  if (host === `${sub}.${baseHost}`) return canonical;
  if (
    process.env.NODE_ENV !== "production" &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  ) {
    return `http://${host}`;
  }
  const domain = host.replace(/:\d+$/, "");
  const rows = await db
    .select({ id: schema.customDomains.id })
    .from(schema.customDomains)
    .where(
      and(
        eq(schema.customDomains.domain, domain),
        eq(schema.customDomains.projectId, projectId),
        isNotNull(schema.customDomains.verifiedAt),
      ),
    )
    .limit(1);
  return rows.length > 0 ? `https://${domain}` : canonical;
}
