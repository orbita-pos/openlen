// THE NINE CALENDAR TOOLS (spec local 2026-11-24-servidor-de-google-calendar, §5.3). Google's own names and argument names
// (what the model has seen, and what lets OpenLen go back to Google's server by changing one URL), our own descriptions,
// and every schema inline: each nested shape is built by a function so no instance is reused — a reused instance is
// what turns into a `$ref`, which the connector review drops (`reviewTools`). Left out on purpose: Drive attachments
// (they would need Drive scopes), working locations and special event types.
import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/server";
import { Temporal } from "@js-temporal/polyfill";
import * as z from "zod4";

import { calendarApi, GoogleApiError, type CalendarApi } from "./calendar-api";
import { freeSlots } from "./suggest-time";
import { eventTime, hasOffset, toRfc3339 } from "./time";
import { forgetGoogleToken } from "./token";

type Json = Record<string, unknown>;
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export interface GcalCtx {
  readonly api: CalendarApi;
  defaultTimeZone(calendarId: string): Promise<string>;
  /** Google refused the person's token in this call (revoked, or dead before its `exp`): the server forgets it, so the
   *  next request asks tokeninfo again and answers 401, and the connector marks the sign-in lapsed. */
  signedOut?(): void;
}

export interface GcalTool<S extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: S;
  readonly annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  run(args: z.infer<S>, ctx: GcalCtx): Promise<ToolResult>;
}

const define = <S extends z.ZodObject>(t: GcalTool<S>): GcalTool<S> => t;
const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

// ── Shared argument shapes, a NEW instance on every use ────────────────────────────────────────────────────────────────
const LOCAL_TIME =
  "ISO 8601 local time with no offset, e.g. 2026-11-25T10:00:00. Add an offset or Z only if the user gave one; if the user named a time zone, put it in timeZone instead.";
const calendarId = () => z.string().optional().describe("Calendar id or email from list_calendars. Default: the user's primary calendar.");
const timeZone = () =>
  z.string().optional().describe("IANA time zone, e.g. America/Mexico_City. Set it only when the user states a time zone; otherwise the calendar's own zone is used.");
const notificationLevel = () =>
  z.enum(["NONE", "EXTERNAL_ONLY", "ALL"]).optional().describe("Who gets an email about the change. Default ALL.");
const attendee = () =>
  z.object({
    email: z.string().describe("The guest's email."),
    displayName: z.string().optional(),
    optionalAttendee: z.boolean().optional(),
    responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
    additionalGuests: z.number().int().min(0).optional(),
  });
const reminder = () => z.object({ method: z.enum(["email", "popup"]), minutes: z.number().int().min(0) });
const guestPermissions = () =>
  z.object({ guestsCanInviteOthers: z.boolean().optional(), guestsCanModify: z.boolean().optional(), guestsCanSeeGuests: z.boolean().optional() });
const eventFields = () => ({
  calendarId: calendarId(),
  description: z.string().optional().describe("The event's description; may contain HTML."),
  location: z.string().optional(),
  allDay: z.boolean().optional().describe("All-day event: only the dates of startTime and endTime count (endTime is the day after the last day)."),
  timeZone: timeZone(),
  overrideReminders: z.array(reminder()).optional().describe("Reminders that replace the calendar's default ones."),
  useDefaultReminders: z.boolean().optional().describe("Use the calendar's default reminders. Can't be true together with overrideReminders."),
  notificationLevel: notificationLevel(),
  addGoogleMeetUrl: z.boolean().optional().describe("Create a Google Meet link for the event."),
  googleMeetUrl: z.string().optional().describe("An existing Meet link to attach instead of creating one."),
  visibility: z.enum(["default", "public", "private"]).optional(),
  colorId: z.string().optional().describe("Event color id, \"1\" to \"11\"."),
  availability: z.enum(["AVAILABILITY_BUSY", "AVAILABILITY_FREE"]).optional().describe("Whether the event blocks time. Default busy."),
  guestPermissions: guestPermissions().optional(),
});

// ── Mapping helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
const SEND_UPDATES = { NONE: "none", EXTERNAL_ONLY: "externalOnly", ALL: "all" } as const;

type AttendeeArg = { email: string; displayName?: string; optionalAttendee?: boolean; responseStatus?: string; additionalGuests?: number };
/** Google's MCP calls it `optionalAttendee`; the API's field is `optional` (an unknown field would be dropped in silence). */
function apiAttendee({ optionalAttendee, ...rest }: AttendeeArg): Json {
  return optionalAttendee === undefined ? { ...rest } : { ...rest, optional: optionalAttendee };
}

