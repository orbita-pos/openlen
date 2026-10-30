// What Len Watch needs to know of a project: whose it is (the owner gets the notices and pays for Len),
// where it is published, and the owner's language and clock — read, never asked, since nobody is
// around when a site goes down at 3 a.m.
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { loadPrefs } from "@/lib/notifications/dispatch";
import { urlDelChat } from "@/lib/notifications/channels/webpush";
import type { LenWatchEvent, LenWatchPhase } from "@/lib/notifications/types";
import { publishedUrl } from "@/lib/publish/base-host";

import { getSettings } from "./store";
import { lenWatchTexts } from "./texts";
import type { Incident } from "./types";

export interface ProjectForWatch {
  projectId: string;
  ownerId: string;
  title: string;
  subdomain: string | null;
  /** The published home; null = not published. */
  url: string | null;
  locale: string;
  timeZone: string;
}

const LOCALES = new Set(["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"]);

/** The page's own language (`<html lang="es">`), when it's one of ours. */
export function htmlLang(html: string | null | undefined): string | null {
  const m = /<html[^>]*\blang=["']?([a-zA-Z]{2})\b/i.exec(html ?? "");
  const l = m?.[1]?.toLowerCase() ?? null;
  return l && LOCALES.has(l) ? l : null;
}

export async function projectForWatch(projectId: string): Promise<ProjectForWatch | null> {
  const [row] = await db
    .select({ userId: schema.projects.userId, title: schema.projects.title, subdomain: schema.projects.subdomain, publishedAt: schema.projects.publishedAt, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row) return null;
  const [settings, prefs] = await Promise.all([getSettings(projectId), loadPrefs(row.userId)]);
  const subdomain = row.subdomain && row.publishedAt ? row.subdomain : null;
  return {
    projectId,
    ownerId: row.userId,
    title: row.title,
    subdomain,
    url: subdomain ? publishedOrigin(subdomain) : null,
    locale: settings.locale ?? htmlLang(row.data?.html) ?? "en",
    timeZone: prefs.timezone,
  };
}

/** OPENLEN_WATCH_PUBLISHED_ORIGIN: where Len Watch opens a published site INSTEAD of
 *  https://<sub>.<publish host> — a local or staging run, whose published pages aren't on the production
 *  domain (in a local dev without it, the check would open production's address). `{sub}` becomes the
 *  subdomain. Unset in production. */
function overrideOrigin(): string | null {
  return process.env.OPENLEN_WATCH_PUBLISHED_ORIGIN?.trim().replace(/\/+$/, "") || null;
}

function publishedOrigin(sub: string): string {
  const o = overrideOrigin();
  return o ? o.replace("{sub}", sub) : publishedUrl(sub);
}

/** The address of the page that was reported: a site page is `/<slug>/`, the home is the root. */
export function pageUrl(p: ProjectForWatch, page: string | null): string {
  return publishedOrigin(p.subdomain ?? "") + (page ? `/${page}/` : "");
}

/** With the override, our browser may open that (local) origin: the SSRF guard lets nothing private
 *  through otherwise. Without it, nothing is allowed beyond the public internet. */
export function allowedCheckOrigins(): string[] {
  const o = overrideOrigin();
  if (!o) return [];
  try {
    return [new URL(o.replace("{sub}", "x")).host];
  } catch {
    return [];
  }
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://openlen.com";
}

/** The notice for one phase of an incident, written in the owner's language. */
export function noticeFor(p: ProjectForWatch, incident: Incident, phase: LenWatchPhase, detail: string | null = null): LenWatchEvent {
  const texts = lenWatchTexts(phase, p.locale, {
    projectTitle: p.title,
    url: pageUrl(p, incident.sample.page),
    chatUrl: `${siteUrl()}${urlDelChat(p.projectId)}`,
    detail,
    shipsUnpublished: incident.shipsUnpublished,
    bringPending: incident.bringState === "pending",
  });
  return { type: "len_watch", projectId: p.projectId, recipientUserId: p.ownerId, incidentId: incident.id, phase, ...texts };
}

/** One notice per incident and phase: a phase repeated (a retry) never sends twice. */
export function noticeKey(e: LenWatchEvent): string {
  return `len-watch:${e.incidentId}:${e.phase}`;
}
