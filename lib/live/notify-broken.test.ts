import { describe, it, expect, vi } from "vitest";
import { notifyBrokenSheet, brokenSheetDedupeKey } from "./notify-broken";

describe("notifyBrokenSheet", () => {
  it("dispara UNA notificación con una dedupeKey estable por (proyecto, sheet)", async () => {
    const schedule = vi.fn(async () => {});
    await notifyBrokenSheet(
      { projectId: "p1", ownerUserId: "u1", sheetUrl: "https://s/1", missingCount: 4 },
      { schedule },
    );
    expect(schedule).toHaveBeenCalledTimes(1);
    const [event, dedupeKey] = schedule.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(dedupeKey).toBe("live-broken:p1:https://s/1");
    expect(event).toMatchObject({ type: "live_sheet_broken", projectId: "p1", recipientUserId: "u1", missingCount: 4 });
    // The canonical NotificationEvent shape has no `reason` field — it must not leak onto the queued event.
    expect(event).not.toHaveProperty("reason");
  });

  it("la dedupeKey es idéntica para el mismo (proyecto, sheet) — el schedule deduplica el spam", () => {
    expect(brokenSheetDedupeKey("p1", "https://s/1")).toBe(brokenSheetDedupeKey("p1", "https://s/1"));
    expect(brokenSheetDedupeKey("p1", "https://s/1")).not.toBe(brokenSheetDedupeKey("p2", "https://s/1"));
    expect(brokenSheetDedupeKey("p1", "https://s/1")).not.toBe(brokenSheetDedupeKey("p1", "https://s/2"));
  });

  it("never-throw: si el schedule falla, no propaga (un aviso roto jamás rompe la corrida)", async () => {
    const schedule = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(
      notifyBrokenSheet(
        { projectId: "p1", ownerUserId: "u1", sheetUrl: "x", missingCount: 0 },
        { schedule },
      ),
    ).resolves.toBeUndefined();
  });
});
