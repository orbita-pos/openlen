// FROM A VISITOR'S REPORT TO AN INCIDENT (spec local 2026-10-30-len-watch, §5.2). A report alone proves
// nothing — one visitor's broken extension blanks a page too — so OpenLen opens the page in its own
// browser before anyone hears of it. One check per project every CHECK_INTERVAL_MS, claimed BEFORE
// any await so 500 visitors at once make one; one Chromium at a time for the whole process (the box
// is small). While an incident stands, reports are only counted: no check, no turn.
import "server-only";

import type { LoadCheck } from "./check";
import { pageUrl, type ProjectForWatch } from "./owner";
import type { Incident, LenWatchSettings, WatchReport } from "./types";

export const CHECK_INTERVAL_MS = 300_000;
/** Checks waiting (or running) at once, across projects. Anyone can post a report for any published
 *  project; past this, a report is dropped WITHOUT claiming the project, so it is checked next time. */
export const MAX_PENDING_CHECKS = 5;
/** While an incident stands, a project's reports are counted in memory and the database is read again
 *  only this often: a crashed popular site sends one report per visitor. A restart loses at most one
 *  window of counts — they're a statistic, not a decision. */
export const ACTIVE_CACHE_MS = 60_000;

export interface IngestDeps {
  store: {
    getSettings(projectId: string): Promise<LenWatchSettings>;
    activeIncident(projectId: string): Promise<Incident | null>;
    countReport(incidentId: string, n: number): Promise<void>;
    openIncident(projectId: string, sample: WatchReport): Promise<Incident | null>;
  };
  project(projectId: string): Promise<ProjectForWatch | null>;
  check(url: string): Promise<LoadCheck>;
  onOpened(incident: Incident, project: ProjectForWatch, check: LoadCheck): Promise<void>;
  now(): number;
}

export type Ingest = (projectId: string, report: WatchReport) => Promise<void>;

export function createIngester(deps: IngestDeps): Ingest {
  const lastAttempt = new Map<string, number>();
  const knownActive = new Map<string, { until: number; uncounted: number }>();
  let pending = 0;
  let chromium: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(f: () => Promise<T>): Promise<T> => {
    const run = chromium.then(f, f);
    chromium = run.catch(() => undefined);
    return run;
  };

  return async (projectId, report) => {
    const now = deps.now();
    const known = knownActive.get(projectId);
    if (known && now < known.until) {
      known.uncounted++;
      return;
    }
    const last = lastAttempt.get(projectId);
    const recent = last !== undefined && now - last < CHECK_INTERVAL_MS;
    if (!recent) lastAttempt.set(projectId, now);

    const project = await deps.project(projectId);
    if (!project?.url) return;
    if ((await deps.store.getSettings(projectId)).muted) return;
    const active = await deps.store.activeIncident(projectId);
    if (active) {
      knownActive.set(projectId, { until: now + ACTIVE_CACHE_MS, uncounted: 0 });
      await deps.store.countReport(active.id, 1 + (known?.uncounted ?? 0));
      return;
    }
    knownActive.delete(projectId);
    if (recent) return;
    if (pending >= MAX_PENDING_CHECKS) {
      if (lastAttempt.get(projectId) === now) lastAttempt.delete(projectId);
      return;
    }

    pending++;
    let check: LoadCheck;
    try {
      check = await oneAtATime(() => deps.check(pageUrl(project, report.page)));
    } finally {
      pending--;
    }
    if (check.loads) return;
    const incident = await deps.store.openIncident(projectId, report);
    if (!incident) return;
    await deps.onOpened(incident, project, check);
  };
}

let ingester: Ingest | null = null;

async function defaultDeps(): Promise<IngestDeps> {
  const [store, owner, { checkPublishedLoads }, { onIncidentOpened, recoverIfStale }] = await Promise.all([
    import("./store"),
    import("./owner"),
    import("./check"),
    import("./orchestrate"),
  ]);
  return {
    // A fix cut by a restart is handed back to the owner before the report is weighed.
    store: { ...store, activeIncident: async (projectId) => {
      const i = await store.activeIncident(projectId);
      return i ? recoverIfStale(i) : null;
    } },
    project: owner.projectForWatch,
    check: (url) => checkPublishedLoads(url, { allowOrigins: owner.allowedCheckOrigins() }),
    onOpened: (incident, project, check) => onIncidentOpened(incident, project, check),
    now: Date.now,
  };
}

/** What `/c` calls with a parsed report. Fails soft: the beacon has already answered. */
export async function ingestWatchReport(projectId: string, report: WatchReport): Promise<void> {
  ingester ??= createIngester(await defaultDeps());
  await ingester(projectId, report);
}
