// lib/google-calendar-mcp/tools.test.ts
// @vitest-environment node
//
// The nine tools (spec local 2026-11-24-servidor-de-google-calendar, §5.3): Google's names and argument names, schemas Len
// takes (no $ref), each one mapped to the Calendar API v3.
import * as z from "zod4";
import { describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { reviewTools } from "@/lib/mcp-connectors/names";
import type { CalendarApi } from "./calendar-api";
import { GoogleApiError } from "./calendar-api";
import { toRfc3339 } from "./time";
import { calendarZones, GCAL_TOOLS, runGcalTool, type GcalCtx } from "./tools";

type Call = { method: keyof CalendarApi; args: unknown[] };

function fakeApi(over: Partial<Record<keyof CalendarApi, (...a: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const api = new Proxy({} as CalendarApi, {
    get(_t, method: string) {
      return async (...args: unknown[]) => {
        calls.push({ method: method as keyof CalendarApi, args });
        const f = over[method as keyof CalendarApi];
        return f ? f(...args) : {};
      };
    },
  });
  const ctx: GcalCtx = { api, defaultTimeZone: async () => "America/Mexico_City" };
  return { ctx, calls };
}

const tool = (name: string) => GCAL_TOOLS.find((t) => t.name === name)!;
// Through `runGcalTool`, the entry the MCP server uses: it turns Google's errors into isError results.
const run = (name: string, args: Record<string, unknown>, ctx: GcalCtx) => runGcalTool(tool(name), tool(name).inputSchema.parse(args), ctx);
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");

describe("the nine tools", () => {
  it("Google's nine names", () => {
    expect(GCAL_TOOLS.map((t) => t.name).sort()).toEqual(
      ["create_event", "delete_event", "get_event", "list_calendars", "list_events", "respond_to_event", "search_events", "suggest_time", "update_event"].sort(),
    );
  });

  it("🔴 reviewTools takes all nine with no problem (no $ref, under the size cap)", () => {
    const listed = GCAL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.inputSchema) as Record<string, unknown> }));
    const r = reviewTools("google-calendar", listed as never);
    expect(r.problems).toEqual([]);
    expect(r.tools).toHaveLength(9);
  });
});

describe("list_calendars, list_events, get_event, search_events", () => {
  it("list_calendars maps pageSize to maxResults", async () => {
    const { ctx, calls } = fakeApi({ listCalendars: () => ({ items: [{ id: "primary@x.com", summary: "Yo", timeZone: "America/Mexico_City", primary: true, accessRole: "owner" }] }) });
    const r = await run("list_calendars", { pageSize: 20 }, ctx);
    expect(calls[0]).toEqual({ method: "listCalendars", args: [{ maxResults: 20, pageToken: undefined }] });
    expect(JSON.parse(textOf(r))).toEqual({ calendars: [{ id: "primary@x.com", summary: "Yo", timeZone: "America/Mexico_City", primary: true, accessRole: "owner" }] });
  });

  it("list_events: single events, local times with the calendar's zone, fullText as q", async () => {
    const { ctx, calls } = fakeApi();
    await run("list_events", { startTime: "2026-11-25T00:00:00", endTime: "2026-11-26T00:00:00", fullText: "dentista" }, ctx);
    expect(calls.at(-1)).toEqual({
      method: "listEvents",
      args: ["primary", expect.objectContaining({ singleEvents: true, timeMin: "2026-11-25T00:00:00-06:00", timeMax: "2026-11-26T00:00:00-06:00", q: "dentista" })],
    });
  });

  // Final review: with orderBy=startTime and no timeMin Google starts at the calendar's first event, years back. Without a
  // period, what the person means is what's coming.
  it("🔴 list_events without a period lists from now on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T18:30:00Z"));
    try {
      const { ctx, calls } = fakeApi();
      await run("list_events", {}, ctx);
      expect(calls.at(-1)).toEqual({ method: "listEvents", args: ["primary", expect.objectContaining({ timeMin: "2026-11-24T18:30:00.000Z", timeMax: undefined })] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 list_events filters by event type with the API's repeated eventTypes", async () => {
    const { ctx, calls } = fakeApi();
    await run("list_events", { eventTypeFilter: ["focusTime", "outOfOffice"] }, ctx);
    expect(calls.at(-1)).toEqual({ method: "listEvents", args: ["primary", expect.objectContaining({ eventTypes: ["focusTime", "outOfOffice"] })] });
  });

  it("search_events searches by words on the primary calendar", async () => {
    const { ctx, calls } = fakeApi();
    await run("search_events", { query: "boda" }, ctx);
    expect(calls.at(-1)).toEqual({ method: "listEvents", args: ["primary", expect.objectContaining({ q: "boda", singleEvents: true })] });
    expect(tool("search_events").description).toMatch(/word/i);
  });

  it("get_event reads one event", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => ({ id: "ev1", summary: "S" }) });
    const r = await run("get_event", { eventId: "ev1" }, ctx);
    expect(calls[0]).toEqual({ method: "getEvent", args: ["primary", "ev1"] });
    expect(JSON.parse(textOf(r))).toMatchObject({ id: "ev1", summary: "S" });
  });

  it("an error from Google is isError with Google's message", async () => {
    const { ctx } = fakeApi({
      getEvent: () => {
        throw new GoogleApiError(404, "Not Found");
      },
    });
    const r = await run("get_event", { eventId: "nope" }, ctx);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("Not Found");
  });

  // Final review, I1: Google refusing the token mid-call (revoked, expired early) makes the server forget it, so the next
  // request asks tokeninfo again and answers 401 — the connector marks the sign-in lapsed. Any other error forgets nothing.
  it("🔴 a 401 from Google tells the server the sign-in is gone; a 404 doesn't", async () => {
    let signedOut = 0;
    const throwing = (status: number) =>
      fakeApi({
        getEvent: () => {
          throw new GoogleApiError(status, status === 401 ? "Invalid Credentials" : "Not Found");
        },
      }).ctx;
    const r = await run("get_event", { eventId: "ev1" }, { ...throwing(401), signedOut: () => void signedOut++ });
    expect(r.isError).toBe(true);
    expect(signedOut).toBe(1);
    await run("get_event", { eventId: "ev1" }, { ...throwing(404), signedOut: () => void signedOut++ });
    expect(signedOut).toBe(1);
  });
});

