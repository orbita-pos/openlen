// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/dispatch", () => ({ loadPrefs: async () => ({ timezone: "America/Mexico_City" }) }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return { schema: s, db: {} };
});

const { allowedCheckOrigins, htmlLang, noticeFor, noticeKey, pageUrl } = await import("./owner");

const P = { projectId: "p1", ownerId: "u1", title: "Holi", subdomain: "holi", url: "https://holi.openlen.app", locale: "es", timeZone: "UTC" };
const now = new Date();
const I = { id: "i1", projectId: "p1", status: "open" as const, sample: { message: null, file: null, line: null, col: null, page: "menu" }, reports: 1, summary: null, reason: null, shipsUnpublished: false, turnRowId: null, createdAt: now, updatedAt: now, resolvedAt: null, resolution: null, fixStamp: null };

describe("owner", () => {
  it("reads the page's language when it's one of ours", () => {
    expect(htmlLang('<!doctype html><html lang="es-MX"><head>')).toBe("es");
    expect(htmlLang("<html lang=fr>")).toBe("fr");
    expect(htmlLang('<html lang="sw">')).toBeNull();
    expect(htmlLang(null)).toBeNull();
  });

  it("the reported page's address", () => {
    expect(pageUrl(P, "menu")).toMatch(/^https:\/\/holi\..+\/menu\/$/);
    expect(pageUrl(P, null)).toMatch(/^https:\/\/holi\.[^/]+$/);
  });

  it("OPENLEN_WATCH_PUBLISHED_ORIGIN points the check at a local or staging copy, never production's", () => {
    process.env.OPENLEN_WATCH_PUBLISHED_ORIGIN = "http://127.0.0.1:4567/";
    try {
      expect(pageUrl(P, "menu")).toBe("http://127.0.0.1:4567/menu/");
      expect(pageUrl(P, null)).toBe("http://127.0.0.1:4567");
      expect(allowedCheckOrigins()).toEqual(["127.0.0.1:4567"]);
      process.env.OPENLEN_WATCH_PUBLISHED_ORIGIN = "http://{sub}.localhost:4567";
      expect(pageUrl(P, null)).toBe("http://holi.localhost:4567");
    } finally {
      delete process.env.OPENLEN_WATCH_PUBLISHED_ORIGIN;
    }
    expect(allowedCheckOrigins()).toEqual([]);
  });

  it("a notice goes to the owner, in their language, once per phase", () => {
    const e = noticeFor(P, I, "fixing");
    expect(e).toMatchObject({ type: "len_watch", projectId: "p1", recipientUserId: "u1", incidentId: "i1", phase: "fixing", title: "Holi no carga" });
    expect(e.emailText).toContain("/menu/");
    expect(noticeKey(e)).toBe("len-watch:i1:fixing");
  });
});