/** A patched start or end with the other kind of time cleared: a patch merges `start`, and Google refuses one that has both. */
const patchTime = (t: { date: string } | { dateTime: string; timeZone: string }): Json => ("date" in t ? { ...t, dateTime: null } : { ...t, date: null });
const sendUpdates = (level: keyof typeof SEND_UPDATES | undefined) => SEND_UPDATES[level ?? "ALL"];

/** What Len reads of an event: the useful fields, nothing else. */
function brief(e: Json, withDescription = false): Json {
  const attendees = Array.isArray(e.attendees)
    ? (e.attendees as Json[]).map((a) => ({ email: a.email, ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}), ...(a.self ? { self: true } : {}), ...(a.organizer ? { organizer: true } : {}) }))
    : undefined;
  return Object.fromEntries(
    Object.entries({
      id: e.id,
      summary: e.summary,
      start: e.start,
      end: e.end,
      location: e.location,
      ...(withDescription ? { description: e.description } : {}),
      status: e.status,
      eventType: e.eventType,
      recurringEventId: e.recurringEventId,
      htmlLink: e.htmlLink,
      meetLink: e.hangoutLink,
      attendees,
    }).filter(([, v]) => v !== undefined),
  );
}

type EventArgs = Partial<{
  summary: string;
  description: string;
  location: string;
  visibility: string;
  colorId: string;
  availability: "AVAILABILITY_BUSY" | "AVAILABILITY_FREE";
  guestPermissions: { guestsCanInviteOthers?: boolean; guestsCanModify?: boolean; guestsCanSeeGuests?: boolean };
  overrideReminders: { method: "email" | "popup"; minutes: number }[];
  useDefaultReminders: boolean;
  addGoogleMeetUrl: boolean;
  googleMeetUrl: string;
}>;

/** The body fields both create_event and update_event set from the same arguments; only what was sent. */
function commonBody(a: EventArgs): { body: Json; conference: boolean } {
  const body: Json = {};
  for (const k of ["summary", "description", "location", "visibility", "colorId"] as const) if (a[k] !== undefined) body[k] = a[k];
  if (a.availability) body.transparency = a.availability === "AVAILABILITY_FREE" ? "transparent" : "opaque";
  if (a.guestPermissions) {
    // Google's MCP says `guestsCanSeeGuests`; the API's field is `guestsCanSeeOtherGuests`.
    const { guestsCanSeeGuests, ...rest } = a.guestPermissions;
    Object.assign(body, rest, guestsCanSeeGuests === undefined ? {} : { guestsCanSeeOtherGuests: guestsCanSeeGuests });
  }
  if (a.overrideReminders) body.reminders = { useDefault: false, overrides: a.overrideReminders };
  else if (a.useDefaultReminders === true) body.reminders = { useDefault: true };
  else if (a.useDefaultReminders === false) body.reminders = { useDefault: false, overrides: [] };
  let conference = false;
  if (a.googleMeetUrl) {
    body.conferenceData = { conferenceSolution: { key: { type: "hangoutsMeet" } }, entryPoints: [{ entryPointType: "video", uri: a.googleMeetUrl }] };
    conference = true;
  } else if (a.addGoogleMeetUrl) {
    body.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
    conference = true;
  }
  return { body, conference };
}

/** The length of an existing event, in ms (or in days for an all-day one). */
function lengthOf(e: Json): { ms: number } | { days: number } | null {
  const s = e.start as Json | undefined;
  const en = e.end as Json | undefined;
  if (typeof s?.dateTime === "string" && typeof en?.dateTime === "string") return { ms: Temporal.Instant.from(en.dateTime).epochMilliseconds - Temporal.Instant.from(s.dateTime).epochMilliseconds };
  if (typeof s?.date === "string" && typeof en?.date === "string") return { days: Temporal.PlainDate.from(s.date).until(Temporal.PlainDate.from(en.date)).days };
  return null;
}

function addLength(local: string, timeZone: string, len: { ms: number } | { days: number }): string {
  if ("days" in len) return Temporal.PlainDate.from(local.slice(0, 10)).add({ days: len.days }).toString();
  if (hasOffset(local)) return Temporal.Instant.from(local).add({ milliseconds: len.ms }).toZonedDateTimeISO(timeZone).toString({ timeZoneName: "never", smallestUnit: "second" });
  return Temporal.PlainDateTime.from(local).toZonedDateTime(timeZone).add({ milliseconds: len.ms }).toPlainDateTime().toString({ smallestUnit: "second" });
}

