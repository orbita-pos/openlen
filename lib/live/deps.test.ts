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

const mocks = vi.hoisted(() => ({
  scheduleNotification: vi.fn(async () => {}),
  publishProject: vi.fn(async () => ({})),
  collectLiveTargets: vi.fn(async () => []),
  fetchSheet: vi.fn(async () => ({ values: new Map(), rows: [{ nombre: "X" }] })),
  putCachedSheet: vi.fn(async () => {}),
  syncCollectionFromSheet: vi.fn(async () => ({ upserted: 1, archived: 0 })),
}));
const { scheduleNotification } = mocks;

vi.mock("@/lib/projects", () => ({
  publishProject: mocks.publishProject,
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  scheduleNotification: mocks.scheduleNotification,
}));

vi.mock("./collect-targets", () => ({
  collectLiveTargets: mocks.collectLiveTargets,
}));

vi.mock("./sheet-source", () => ({
  fetchSheet: mocks.fetchSheet,
}));

vi.mock("./cache", () => ({
  putCachedSheet: mocks.putCachedSheet,
}));

vi.mock("@/lib/collections/sheet-sync", () => ({
  syncCollectionFromSheet: mocks.syncCollectionFromSheet,
}));

import { liveRepublishDeps } from "./deps";
import type { RepublishTarget } from "./republish";

const target: RepublishTarget = {
  projectId: "p1",
  userId: "u1",
  subdomain: "s1",
  valueSheetUrl: null,
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

// Minor de la revisión Task 12 (cerrado 2026-07-15): las otras 5 conexiones
// del objeto también quedan verificadas directamente — cada una es un
// pass-through, pero un typo en el nombre importado o un arg olvidado
// (p.ej. skipFlightCheck) pasaría tsc y solo se notaría en prod.
describe("liveRepublishDeps() — el resto del cableado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listTargets es collectLiveTargets", async () => {
    await liveRepublishDeps().listTargets();
    expect(mocks.collectLiveTargets).toHaveBeenCalledTimes(1);
  });

  it("fetchSheet pasa la URL y devuelve el SheetData del módulo real", async () => {
    const out = await liveRepublishDeps().fetchSheet("https://docs.google.com/y");
    expect(mocks.fetchSheet).toHaveBeenCalledWith("https://docs.google.com/y");
    expect(out.rows).toEqual([{ nombre: "X" }]);
  });


  it("warmCache reenvía (url, data) a putCachedSheet", async () => {
    const data = { values: new Map([["k", "v"]]), rows: [] };
    await liveRepublishDeps().warmCache!("https://docs.google.com/z", data);
    expect(mocks.putCachedSheet).toHaveBeenCalledWith("https://docs.google.com/z", data);
  });

  it("republish publica con skipFlightCheck:true y el trío exacto del target", async () => {
    await liveRepublishDeps().republish(target);
    expect(mocks.publishProject).toHaveBeenCalledWith({
      projectId: "p1",
      userId: "u1",
      subdomain: "s1",
      skipFlightCheck: true,
    });
  });
});
