// lib/google-calendar-mcp/calendar-api.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calendarApi, GoogleApiError } from "./calendar-api";

interface Seen {
  method: string;
  url: URL;
  body: unknown;
  auth: string | null;
}

function fake(reply: (s: Seen) => Response = () => new Response("{}", { status: 200 })) {
  const seen: Seen[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const s: Seen = {
      method: init?.method ?? "GET",
      url: new URL(String(input instanceof Request ? input.url : input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("authorization"),
    };
    seen.push(s);
    return reply(s);
  }) as typeof fetch;
  return { api: calendarApi("ya29.T", { fetch: fetchFn }), seen };
}

const BASE = "https://www.googleapis.com/calendar/v3";

describe("calendarApi", () => {
  it("lists calendars, with the person's token", async () => {
    const { api, seen } = fake();
    await api.listCalendars({ maxResults: 20, pageToken: "p2" });
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url.toString()).toBe(`${BASE}/users/me/calendarList?maxResults=20&pageToken=p2`);
    expect(seen[0]!.auth).toBe("Bearer ya29.T");
  });

  it("reads one calendar's entry (its time zone)", async () => {
    const { api, seen } = fake();
    await api.getCalendarListEntry("team@group.calendar.google.com");
    expect(seen[0]!.url.pathname).toBe("/calendar/v3/users/me/calendarList/team%40group.calendar.google.com");
  });

  it("lists, gets, inserts, patches and deletes events, with the calendar id encoded", async () => {
    const { api, seen } = fake((s) => (s.method === "DELETE" ? new Response(null, { status: 204 }) : new Response("{}", { status: 200 })));
    await api.listEvents("a b@x.com", { singleEvents: true, q: "dentista", timeMin: "2026-11-25T00:00:00-06:00" });
    await api.getEvent("primary", "ev1");
    await api.insertEvent("primary", { summary: "S" }, { sendUpdates: "all", conferenceDataVersion: 1 });
    await api.patchEvent("primary", "ev1", { summary: "T" }, { sendUpdates: "none" });
    await api.deleteEvent("primary", "ev1", { sendUpdates: "externalOnly" });
    expect(seen.map((s) => `${s.method} ${s.url.pathname}${s.url.search}`)).toEqual([
      "GET /calendar/v3/calendars/a%20b%40x.com/events?singleEvents=true&q=dentista&timeMin=2026-11-25T00%3A00%3A00-06%3A00",
      "GET /calendar/v3/calendars/primary/events/ev1",
      "POST /calendar/v3/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1",
      "PATCH /calendar/v3/calendars/primary/events/ev1?sendUpdates=none",
      "DELETE /calendar/v3/calendars/primary/events/ev1?sendUpdates=externalOnly",
    ]);
    expect(seen[2]!.body).toEqual({ summary: "S" });
    expect(seen[3]!.body).toEqual({ summary: "T" });
  });

  it("asks freeBusy with a POST", async () => {
    const { api, seen } = fake();
    await api.freeBusy({ timeMin: "a", timeMax: "b", items: [{ id: "x@y.com" }] });
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url.pathname).toBe("/calendar/v3/freeBusy");
    expect(seen[0]!.body).toEqual({ timeMin: "a", timeMax: "b", items: [{ id: "x@y.com" }] });
  });

  it("a 403 from Google is a GoogleApiError with Google's message", async () => {
    const { api } = fake(() => new Response(JSON.stringify({ error: { code: 403, message: "Insufficient Permission" } }), { status: 403 }));
    const err = await api.getEvent("primary", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(403);
    expect((err as GoogleApiError).message).toBe("Insufficient Permission");
  });
});