// ── The tools ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const listCalendars = define({
  name: "list_calendars",
  title: "List calendars",
  description: "Lists the calendars the user owns or follows, with each one's id, name, time zone and the user's access to it.",
  inputSchema: z.object({ pageSize: z.number().int().min(1).max(250).optional(), pageToken: z.string().optional() }),
  annotations: READ,
  async run(a, { api }) {
    const r = await api.listCalendars({ maxResults: a.pageSize, pageToken: a.pageToken });
    const calendars = ((r.items as Json[] | undefined) ?? []).map((c) => ({ id: c.id, summary: c.summaryOverride ?? c.summary, timeZone: c.timeZone, ...(c.primary ? { primary: true } : {}), accessRole: c.accessRole }));
    return json({ calendars, ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) });
  },
});

const listEvents = define({
  name: "list_events",
  title: "List events",
  description:
    "Lists the events of one calendar, recurring ones expanded into their occurrences. Give startTime and endTime only when the user asks about a period; without them it lists from now on. For a search by words on the primary calendar, use search_events.",
  inputSchema: z.object({
    calendarId: calendarId(),
    startTime: z.string().optional().describe(`Earliest end of the events returned. ${LOCAL_TIME}`),
    endTime: z.string().optional().describe(`Latest start of the events returned. ${LOCAL_TIME}`),
    timeZone: timeZone(),
    fullText: z.string().optional().describe("Words that must appear in the event."),
    orderBy: z.enum(["startTime", "updated"]).optional().describe("Default startTime."),
    pageSize: z.number().int().min(1).max(250).optional(),
    pageToken: z.string().optional(),
  }),
  annotations: READ,
  async run(a, { api, defaultTimeZone }) {
    const id = a.calendarId ?? "primary";
    const tz = a.startTime || a.endTime ? (a.timeZone ?? (await defaultTimeZone(id))) : undefined;
    const r = await api.listEvents(id, {
      singleEvents: true,
      orderBy: a.orderBy ?? "startTime",
      // Without a period, what's coming: with orderBy=startTime and no timeMin Google would start years back.
      timeMin: a.startTime && tz ? toRfc3339(a.startTime, tz) : a.endTime ? undefined : new Date().toISOString(),
      timeMax: a.endTime && tz ? toRfc3339(a.endTime, tz) : undefined,
      q: a.fullText,
      maxResults: a.pageSize,
      pageToken: a.pageToken,
    });
    return json({ events: ((r.items as Json[] | undefined) ?? []).map((e) => brief(e)), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) });
  },
});

const getEvent = define({
  name: "get_event",
  title: "Get event",
  description: "Reads one event, with its description and guests.",
  inputSchema: z.object({ eventId: z.string().describe("The event's id, from list_events or search_events."), calendarId: calendarId() }),
  annotations: READ,
  async run(a, { api }) {
    return json(brief(await api.getEvent(a.calendarId ?? "primary", a.eventId), true));
  },
});

const searchEvents = define({
  name: "search_events",
  title: "Search events",
  description: "Searches the user's primary calendar for events containing these words (in the title, description, location or guests). A word search, not by meaning.",
  inputSchema: z.object({ query: z.string().min(1), pageSize: z.number().int().min(1).max(250).optional(), pageToken: z.string().optional() }),
  annotations: READ,
  async run(a, { api }) {
    const r = await api.listEvents("primary", { singleEvents: true, q: a.query, maxResults: a.pageSize, pageToken: a.pageToken });
    return json({ events: ((r.items as Json[] | undefined) ?? []).map((e) => brief(e)), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) });
  },
});

const createEvent = define({
  name: "create_event",
  title: "Create event",
  description: "Creates an event on a calendar. Guests get an email unless notificationLevel says otherwise.",
  inputSchema: z.object({
    summary: z.string().min(1).describe("The event's title."),
    startTime: z.string().describe(LOCAL_TIME),
    endTime: z.string().describe(LOCAL_TIME),
    attendees: z.array(attendee()).optional().describe("Guests. On the primary calendar the user is added when there is at least one other guest."),
    recurrenceData: z.array(z.string()).optional().describe("RRULE, RDATE or EXDATE lines (RFC 5545), e.g. RRULE:FREQ=WEEKLY;BYDAY=MO."),
    ...eventFields(),
  }),
  annotations: WRITE,
  async run(a, { api, defaultTimeZone }) {
    const id = a.calendarId ?? "primary";
    const tz = a.timeZone ?? (await defaultTimeZone(id));
    const { body, conference } = commonBody(a);
    body.start = eventTime(a.startTime, tz, a.allDay === true);
    body.end = eventTime(a.endTime, tz, a.allDay === true);
    if (a.attendees) body.attendees = a.attendees.map(apiAttendee);
    if (a.recurrenceData) body.recurrence = a.recurrenceData;
    const created = await api.insertEvent(id, body, { sendUpdates: sendUpdates(a.notificationLevel), ...(conference ? { conferenceDataVersion: 1 } : {}) });
    return json(brief(created));
  },
});

