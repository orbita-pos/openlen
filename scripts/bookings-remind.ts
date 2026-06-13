// Booking reminders + GDPR retention sweep. Run by openlen-bookings-remind.timer
// every 15 min. Idempotent: each reminder is claimed atomically (reminderStage
// 0→1) so overlapping fires send exactly once.
//
// Run: npm run bookings:remind
//
//   1. Reminder pass — confirmed bookings starting in the next 24h that haven't
//      been reminded → email the visitor (if the site has reminders on) → claim.
//   2. Retention pass (once/day, ~04:xx UTC) — delete bookings whose slot ended
//      more than the site's retentionDays ago (default 365; 0 = never).
//
// Failures surface to systemd's journal; the timer fires again in 15 min.

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  claimReminder,
  deleteBookingsEndedBefore,
  listDueReminders,
  listProjectIdsWithBookings,
} from "@/lib/bookings/store";
import { notifyBooking } from "@/lib/bookings/notify";
import type { ProjectData } from "@/lib/projects/types";

const REMIND_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 365;

function localeFromHtml(html: string | undefined | null): string {
  const m = html ? /<html[^>]*\blang=["']?([a-zA-Z]{2})/i.exec(html) : null;
  return m ? m[1].toLowerCase() : "en";
}

interface SiteCtx {
  subdomain: string | null;
  data: ProjectData;
  ownerEmail: string | null;
  ownerName: string | null;
}

async function loadSites(projectIds: string[]): Promise<Map<string, SiteCtx>> {
  const map = new Map<string, SiteCtx>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
      ownerEmail: schema.users.email,
      ownerName: schema.users.name,
    })
    .from(schema.projects)
    .leftJoin(schema.users, eq(schema.users.id, schema.projects.userId))
    .where(inArray(schema.projects.id, projectIds));
  for (const r of rows) {
    map.set(r.id, {
      subdomain: r.subdomain,
      data: r.data,
      ownerEmail: r.ownerEmail ?? null,
      ownerName: r.ownerName ?? null,
    });
  }
  return map;
}

async function reminderPass(): Promise<void> {
  const now = new Date();
  const within = new Date(now.getTime() + REMIND_WINDOW_MS);
  const due = await listDueReminders(now, within);
  if (due.length === 0) {
    console.log("reminders: none due");
    return;
  }
  const sites = await loadSites([...new Set(due.map((b) => b.projectId))]);

  let sent = 0;
  for (const b of due) {
    const site = sites.get(b.projectId);
    if (!site || !site.subdomain) continue;
    const settings = site.data?.settings?.bookings;
    if (settings?.enabled !== true) continue;
    if (settings?.sendReminders === false) continue;
    if (!b.guestEmail) continue;

    // Claim FIRST — if another run already took it, skip the send.
    const claimed = await claimReminder(b.id, 1);
    if (!claimed) continue;

    const serviceRows = await db
      .select({ name: schema.bookableServices.name, description: schema.bookableServices.description, locationText: schema.bookableServices.locationText })
      .from(schema.bookableServices)
      .where(eq(schema.bookableServices.id, b.serviceId))
      .limit(1);
    const svc = serviceRows[0];

    await notifyBooking({
      kind: "reminder",
      booking: b,
      serviceName: svc?.name ?? "Booking",
      serviceDescription: svc?.description ?? null,
      locationText: svc?.locationText ?? null,
      sub: site.subdomain,
      baseUrl: `https://${site.subdomain}.openlen.com`,
      locale: localeFromHtml(site.data?.html),
      ownerEmail: site.ownerEmail,
      ownerName: site.ownerName,
      notifyCreator: false,
    });
    sent++;
  }
  console.log(`reminders: ${sent} sent / ${due.length} due`);
}

async function retentionPass(): Promise<void> {
  // Run the destructive sweep at most once per day (~04:xx UTC) — the 15-min
  // reminder cadence shouldn't re-scan deletes every fire.
  if (new Date().getUTCHours() !== 4) {
    return;
  }
  const projectIds = await listProjectIdsWithBookings();
  const sites = await loadSites(projectIds);
  let deleted = 0;
  for (const pid of projectIds) {
    const days = sites.get(pid)?.data?.settings?.bookings?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    if (!days || days <= 0) continue; // 0 = never
    const cutoff = new Date(Date.now() - days * DAY_MS);
    deleted += await deleteBookingsEndedBefore(pid, cutoff);
  }
  console.log(`retention: ${deleted} old bookings purged`);
}

async function main() {
  await reminderPass();
  await retentionPass();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
