// From a visitor's report to an incident: one check per project at a time, none while an incident
// stands, nothing for a project that is muted or not published.
import { describe, expect, it, vi } from "vitest";

import type { LoadCheck } from "./check";
import { ACTIVE_CACHE_MS, CHECK_INTERVAL_MS, createIngester, MAX_PENDING_CHECKS, type IngestDeps } from "./ingest";
import type { ProjectForWatch } from "./owner";
import type { Incident, LenWatchSettings, WatchReport } from "./types";

const REPORT: WatchReport = { message: "boom", file: null, line: null, col: null, page: null };
const PROJECT: ProjectForWatch = { projectId: "p1", ownerId: "u1", title: "Holi", subdomain: "holi", url: "https://holi.openlen.app", locale: "es", timeZone: "America/Mexico_City" };

function incident(over: Partial<Incident> = {}): Incident {
  const now = new Date();
  return { id: "i1", projectId: "p1", status: "open", sample: REPORT, reports: 1, summary: null, reason: null, shipsUnpublished: false, turnRowId: null, createdAt: now, updatedAt: now, resolvedAt: null, resolution: null, fixStamp: null, ...over };
}

function fakeDeps(o: { active?: Incident | null; settings?: Partial<LenWatchSettings>; project?: ProjectForWatch | null; check?: LoadCheck; clock?: { t: number } } = {}) {
  let opened: Incident | null = null;
  const clock = o.clock ?? { t: 1_000_000 };
  const deps = {
    store: {
      getSettings: vi.fn(async () => ({ autoFix: false, autoPublish: false, muted: false, locale: null, ...o.settings })),
      activeIncident: vi.fn(async () => o.active ?? opened),
      countReport: vi.fn(async () => undefined),
      openIncident: vi.fn(async () => {
        if (opened) return null;
        opened = incident();
        return opened;
      }),
    },
    project: vi.fn(async () => (o.project === undefined ? PROJECT : o.project)),
    check: vi.fn(async (_url: string): Promise<LoadCheck> => o.check ?? { loads: false, reason: "blank", errors: ["kaput"] }),
    onOpened: vi.fn(async () => undefined),
    now: () => clock.t,
  };
  return { deps: deps as unknown as IngestDeps & typeof deps, clock };
}

describe("ingestWatchReport", () => {
  it("500 visitors at once: one check, one incident, one notice", async () => {
    const { deps } = fakeDeps();
    const ingest = createIngester(deps);
    await Promise.all(Array.from({ length: 500 }, () => ingest("p1", REPORT)));
    expect(deps.check).toHaveBeenCalledTimes(1);
    expect(deps.store.openIncident).toHaveBeenCalledTimes(1);
    expect(deps.onOpened).toHaveBeenCalledTimes(1);
    expect(deps.onOpened).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), PROJECT, { loads: false, reason: "blank", errors: ["kaput"] });
  });

  it("our browser sees it load: nothing opens", async () => {
    const { deps } = fakeDeps({ check: { loads: true, reason: "ok", errors: [] } });
    await createIngester(deps)("p1", REPORT);
    expect(deps.store.openIncident).not.toHaveBeenCalled();
    expect(deps.onOpened).not.toHaveBeenCalled();
  });

  it("an incident that stands (even a failed fix) only counts the report", async () => {
    const { deps } = fakeDeps({ active: incident({ status: "fix_failed" }) });
    await createIngester(deps)("p1", REPORT);
    expect(deps.store.countReport).toHaveBeenCalledWith("i1", 1);
    expect(deps.check).not.toHaveBeenCalled();
    expect(deps.onOpened).not.toHaveBeenCalled();
  });

  it(`🔴 while an incident stands, the database is read once per ${ACTIVE_CACHE_MS / 1000} s, not once per visitor`, async () => {
    const clock = { t: 1_000_000 };
    const { deps } = fakeDeps({ active: incident({ status: "fixing" }), clock });
    const ingest = createIngester(deps);
    for (let n = 0; n < 100; n++) await ingest("p1", REPORT);
    expect(deps.project).toHaveBeenCalledTimes(1);
    expect(deps.store.activeIncident).toHaveBeenCalledTimes(1);
    expect(deps.store.countReport).toHaveBeenCalledTimes(1);
    clock.t += ACTIVE_CACHE_MS + 1;
    await ingest("p1", REPORT);
    // The 99 counted in memory go in with the one that reads again.
    expect(deps.store.countReport).toHaveBeenLastCalledWith("i1", 100);
    expect(deps.store.activeIncident).toHaveBeenCalledTimes(2);
  });

  it("muted or not published: no check", async () => {
    const muted = fakeDeps({ settings: { muted: true } }).deps;
    await createIngester(muted)("p1", REPORT);
    expect(muted.check).not.toHaveBeenCalled();
    const unpublished = fakeDeps({ project: { ...PROJECT, subdomain: null, url: null } }).deps;
    await createIngester(unpublished)("p1", REPORT);
    expect(unpublished.check).not.toHaveBeenCalled();
  });

  it(`one check per project every ${CHECK_INTERVAL_MS / 60_000} minutes`, async () => {
    const { deps, clock } = fakeDeps({ check: { loads: true, reason: "ok", errors: [] } });
    const ingest = createIngester(deps);
    await ingest("p1", REPORT);
    clock.t += 4 * 60_000;
    await ingest("p1", REPORT);
    expect(deps.check).toHaveBeenCalledTimes(1);
    clock.t += 2 * 60_000;
    await ingest("p1", REPORT);
    expect(deps.check).toHaveBeenCalledTimes(2);
  });

  it(`🔴 a flood across many projects: at most ${MAX_PENDING_CHECKS} checks wait; the rest are dropped, not claimed`, async () => {
    const releases: (() => void)[] = [];
    const { deps } = fakeDeps();
    deps.check.mockImplementation(() => new Promise<LoadCheck>((resolve) => releases.push(() => resolve({ loads: true, reason: "ok", errors: [] }))));
    const ingest = createIngester(deps);
    const all = Array.from({ length: 20 }, (_, i) => ingest(`p${i}`, REPORT));
    for (let n = 0; n < 40 && releases.length < MAX_PENDING_CHECKS; n++) {
      await new Promise((r) => setTimeout(r, 0));
      releases.splice(0).forEach((release) => release());
    }
    await Promise.all(all);
    expect(deps.check).toHaveBeenCalledTimes(MAX_PENDING_CHECKS);
    // A dropped project wasn't claimed: its next report is checked.
    deps.check.mockResolvedValue({ loads: true, reason: "ok", errors: [] });
    await ingest("p19", REPORT);
    expect(deps.check).toHaveBeenCalledTimes(MAX_PENDING_CHECKS + 1);
  });

  it("checks the page that was reported, not always the home", async () => {
    const { deps } = fakeDeps({ check: { loads: true, reason: "ok", errors: [] } });
    await createIngester(deps)("p1", { ...REPORT, page: "menu" });
    expect(deps.check.mock.calls[0]![0]).toMatch(/\/menu\/$/);
  });
});
