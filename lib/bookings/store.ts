// Booking storage — services (with their availability rules) + bookings + an
// audit log. Mirrors the broadcast/comments stores: per-project rows, callers
// verify ownership, single-statement guards (Neon HTTP forbids interactive
// transactions — lib/db). The no-double-booking guarantee is the DB partial
// unique index bookings_slot_uq, reached here through onConflictDoNothing.

import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type {
  BookingException,
  BusyInterval,
  DayRange,
  Weekday,
} from "@/lib/bookings/availability";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

const LIVE: BookingStatus[] = ["confirmed", "pending"];

export interface ServiceRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  durationMin: number;
  slotIncrementMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minLeadTimeMin: number;
  maxDaysAhead: number;
  creatorTz: string;
  weeklyHours: Partial<Record<Weekday, DayRange[]>>;
  exceptions: BookingException[];
  capacity: number;
  priceDisplay: string | null;
  locationText: string | null;
  status: "active" | "archived";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingRow {
  id: string;
  projectId: string;
  serviceId: string;
  startUtc: Date;
  endUtc: Date;
  seatNo: number;
  status: BookingStatus;
  memberId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  note: string | null;
  creatorTz: string;
  visitorTz: string | null;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  reminderStage: number;
  icsSequence: number;
  cancelledAt: Date | null;
  createdAt: Date;
}

// ─── Services (owner CRUD + public read) ─────────────────────────────────────

function rowToService(r: typeof schema.bookableServices.$inferSelect): ServiceRow {
  return {
    ...r,
    weeklyHours: (r.weeklyHours ?? {}) as Partial<Record<Weekday, DayRange[]>>,
    exceptions: (r.exceptions ?? []) as BookingException[],
  };
}

export async function listServices(
  projectId: string,
  opts?: { includeArchived?: boolean },
): Promise<ServiceRow[]> {
  const filters = [eq(schema.bookableServices.projectId, projectId)];
  if (!opts?.includeArchived) {
    filters.push(eq(schema.bookableServices.status, "active"));
  }
  const rows = await db
    .select()
    .from(schema.bookableServices)
    .where(and(...filters))
    .orderBy(asc(schema.bookableServices.sortOrder), asc(schema.bookableServices.createdAt));
  return rows.map(rowToService);
}

export async function getService(
  projectId: string,
  serviceId: string,
): Promise<ServiceRow | null> {
  const rows = await db
    .select()
    .from(schema.bookableServices)
    .where(
      and(
        eq(schema.bookableServices.id, serviceId),
        eq(schema.bookableServices.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ? rowToService(rows[0]) : null;
}

export interface ServiceInput {
  name: string;
  description?: string | null;
  durationMin: number;
  slotIncrementMin?: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minLeadTimeMin?: number;
  maxDaysAhead?: number;
  creatorTz: string;
  weeklyHours: Partial<Record<Weekday, DayRange[]>>;
  exceptions?: BookingException[];
  capacity?: number;
  priceDisplay?: string | null;
  locationText?: string | null;
  sortOrder?: number;
}

export async function createService(
  projectId: string,
  input: ServiceInput,
): Promise<ServiceRow> {
  const rows = await db
    .insert(schema.bookableServices)
    .values({
      projectId,
      name: input.name,
      description: input.description ?? null,
      durationMin: input.durationMin,
      slotIncrementMin: input.slotIncrementMin ?? 0,
      bufferBeforeMin: input.bufferBeforeMin ?? 0,
      bufferAfterMin: input.bufferAfterMin ?? 0,
      minLeadTimeMin: input.minLeadTimeMin ?? 0,
      maxDaysAhead: input.maxDaysAhead ?? 30,
      creatorTz: input.creatorTz,
      weeklyHours: input.weeklyHours,
      exceptions: input.exceptions ?? [],
      capacity: input.capacity ?? 1,
      priceDisplay: input.priceDisplay ?? null,
      locationText: input.locationText ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return rowToService(rows[0]);
}

export async function updateService(
  projectId: string,
  serviceId: string,
  patch: Partial<ServiceInput>,
): Promise<ServiceRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    "name",
    "description",
    "durationMin",
    "slotIncrementMin",
    "bufferBeforeMin",
    "bufferAfterMin",
    "minLeadTimeMin",
    "maxDaysAhead",
    "creatorTz",
    "weeklyHours",
    "exceptions",
    "capacity",
    "priceDisplay",
    "locationText",
    "sortOrder",
  ] as const) {
    if (k in patch && patch[k] !== undefined) set[k] = patch[k];
  }
  const rows = await db
    .update(schema.bookableServices)
    .set(set)
    .where(
      and(
        eq(schema.bookableServices.id, serviceId),
        eq(schema.bookableServices.projectId, projectId),
      ),
    )
    .returning();
  return rows[0] ? rowToService(rows[0]) : null;
}

/** Archive (soft-delete) — keeps existing bookings + audit intact. */
export async function archiveService(
  projectId: string,
  serviceId: string,
): Promise<boolean> {
  const rows = await db
    .update(schema.bookableServices)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(schema.bookableServices.id, serviceId),
        eq(schema.bookableServices.projectId, projectId),
      ),
    )
    .returning({ id: schema.bookableServices.id });
  return rows.length > 0;
}

