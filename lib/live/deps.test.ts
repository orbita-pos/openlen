// @vitest-environment node
//
// liveRepublishDeps().notifyBroken wiring (Task 14 — the channel now has a
// live_sheet_broken member in the NotificationEvent union, so this closure
// can finally call scheduleNotification for real). Mocks @/lib/projects
// (pulls lib/normalize → the native @openlen/html-engine .node binding
// vitest can't load, same reason app/api/internal/live-republish/route.test.ts
// mocks lib/live/deps wholesale) and @/lib/notifications/dispatch (no real
// Postgres) so this test exercises the REAL wiring in deps.ts instead of a
// stand-in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { scheduleNotification } = vi.hoisted(() => ({
  scheduleNotification: vi.fn(async () => {}),
}));

vi.mock("@/lib/projects", () => ({
  publishProject: vi.fn(async () => ({})),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleNotification,
}));

import { liveRepublishDeps } from "./deps";
import type { RepublishTarget } from "./republish";

const target: RepublishTarget = {
  projectId: "p1",
  userId: "u1",
  subdomain: "s1",
  valueSheetUrl: null,
  collections: [],
};

describe("liveRepublishDeps().notifyBroken", () => {
  beforeEach(() => {
    scheduleNotification.mockClear();
  });

  it("agenda un evento live_sheet_broken con missingCount 0 y la dedupeKey estable por (proyecto, sheet)", async () => {
    const deps = liveRepublishDeps();
    expect(deps.notifyBroken).toBeTypeOf("function");

    await deps.notifyBroken!(target, "https://docs.google.com/x", "some reason");

    expect(scheduleNotification).toHaveBeenCalledTimes(1);
    const [event, dedupeKey] = scheduleNotification.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(event).toMatchObject({
      type: "live_sheet_broken",
      projectId: "p1",
      recipientUserId: "u1",
      sheetUrl: "https://docs.google.com/x",
      missingCount: 0,
    });
    expect(dedupeKey).toBe("live-broken:p1:https://docs.google.com/x");
  });
});
