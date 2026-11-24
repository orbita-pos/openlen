// THE GOOGLE CALENDAR API v3, as the person (spec local 2026-11-24-servidor-de-google-calendar, §5.3). A thin client with
// the person's access token: every non-2xx answer becomes a GoogleApiError carrying Google's own message, which the
// tools hand to Len as data. The token never appears in an error. Every request has Claude Code's MCP budget, 60 s, and
// ends as «The operation timed out.» when Google doesn't answer; an error body that isn't JSON keeps Google's status.
const BASE = "https://www.googleapis.com/calendar/v3";

type Query = Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;

/** Claude Code's per-request budget for an MCP server (its `ll = 60000`). */
export const GOOGLE_TIMEOUT_MS = 60_000;
type Json = Record<string, unknown>;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface CalendarApi {
  listCalendars(q: Query): Promise<Json>;
  getCalendarListEntry(calendarId: string): Promise<Json>;
  listEvents(calendarId: string, q: Query): Promise<Json>;
  getEvent(calendarId: string, eventId: string): Promise<Json>;
  insertEvent(calendarId: string, body: Json, q: Query): Promise<Json>;
  patchEvent(calendarId: string, eventId: string, body: Json, q: Query): Promise<Json>;
  deleteEvent(calendarId: string, eventId: string, q: Query): Promise<void>;
  freeBusy(body: Json): Promise<Json>;
}

function search(q: Query): string {
  const p = new URLSearchParams();
  // A list is Google's repeated parameter (`eventTypes=a&eventTypes=b`).
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) p.append(k, String(item));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;
const ev = (calendarId: string, eventId: string) => `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`;

export function calendarApi(token: string, d: { fetch: typeof fetch; timeoutMs?: number }): CalendarApi {
  async function call(method: string, path: string, q: Query = {}, body?: Json): Promise<Json> {
    let res: Response;
    let text: string;
    try {
      res = await d.fetch(`${BASE}${path}${search(q)}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(d.timeoutMs ?? GOOGLE_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") throw new GoogleApiError(504, "Google Calendar didn't answer in time: the operation timed out.");
      throw err;
    }
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      if (res.ok) throw new GoogleApiError(502, "Google Calendar answered with something that isn't JSON");
    }
    if (!res.ok) {
      const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
      throw new GoogleApiError(res.status, typeof message === "string" && message ? message : `Google Calendar answered ${res.status}`);
    }
    return (parsed ?? {}) as Json;
  }
  return {
    listCalendars: (q) => call("GET", "/users/me/calendarList", q),
    getCalendarListEntry: (calendarId) => call("GET", `/users/me/calendarList/${encodeURIComponent(calendarId)}`),
    listEvents: (calendarId, q) => call("GET", `${cal(calendarId)}/events`, q),
    getEvent: (calendarId, eventId) => call("GET", ev(calendarId, eventId)),
    insertEvent: (calendarId, body, q) => call("POST", `${cal(calendarId)}/events`, q, body),
    patchEvent: (calendarId, eventId, body, q) => call("PATCH", ev(calendarId, eventId), q, body),
    deleteEvent: async (calendarId, eventId, q) => {
      await call("DELETE", ev(calendarId, eventId), q);
    },
    freeBusy: (body) => call("POST", "/freeBusy", {}, body),
  };
}