// ─── Availability inputs ─────────────────────────────────────────────────────

/** Live bookings for a service overlapping [rangeStartUtc, rangeEndUtc], shaped
 *  for the availability engine. Widen the query window by the day on each side
 *  so a slot near the edge still sees an adjacent booking's buffer. */
export async function getBusyIntervals(
  serviceId: string,
  rangeStartUtcMs: number,
  rangeEndUtcMs: number,
): Promise<BusyInterval[]> {
  // Widen by 2 days each side: a service buffer can be up to 24h before AND
  // after, so a booking up to ~48h outside the window can still block an
  // in-window candidate via subtractBusy. A 1-day pad would miss those.
  const PAD = 2 * 86400000;
  const lo = new Date(rangeStartUtcMs - PAD);
  const hi = new Date(rangeEndUtcMs + PAD);
  const rows = await db
    .select({ startUtc: schema.bookings.startUtc, endUtc: schema.bookings.endUtc })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.serviceId, serviceId),
        inArray(schema.bookings.status, LIVE),
        lt(schema.bookings.startUtc, hi),
        gt(schema.bookings.endUtc, lo),
      ),
    );
  return rows.map((r) => ({
    startUtcMs: r.startUtc.getTime(),
    endUtcMs: r.endUtc.getTime(),
  }));
}

// ─── Booking lifecycle ───────────────────────────────────────────────────────

export interface NewBookingInput {
  id: string; // CLIENT-GENERATED — idempotency key
  projectId: string;
  serviceId: string;
  startUtc: Date;
  endUtc: Date;
  seatNo?: number;
  status: "pending" | "confirmed";
  memberId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  note?: string | null;
  creatorTz: string;
  visitorTz?: string | null;
  rescheduledFromId?: string | null;
  icsSequence?: number;
}

export type ClaimResult =
  | { ok: true; booking: BookingRow; replay: boolean }
  | { ok: false; reason: "slot_taken" };

/** Atomically claim a slot. ON CONFLICT DO NOTHING covers BOTH unique
 *  constraints — the slot guard AND the client-id PK — in one statement (Neon
 *  HTTP has no transactions). If nothing inserts we disambiguate by id:
 *    • a row with this id exists → idempotent replay of a retried POST → success
 *    • otherwise → the slot guard swallowed it → the instant is taken. */
export async function claimBookingSlot(
  input: NewBookingInput,
): Promise<ClaimResult> {
  const rows = await db
    .insert(schema.bookings)
    .values({
      id: input.id,
      projectId: input.projectId,
      serviceId: input.serviceId,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      seatNo: input.seatNo ?? 0,
      status: input.status,
      memberId: input.memberId ?? null,
      guestName: input.guestName ?? null,
      guestEmail: input.guestEmail ? input.guestEmail.trim().toLowerCase() : null,
      note: input.note ?? null,
      creatorTz: input.creatorTz,
      visitorTz: input.visitorTz ?? null,
      rescheduledFromId: input.rescheduledFromId ?? null,
      icsSequence: input.icsSequence ?? 0,
    })
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return { ok: true, booking: rows[0] as BookingRow, replay: false };

  const existing = await getBookingById(input.id);
  if (existing) return { ok: true, booking: existing, replay: true };
  return { ok: false, reason: "slot_taken" };
}