const updateEvent = define({
  name: "update_event",
  title: "Update event",
  description: "Changes an event. Only the fields given change; moving only startTime keeps the event's length.",
  inputSchema: z.object({
    eventId: z.string().describe("The event's id, from list_events or search_events."),
    summary: z.string().optional(),
    startTime: z.string().optional().describe(LOCAL_TIME),
    endTime: z.string().optional().describe(LOCAL_TIME),
    addedAttendees: z.array(attendee()).optional().describe("Guests to add."),
    removedAttendeeEmails: z.array(z.string()).optional().describe("Emails of guests to remove."),
    ...eventFields(),
  }),
  annotations: { ...WRITE, idempotentHint: true },
  async run(a, { api, defaultTimeZone }) {
    const id = a.calendarId ?? "primary";
    const { body, conference } = commonBody(a);
    const timeChanges = Boolean(a.startTime || a.endTime);
    // The event is read to keep its length, its guests, and — when allDay isn't given — whether it is all-day.
    const needsEvent = Boolean(a.addedAttendees || a.removedAttendeeEmails || (a.startTime && !a.endTime) || (timeChanges && a.allDay === undefined));
    const current = needsEvent ? await api.getEvent(id, a.eventId) : null;
    if (a.startTime || a.endTime) {
      if (a.allDay && !(a.startTime && a.endTime)) return fail("allDay needs both startTime and endTime.");
      const tz = a.timeZone ?? (await defaultTimeZone(id));
      // An all-day event moved by its start alone stays all-day.
      const allDay = a.allDay ?? (current !== null && typeof (current.start as Json | undefined)?.date === "string");
      if (a.startTime) body.start = patchTime(eventTime(a.startTime, tz, allDay));
      let end = a.endTime;
      if (a.startTime && !end && current) {
        const len = lengthOf(current);
        if (len) end = addLength(a.startTime, tz, len);
      }
      if (end) body.end = patchTime(eventTime(end, tz, allDay));
    }
    if (current && (a.addedAttendees || a.removedAttendeeEmails)) {
      const removed = new Set((a.removedAttendeeEmails ?? []).map((e) => e.toLowerCase()));
      const kept = ((current.attendees as Json[] | undefined) ?? []).filter((g) => !removed.has(String(g.email).toLowerCase()));
      const have = new Set(kept.map((g) => String(g.email).toLowerCase()));
      body.attendees = [...kept, ...(a.addedAttendees ?? []).filter((g) => !have.has(g.email.toLowerCase())).map(apiAttendee)];
    }
    const updated = await api.patchEvent(id, a.eventId, body, { sendUpdates: sendUpdates(a.notificationLevel), ...(conference ? { conferenceDataVersion: 1 } : {}) });
    return json(brief(updated));
  },
});