describe("create_event", () => {
  // Final review, I4: Google's MCP argument names, the API's field names.
  it("🔴 optionalAttendee is the API's optional, and guestsCanSeeGuests its guestsCanSeeOtherGuests", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    await run(
      "create_event",
      {
        summary: "Junta",
        startTime: "2026-11-25T10:00:00",
        endTime: "2026-11-25T11:00:00",
        attendees: [{ email: "ana@x.com", optionalAttendee: true, displayName: "Ana" }, { email: "beto@x.com" }],
        guestPermissions: { guestsCanSeeGuests: false, guestsCanModify: true },
      },
      ctx,
    );
    const body = (calls.find((c) => c.method === "insertEvent")!.args[1]) as Record<string, unknown>;
    expect(body.attendees).toEqual([{ email: "ana@x.com", displayName: "Ana", optional: true }, { email: "beto@x.com" }]);
    expect(body.guestsCanSeeOtherGuests).toBe(false);
    expect(body.guestsCanModify).toBe(true);
    expect(body).not.toHaveProperty("guestsCanSeeGuests");
  });

  it("attendees, a new Meet link and EXTERNAL_ONLY notifications", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    await run(
      "create_event",
      {
        summary: "Junta",
        startTime: "2026-11-25T10:00:00",
        endTime: "2026-11-25T11:00:00",
        attendees: [{ email: "ana@x.com" }],
        addGoogleMeetUrl: true,
        notificationLevel: "EXTERNAL_ONLY",
      },
      ctx,
    );
    const insert = calls.find((c) => c.method === "insertEvent")!;
    const [calendarId, body, q] = insert.args as [string, Record<string, unknown>, Record<string, unknown>];
    expect(calendarId).toBe("primary");
    expect(body).toMatchObject({
      summary: "Junta",
      start: { dateTime: "2026-11-25T10:00:00", timeZone: "America/Mexico_City" },
      end: { dateTime: "2026-11-25T11:00:00", timeZone: "America/Mexico_City" },
      attendees: [{ email: "ana@x.com" }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
    expect(q).toEqual({ sendUpdates: "externalOnly", conferenceDataVersion: 1 });
  });

  // Review Focus 1.
  it("🔴 with no timeZone it takes the calendar's; all day makes dates with no time", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    await run("create_event", { summary: "Feriado", startTime: "2026-12-25T00:00:00", endTime: "2026-12-26T00:00:00", allDay: true }, ctx);
    const body = (calls.find((c) => c.method === "insertEvent")!.args[1]) as Record<string, unknown>;
    expect(body.start).toEqual({ date: "2026-12-25" });
    expect(body.end).toEqual({ date: "2026-12-26" });
  });

  it("defaults to ALL notifications and no conference version", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    await run("create_event", { summary: "S", startTime: "2026-11-25T10:00:00", endTime: "2026-11-25T11:00:00" }, ctx);
    expect(calls.find((c) => c.method === "insertEvent")!.args[2]).toEqual({ sendUpdates: "all" });
  });
});