export async function getBookingById(id: string): Promise<BookingRow | null> {
  const rows = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, id))
    .limit(1);
  return (rows[0] as BookingRow | undefined) ?? null;
}

export async function getBooking(
  projectId: string,
  bookingId: string,
): Promise<BookingRow | null> {
  const b = await getBookingById(bookingId);
  return b && b.projectId === projectId ? b : null;
}

/** Cancel from a LIVE state only (idempotent: already-cancelled → null). Bumps
 *  icsSequence so a CANCEL .ics supersedes the prior invite. Returns the row
 *  iff it actually transitioned, so the caller knows whether to email.
 *  `rescheduledToId` (reschedule path) is written in the SAME guarded UPDATE so
 *  freeing the old slot and linking it to the new one is one atomic statement. */
export async function cancelBooking(
  projectId: string,
  bookingId: string,
  rescheduledToId?: string,
): Promise<BookingRow | null> {
  const rows = await db
    .update(schema.bookings)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      icsSequence: sql`${schema.bookings.icsSequence} + 1`,
      ...(rescheduledToId ? { rescheduledToId } : {}),
    })
    .where(
      and(
        eq(schema.bookings.id, bookingId),
        eq(schema.bookings.projectId, projectId),
        inArray(schema.bookings.status, LIVE),
      ),
    )
    .returning();
  return (rows[0] as BookingRow | undefined) ?? null;
}

/** Owner status transition (confirm a pending, mark completed/no_show). Guarded
 *  by `from` so it only fires from an expected prior state. */
export async function setBookingStatus(
  projectId: string,
  bookingId: string,
  to: BookingStatus,
  from: BookingStatus[],
): Promise<BookingRow | null> {
  const rows = await db
    .update(schema.bookings)
    .set({ status: to, ...(to === "cancelled" ? { cancelledAt: new Date() } : {}) })
    .where(
      and(
        eq(schema.bookings.id, bookingId),
        eq(schema.bookings.projectId, projectId),
        inArray(schema.bookings.status, from),
      ),
    )
    .returning();
  return (rows[0] as BookingRow | undefined) ?? null;
}

export type RescheduleResult =
  | { ok: true; booking: BookingRow; old: BookingRow }
  | { ok: false; reason: "not_found" | "not_active" | "slot_taken" };

/** Reschedule = claim-the-new-slot FIRST, then cancel the old. Erring toward a
 *  brief double-HOLD is safe; a double-BOOK is not. Identity (member/guest/tz)
 *  is copied from the old booking; icsSequence carries forward (+1). */
export async function rescheduleBooking(
  projectId: string,
  oldBookingId: string,
  next: { newId: string; startUtc: Date; endUtc: Date; visitorTz?: string | null },
): Promise<RescheduleResult> {
  const old = await getBooking(projectId, oldBookingId);
  if (!old) return { ok: false, reason: "not_found" };
  if (!LIVE.includes(old.status)) return { ok: false, reason: "not_active" };

  // No-op reschedule to the same instant — don't collide with the row's own
  // live slot lock; just return it unchanged.
  if (old.startUtc.getTime() === next.startUtc.getTime()) {
    return { ok: true, booking: old, old };
  }

  const claim = await claimBookingSlot({
    id: next.newId,
    projectId,
    serviceId: old.serviceId,
    startUtc: next.startUtc,
    endUtc: next.endUtc,
    seatNo: old.seatNo,
    status: old.status === "confirmed" ? "confirmed" : "pending",
    memberId: old.memberId,
    guestName: old.guestName,
    guestEmail: old.guestEmail,
    note: old.note,
    creatorTz: old.creatorTz,
    visitorTz: next.visitorTz ?? old.visitorTz,
    rescheduledFromId: old.id,
    icsSequence: old.icsSequence + 1,
  });
  if (!claim.ok) return { ok: false, reason: "slot_taken" };

  // New slot held — free the old AND link it in ONE guarded UPDATE (cancel +
  // rescheduledToId together), collapsing the prior two-statement window. If
  // the owner cancelled `old` in the race gap, this matches nothing (null) and
  // no stale link is written — the new booking still stands.
  await cancelBooking(projectId, old.id, claim.booking.id);

  return { ok: true, booking: claim.booking, old };
}