const deleteEvent = define({
  name: "delete_event",
  title: "Delete event",
  description: "Deletes an event. Guests get an email unless notificationLevel says otherwise.",
  inputSchema: z.object({ eventId: z.string(), calendarId: calendarId(), notificationLevel: notificationLevel() }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async run(a, { api }) {
    await api.deleteEvent(a.calendarId ?? "primary", a.eventId, { sendUpdates: sendUpdates(a.notificationLevel) });
    return json({ deleted: a.eventId });
  },
});

const respondToEvent = define({
  name: "respond_to_event",
  title: "Respond to event",
  description: "Answers an invitation for the user: accepted, declined, tentative, or back to no answer.",
  inputSchema: z.object({
    eventId: z.string(),
    calendarId: calendarId(),
    responseStatus: z.enum(["accepted", "declined", "tentative", "needsAction"]),
    responseComment: z.string().optional().describe("A note for the organizer."),
    notificationLevel: notificationLevel(),
  }),
  annotations: { ...WRITE, idempotentHint: true },
  async run(a, { api }) {
    const id = a.calendarId ?? "primary";
    const event = await api.getEvent(id, a.eventId);
    const guests = (event.attendees as Json[] | undefined) ?? [];
    if (!guests.some((g) => g.self === true)) return fail("The user isn't a guest of this event, so there is nothing to answer.");
    const attendees = guests.map((g) => (g.self === true ? { ...g, responseStatus: a.responseStatus, ...(a.responseComment !== undefined ? { comment: a.responseComment } : {}) } : g));
    const updated = await api.patchEvent(id, a.eventId, { attendees }, { sendUpdates: sendUpdates(a.notificationLevel) });
    return json(brief(updated));
  },
});

const suggestTime = define({
  name: "suggest_time",
  title: "Suggest time",
  description:
    "Finds free periods shared by the user and everyone in attendeeEmails between startTime and endTime; the user's own primary calendar always counts. Calendars it can't see are named in unavailableCalendars.",
  inputSchema: z.object({
    attendeeEmails: z.array(z.string()).min(1).describe('Who else must be free (emails). For the user alone, pass ["primary"].'),
    startTime: z.string().describe(`Start of the search. ${LOCAL_TIME}`),
    endTime: z.string().describe(`End of the search. ${LOCAL_TIME}`),
    timeZone: timeZone(),
    durationMinutes: z.number().int().min(1).optional().describe("Shortest period worth offering. Default 30."),
    preferences: z
      .object({
        startHour: z.string().optional().describe("Earliest hour each day, HH:mm (24 h)."),
        endHour: z.string().optional().describe("Latest hour each day, HH:mm (24 h)."),
        excludeWeekends: z.boolean().optional(),
        pageSize: z.number().int().min(1).max(50).optional().describe("Most periods returned. Default 5."),
      })
      .optional(),
  }),
  annotations: READ,
  async run(a, { api, defaultTimeZone }) {
    const tz = a.timeZone ?? (await defaultTimeZone("primary"));
    const window = { start: toRfc3339(a.startTime, tz), end: toRfc3339(a.endTime, tz) };
    // «With Ana» means the user too, whether or not Len knows their Google address.
    const ids = [...new Set(["primary", ...a.attendeeEmails])];
    const r = await api.freeBusy({ timeMin: window.start, timeMax: window.end, timeZone: tz, items: ids.map((id) => ({ id })) });
    const calendars = (r.calendars as Record<string, Json> | undefined) ?? {};
    const unavailable = ids.filter((e) => !calendars[e] || (Array.isArray(calendars[e]!.errors) && (calendars[e]!.errors as unknown[]).length > 0));
    const busy = ids.filter((e) => !unavailable.includes(e)).flatMap((e) => (calendars[e]!.busy as { start: string; end: string }[] | undefined) ?? []);
    const slots = freeSlots(busy, window, {
      durationMinutes: a.durationMinutes ?? 30,
      pageSize: a.preferences?.pageSize ?? 5,
      startHour: a.preferences?.startHour,
      endHour: a.preferences?.endHour,
      excludeWeekends: a.preferences?.excludeWeekends,
      timeZone: tz,
    });
    return json({
      timeSlots: slots.map((s) => ({ start: { dateTime: s.start, timeZone: tz }, end: { dateTime: s.end, timeZone: tz } })),
      ...(unavailable.length ? { unavailableCalendars: unavailable } : {}),
    });
  },
});

export const GCAL_TOOLS: readonly GcalTool[] = [listCalendars, listEvents, getEvent, searchEvents, createEvent, updateEvent, deleteEvent, respondToEvent, suggestTime] as readonly GcalTool[];

/** Runs a tool; an error from Google reaches Len as data (its message), never as a crash. */
export async function runGcalTool(tool: GcalTool, args: unknown, ctx: GcalCtx): Promise<ToolResult> {
  try {
    return await tool.run(args as never, ctx);
  } catch (err) {
    if (err instanceof GoogleApiError) {
      if (err.status === 401) ctx.signedOut?.();
      return fail(`Google Calendar: ${err.message}`);
    }
    throw err;
  }
}

/** Registers the nine tools on an MCP server; each call uses the person's token from the request's auth. */
export function registerGcalTools(server: McpServer, d: { fetch: typeof fetch }): void {
  for (const tool of GCAL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown, extra) => {
        const token = extra.http?.authInfo?.token;
        if (!token) return fail("Not signed in to Google.");
        const api = calendarApi(token, d);
        const zones = new Map<string, Promise<string>>();
        const defaultTimeZone = (calendarId: string) => {
          let z = zones.get(calendarId);
          if (!z) {
            z = api.getCalendarListEntry(calendarId).then((c) => (typeof c.timeZone === "string" && c.timeZone ? c.timeZone : "UTC"));
            zones.set(calendarId, z);
          }
          return z;
        };
        return runGcalTool(tool, args, { api, defaultTimeZone, signedOut: () => forgetGoogleToken(token) });
      },
    );
  }
}