describe("update_event", () => {
  const existing = {
    id: "ev1",
    start: { dateTime: "2026-11-25T10:00:00-06:00", timeZone: "America/Mexico_City" },
    end: { dateTime: "2026-11-25T11:30:00-06:00", timeZone: "America/Mexico_City" },
    attendees: [{ email: "ana@x.com" }, { email: "beto@x.com" }],
  };

  // Review Focus 2. A patch merges `start`/`end`, so the other kind of time is cleared in the same body (final review, I7).
  it("🔴 moving only startTime keeps the duration", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", startTime: "2026-11-26T16:00:00" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.start).toEqual({ dateTime: "2026-11-26T16:00:00", timeZone: "America/Mexico_City", date: null });
    expect(body.end).toEqual({ dateTime: "2026-11-26T17:30:00", timeZone: "America/Mexico_City", date: null });
  });

  // Final review, I7: the schema lets a startTime carry Z or an offset; the length is kept in real time either way.
  const lengthMs = (body: Record<string, unknown>) =>
    Temporal.Instant.from(toRfc3339((body.end as { dateTime: string }).dateTime, "America/Mexico_City")).epochMilliseconds -
    Temporal.Instant.from(toRfc3339((body.start as { dateTime: string }).dateTime, "America/Mexico_City")).epochMilliseconds;

  it("🔴 moving only startTime given with Z keeps the duration, and doesn't throw", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    const r = await run("update_event", { eventId: "ev1", startTime: "2026-11-26T16:00:00Z" }, ctx);
    expect(r.isError).toBeFalsy();
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(lengthMs(body)).toBe(90 * 60_000);
  });

  it("🔴 moving only startTime given with an offset keeps the duration in real time", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", startTime: "2026-11-26T16:00:00+01:00" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(lengthMs(body)).toBe(90 * 60_000);
  });

  const allDayEvent = { id: "ev2", start: { date: "2026-11-25" }, end: { date: "2026-11-26" } };

  it("🔴 an all-day event given new start and end without allDay stays all-day (the event is read)", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => allDayEvent, patchEvent: () => ({ id: "ev2" }) });
    await run("update_event", { eventId: "ev2", startTime: "2026-12-01", endTime: "2026-12-02" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.start).toEqual({ date: "2026-12-01", dateTime: null });
    expect(body.end).toEqual({ date: "2026-12-02", dateTime: null });
  });

  it("🔴 an all-day event given only a new endTime stays all-day", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => allDayEvent, patchEvent: () => ({ id: "ev2" }) });
    await run("update_event", { eventId: "ev2", endTime: "2026-11-28" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.end).toEqual({ date: "2026-11-28", dateTime: null });
  });

  it("🔴 timed to all-day and back clear the other kind of time", async () => {
    const toAllDay = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", startTime: "2026-11-27", endTime: "2026-11-28", allDay: true }, toAllDay.ctx);
    expect((toAllDay.calls.find((c) => c.method === "patchEvent")!.args[2] as Record<string, unknown>).start).toEqual({ date: "2026-11-27", dateTime: null });
    const toTimed = fakeApi({ getEvent: () => allDayEvent, patchEvent: () => ({ id: "ev2" }) });
    await run("update_event", { eventId: "ev2", startTime: "2026-11-25T09:00:00", endTime: "2026-11-25T10:00:00", allDay: false }, toTimed.ctx);
    expect((toTimed.calls.find((c) => c.method === "patchEvent")!.args[2] as Record<string, unknown>).start).toEqual({
      dateTime: "2026-11-25T09:00:00",
      timeZone: "America/Mexico_City",
      date: null,
    });
  });

  // Final review, I4: the argument names are Google's MCP's; the API's fields are `optional` and `guestsCanSeeOtherGuests`.
  it("🔴 an added optional guest is optional in the API", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", addedAttendees: [{ email: "carla@x.com", optionalAttendee: true }] }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.attendees).toEqual([{ email: "ana@x.com" }, { email: "beto@x.com" }, { email: "carla@x.com", optional: true }]);
  });

  it("added and removed attendees merge with the event's list", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", addedAttendees: [{ email: "carla@x.com" }], removedAttendeeEmails: ["BETO@x.com"] }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.attendees).toEqual([{ email: "ana@x.com" }, { email: "carla@x.com" }]);
  });

  it("only the fields sent change", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", summary: "Nuevo" }, ctx);
    expect(calls.find((c) => c.method === "patchEvent")!.args[2]).toEqual({ summary: "Nuevo" });
  });
});

