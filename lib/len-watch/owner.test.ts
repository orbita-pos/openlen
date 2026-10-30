// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/dispatch", () => ({ loadPrefs: async () => ({ timezone: "America/Mexico_City" }) }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return { schema: s, db: {} };
});

const { htmlLang, noticeFor, noticeKey, pageUrl } = await import("./owner");

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

  it("a notice goes to the owner, in their language, once per phase", () => {
    const e = noticeFor(P, I, "fixing");
    expect(e).toMatchObject({ type: "len_watch", projectId: "p1", recipientUserId: "u1", incidentId: "i1", phase: "fixing", title: "Holi no carga" });
    expect(e.emailText).toContain("/menu/");
    expect(noticeKey(e)).toBe("len-watch:i1:fixing");
  });
});