// ─── Owner reads + counts ────────────────────────────────────────────────────

const BOOKING_LIST_LIMIT = 500;

export async function listBookings(
  projectId: string,
  opts?: {
    status?: BookingStatus[];
    serviceId?: string;
    fromUtc?: Date;
    toUtc?: Date;
  },
): Promise<BookingRow[]> {
  const filters = [eq(schema.bookings.projectId, projectId)];
  if (opts?.status?.length) filters.push(inArray(schema.bookings.status, opts.status));
  if (opts?.serviceId) filters.push(eq(schema.bookings.serviceId, opts.serviceId));
  if (opts?.fromUtc) filters.push(gt(schema.bookings.startUtc, opts.fromUtc));
  if (opts?.toUtc) filters.push(lt(schema.bookings.startUtc, opts.toUtc));
  const rows = await db
    .select()
    .from(schema.bookings)
    .where(and(...filters))
    .orderBy(desc(schema.bookings.startUtc))
    .limit(BOOKING_LIST_LIMIT);
  return rows as BookingRow[];
}

/** Live bookings (confirmed/pending) made on this project since a timestamp —
 *  feeds the per-site monthly cap (BOOKING_MONTHLY_CAP). */
export async function countBookingsSince(
  projectId: string,
  sinceUtc: Date,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.projectId, projectId),
        inArray(schema.bookings.status, LIVE),
        gt(schema.bookings.createdAt, sinceUtc),
      ),
    );
  return rows[0]?.n ?? 0;
}

// ─── Reminder sweep (systemd timer) ──────────────────────────────────────────

/** Confirmed bookings starting in (now, withinUtc] that haven't been reminded
 *  yet (reminderStage 0). Global across projects — the timer filters by each
 *  site's sendReminders flag. */
export async function listDueReminders(
  nowUtc: Date,
  withinUtc: Date,
  limit = 500,
): Promise<BookingRow[]> {
  const rows = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        eq(schema.bookings.reminderStage, 0),
        gt(schema.bookings.startUtc, nowUtc),
        lt(schema.bookings.startUtc, withinUtc),
      ),
    )
    .orderBy(asc(schema.bookings.startUtc))
    .limit(limit);
  return rows as BookingRow[];
}

/** Atomically claim a reminder stage (0→1). Only the run that flips it returns
 *  true → exactly-once send even if two timer fires overlap. */
export async function claimReminder(bookingId: string, toStage = 1): Promise<boolean> {
  const rows = await db
    .update(schema.bookings)
    .set({ reminderStage: toStage })
    .where(
      and(
        eq(schema.bookings.id, bookingId),
        eq(schema.bookings.reminderStage, toStage - 1),
      ),
    )
    .returning({ id: schema.bookings.id });
  return rows.length > 0;
}

/** Distinct project ids that have any booking row — drives the retention sweep. */
export async function listProjectIdsWithBookings(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ projectId: schema.bookings.projectId })
    .from(schema.bookings);
  return rows.map((r) => r.projectId);
}

// ─── Audit + housekeeping ────────────────────────────────────────────────────

/** Append-only audit. Best-effort — never fail the action it describes. */
export async function recordBookingEvent(
  projectId: string,
  bookingId: string,
  type: string,
  actor: "visitor" | "owner" | "system",
  detail?: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(schema.bookingEvents)
    .values({ projectId, bookingId, type, actor, detail: detail ?? null })
    .catch(() => {});
}

/** GDPR retention sweep — delete bookings whose slot ended before the cutoff.
 *  Past, finished rows only; live future bookings are never touched. */
export async function deleteBookingsEndedBefore(
  projectId: string,
  cutoffUtc: Date,
): Promise<number> {
  const rows = await db
    .delete(schema.bookings)
    .where(
      and(
        eq(schema.bookings.projectId, projectId),
        lt(schema.bookings.endUtc, cutoffUtc),
      ),
    )
    .returning({ id: schema.bookings.id });
  return rows.length;
}