describe("update_event refuses what it can't do as asked", () => {
  // Claude Code's tools validate the input and say what to change instead of dropping part of it in silence.
  it("🔴 allDay or timeZone with no startTime or endTime is refused, saying why", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => ({ id: "ev1" }), patchEvent: () => ({ id: "ev1" }) });
    const r = await run("update_event", { eventId: "ev1", allDay: true }, ctx);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("allDay and timeZone only apply together with startTime or endTime; give the new time too.");
    expect((await run("update_event", { eventId: "ev1", timeZone: "Europe/Madrid", summary: "x" }, ctx)).isError).toBe(true);
    expect(calls.filter((c) => c.method === "patchEvent")).toHaveLength(0);
  });

  it("🔴 changing the guests of an event whose guest list Google cut short is refused", async () => {
    const partial = { id: "ev1", attendeesOmitted: true, attendees: [{ email: "yo@x.com", self: true }] };
    const { ctx, calls } = fakeApi({ getEvent: () => partial, patchEvent: () => ({ id: "ev1" }) });
    const r = await run("update_event", { eventId: "ev1", addedAttendees: [{ email: "carla@x.com" }] }, ctx);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("attendeesOmitted");
    expect(calls.filter((c) => c.method === "patchEvent")).toHaveLength(0);
  });
});

describe("a Google Meet link", () => {
  // Google's API: existing conference data is conferenceSolution + entryPoints; for hangoutsMeet the conferenceId is the
  // meeting code.
  it("🔴 an existing Meet link goes with its meeting code", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    await run("create_event", { summary: "Junta", startTime: "2026-11-25T10:00:00", endTime: "2026-11-25T11:00:00", googleMeetUrl: "https://meet.google.com/abc-defg-hij" }, ctx);
    const body = (calls.find((c) => c.method === "insertEvent")!.args[1]) as Record<string, unknown>;
    expect(body.conferenceData).toEqual({
      conferenceId: "abc-defg-hij",
      conferenceSolution: { key: { type: "hangoutsMeet" } },
      entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
    });
  });

  it("🔴 a link that isn't Google Meet is refused, saying where it goes instead", async () => {
    const { ctx, calls } = fakeApi({ insertEvent: () => ({ id: "new" }) });
    const r = await run("create_event", { summary: "Junta", startTime: "2026-11-25T10:00:00", endTime: "2026-11-25T11:00:00", googleMeetUrl: "https://zoom.us/j/123" }, ctx);
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("googleMeetUrl takes a Google Meet link (https://meet.google.com/…); put any other video link in location or description.");
    expect(calls.filter((c) => c.method === "insertEvent")).toHaveLength(0);
  });
});

describe("the calendar's time zone", () => {
  // A calendar the person can reach but doesn't follow has no calendarList entry: the primary's zone stands in.
  it("🔴 a calendar with no calendarList entry takes the primary calendar's zone", async () => {
    const { ctx } = fakeApi({
      getCalendarListEntry: (id) => {
        if (id === "primary") return { timeZone: "Europe/Madrid" };
        throw new GoogleApiError(404, "Not Found");
      },
    });
    expect(await calendarZones(ctx.api)("equipo@group.calendar.google.com")).toBe("Europe/Madrid");
  });

  it("any other error still reaches Len", async () => {
    const { ctx } = fakeApi({
      getCalendarListEntry: () => {
        throw new GoogleApiError(403, "Insufficient Permission");
      },
    });
    await expect(calendarZones(ctx.api)("equipo@group.calendar.google.com")).rejects.toThrow("Insufficient Permission");
  });
});

