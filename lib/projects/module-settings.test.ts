import { describe, it, expect } from "vitest";
import type { ProjectSettings } from "./types";
import { reconcileModuleSettings } from "./module-settings";

const S = (s: ProjectSettings) => s; // typed literal helper

describe("reconcileModuleSettings — the Members-dependency invariant", () => {
  it("leaves everything untouched (same ref) when Members is enabled", () => {
    const s = S({
      members: { enabled: true, mode: "open" },
      comments: { enabled: true, moderation: "all" },
      broadcast: { enabled: true },
      bookings: { enabled: true, requireLogin: true },
    });
    expect(reconcileModuleSettings(s)).toBe(s);
  });

  it("HIGH#2: cascades comments + broadcast OFF when Members is disabled", () => {
    const s = S({
      members: { enabled: false },
      comments: { enabled: true, moderation: "moderated" },
      broadcast: { enabled: true },
    });
    const out = reconcileModuleSettings(s);
    expect(out.comments?.enabled).toBe(false);
    expect(out.broadcast?.enabled).toBe(false);
  });

  it("HIGH#3: neutralizes bookings.requireLogin when Members is disabled", () => {
    const out = reconcileModuleSettings(
      S({ members: { enabled: false }, bookings: { enabled: true, requireLogin: true } }),
    );
    expect(out.bookings?.requireLogin).toBe(false);
  });

  it("cascades even when Members was never present at all", () => {
    const out = reconcileModuleSettings(
      S({ comments: { enabled: true }, bookings: { enabled: true, requireLogin: true } }),
    );
    expect(out.comments?.enabled).toBe(false);
    expect(out.bookings?.requireLogin).toBe(false);
  });

  it("keeps bookings working for GUESTS — only requireLogin drops, not enabled/autoConfirm", () => {
    const out = reconcileModuleSettings(
      S({ members: { enabled: false }, bookings: { enabled: true, requireLogin: true, autoConfirm: true, sendReminders: true } }),
    );
    expect(out.bookings?.enabled).toBe(true);
    expect(out.bookings?.requireLogin).toBe(false);
    expect(out.bookings?.autoConfirm).toBe(true);
    expect(out.bookings?.sendReminders).toBe(true);
  });

  it("preserves comments.moderation when forcing comments off", () => {
    const out = reconcileModuleSettings(
      S({ members: { enabled: false }, comments: { enabled: true, moderation: "all" } }),
    );
    expect(out.comments?.moderation).toBe("all");
  });

  it("is idempotent (a second pass changes nothing)", () => {
    const once = reconcileModuleSettings(
      S({ members: { enabled: false }, comments: { enabled: true }, broadcast: { enabled: true }, bookings: { enabled: true, requireLogin: true } }),
    );
    expect(reconcileModuleSettings(once)).toEqual(once);
  });

  it("returns the same ref when already consistent (members off, dependents off)", () => {
    const s = S({
      members: { enabled: false },
      comments: { enabled: false, moderation: "moderated" },
      broadcast: { enabled: false },
      bookings: { enabled: true, requireLogin: false },
    });
    expect(reconcileModuleSettings(s)).toBe(s);
  });

  it("does not invent dependent objects that weren't there", () => {
    const out = reconcileModuleSettings(S({ members: { enabled: false } }));
    expect(out.comments).toBeUndefined();
    expect(out.broadcast).toBeUndefined();
    expect(out.bookings).toBeUndefined();
  });
});
