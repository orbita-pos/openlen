// lib/google-calendar-mcp/tools.test.ts
// @vitest-environment node
//
// The nine tools (spec local 2026-11-24-servidor-de-google-calendar, §5.3): Google's names and argument names, schemas Len
// takes (no $ref), each one mapped to the Calendar API v3.
import * as z from "zod4";
import { describe, expect, it } from "vitest";
import { reviewTools } from "@/lib/mcp-connectors/names";
import type { CalendarApi } from "./calendar-api";
import { GoogleApiError } from "./calendar-api";
import { GCAL_TOOLS, runGcalTool, type GcalCtx } from "./tools";

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
});

describe("create_event", () => {
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

  // Review Focus 2.
  it("🔴 moving only startTime keeps the duration", async () => {
    const { ctx, calls } = fakeApi({ getEvent: () => existing, patchEvent: () => ({ id: "ev1" }) });
    await run("update_event", { eventId: "ev1", startTime: "2026-11-26T16:00:00" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.start).toEqual({ dateTime: "2026-11-26T16:00:00", timeZone: "America/Mexico_City" });
    expect(body.end).toEqual({ dateTime: "2026-11-26T17:30:00", timeZone: "America/Mexico_City" });
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

describe("delete_event and respond_to_event", () => {
  it("delete_event deletes with NONE as sendUpdates none", async () => {
    const { ctx, calls } = fakeApi();
    await run("delete_event", { eventId: "ev1", notificationLevel: "NONE" }, ctx);
    expect(calls[0]).toEqual({ method: "deleteEvent", args: ["primary", "ev1", { sendUpdates: "none" }] });
  });

  it("respond_to_event changes only the person's own attendee", async () => {
    const event = { id: "ev1", attendees: [{ email: "ana@x.com", responseStatus: "accepted" }, { email: "yo@x.com", self: true, responseStatus: "needsAction" }] };
    const { ctx, calls } = fakeApi({ getEvent: () => event, patchEvent: () => ({ id: "ev1" }) });
    await run("respond_to_event", { eventId: "ev1", responseStatus: "declined", responseComment: "No puedo" }, ctx);
    const body = (calls.find((c) => c.method === "patchEvent")!.args[2]) as Record<string, unknown>;
    expect(body.attendees).toEqual([
      { email: "ana@x.com", responseStatus: "accepted" },
      { email: "yo@x.com", self: true, responseStatus: "declined", comment: "No puedo" },
    ]);
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
});