describe("delete_event and respond_to_event", () => {
  it("delete_event deletes with NONE as sendUpdates none", async () => {
    const { ctx, calls } = fakeApi();
    await run("delete_event", { eventId: "ev1", notificationLevel: "NONE" }, ctx);
    expect(calls[0]).toEqual({ method: "deleteEvent", args: ["primary", "ev1", { sendUpdates: "none" }] });
  });

  // Google's API: attendeesOmitted "can be used to only update the participant's response" — the guest list is never
  // written back, so a list Google cut short can't drop anyone.
  it("🔴 respond_to_event sends only the person's own answer, with attendeesOmitted", async () => {
    const event = { id: "ev1", attendees: [{ email: "ana@x.com", responseStatus: "accepted" }, { email: "yo@x.com", self: true, responseStatus: "needsAction" }] };
    const { ctx, calls } = fakeApi({ getEvent: () => event, patchEvent: () => ({ id: "ev1" }) });
    await run("respond_to_event", { eventId: "ev1", responseStatus: "declined", responseComment: "No puedo" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body).toEqual({ attendeesOmitted: true, attendees: [{ email: "yo@x.com", self: true, responseStatus: "declined", comment: "No puedo" }] });
  });

  it("respond_to_event on an event the person isn't invited to is an error", async () => {
    const { ctx } = fakeApi({ getEvent: () => ({ id: "ev1", attendees: [{ email: "ana@x.com" }] }) });
    const r = await run("respond_to_event", { eventId: "ev1", responseStatus: "accepted" }, ctx);
    expect(r.isError).toBe(true);
  });
});

describe("suggest_time", () => {
  // Review Focus 5.
  it("🔴 a calendar freeBusy can't see: slots from what it can, and the result names it", async () => {
    const { ctx } = fakeApi({
      freeBusy: () => ({
        calendars: {
          primary: { busy: [] },
          "ana@x.com": { busy: [{ start: "2026-11-25T10:00:00-06:00", end: "2026-11-25T11:00:00-06:00" }] },
          "privado@y.com": { busy: [], errors: [{ domain: "global", reason: "notFound" }] },
        },
      }),
    });
    const r = await run("suggest_time", { attendeeEmails: ["ana@x.com", "privado@y.com"], startTime: "2026-11-25T09:00:00", endTime: "2026-11-25T12:00:00" }, ctx);
    const out = JSON.parse(textOf(r));
    expect(out.timeSlots).toEqual([
      { start: { dateTime: "2026-11-25T09:00:00-06:00", timeZone: "America/Mexico_City" }, end: { dateTime: "2026-11-25T10:00:00-06:00", timeZone: "America/Mexico_City" } },
      { start: { dateTime: "2026-11-25T11:00:00-06:00", timeZone: "America/Mexico_City" }, end: { dateTime: "2026-11-25T12:00:00-06:00", timeZone: "America/Mexico_City" } },
    ]);
    expect(out.unavailableCalendars).toEqual(["privado@y.com"]);
  });

  // Final review, I8: «find a time with Ana» must not offer a slot where the person is busy, whether or not Len knew their
  // Google address.
  it("🔴 the person's own calendar always counts", async () => {
    const { ctx, calls } = fakeApi({
      freeBusy: () => ({
        calendars: {
          primary: { busy: [{ start: "2026-11-25T09:00:00-06:00", end: "2026-11-25T11:00:00-06:00" }] },
          "ana@x.com": { busy: [] },
        },
      }),
    });
    const r = await run("suggest_time", { attendeeEmails: ["ana@x.com"], startTime: "2026-11-25T09:00:00", endTime: "2026-11-25T12:00:00" }, ctx);
    const body = calls.find((c) => c.method === "freeBusy")!.args[0] as { items: { id: string }[] };
    expect(body.items).toEqual([{ id: "primary" }, { id: "ana@x.com" }]);
    expect(JSON.parse(textOf(r)).timeSlots).toEqual([
      { start: { dateTime: "2026-11-25T11:00:00-06:00", timeZone: "America/Mexico_City" }, end: { dateTime: "2026-11-25T12:00:00-06:00", timeZone: "America/Mexico_City" } },
    ]);
  });
});
