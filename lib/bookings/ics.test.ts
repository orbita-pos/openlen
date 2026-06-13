// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

const base = {
  uid: "bk-123",
  sequence: 0,
  startUtc: new Date(Date.UTC(2026, 5, 15, 15, 0, 0)),
  endUtc: new Date(Date.UTC(2026, 5, 15, 15, 30, 0)),
  dtstamp: new Date(Date.UTC(2026, 5, 13, 0, 0, 0)),
  summary: "Strategy Call",
};

describe("buildIcs", () => {
  it("emits a well-formed REQUEST with UTC stamps", () => {
    const ics = buildIcs({ ...base, method: "REQUEST" });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:bk-123@bookings.openlen.com");
    expect(ics).toContain("DTSTART:20260615T150000Z");
    expect(ics).toContain("DTEND:20260615T153000Z");
    expect(ics).toContain("DTSTAMP:20260613T000000Z");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("\r\n"); // CRLF line endings
  });

  it("CANCEL bumps the method + status and a higher sequence", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
  });

  it("escapes TEXT values (comma, semicolon, backslash, newline)", () => {
    const ics = buildIcs({
      ...base,
      method: "REQUEST",
      summary: "Call: A, B; C\\D",
      description: "line1\nline2",
    });
    expect(ics).toContain("SUMMARY:Call: A\\, B\\; C\\\\D");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });

  it("includes organizer + attendee when given", () => {
    const ics = buildIcs({
      ...base,
      method: "REQUEST",
      organizerName: "Acme",
      organizerEmail: "owner@acme.com",
      attendeeName: "Guest",
      attendeeEmail: "guest@example.com",
    });
    expect(ics).toContain("ORGANIZER;CN=Acme:mailto:owner@acme.com");
    expect(ics).toContain("ATTENDEE;CN=Guest;RSVP=TRUE:mailto:guest@example.com");
  });

  it("folds long lines to <=75 chars with CRLF + space", () => {
    const ics = buildIcs({ ...base, method: "REQUEST", description: "x".repeat(200) });
    for (const line of ics.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});
