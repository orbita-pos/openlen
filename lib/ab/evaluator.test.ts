// @vitest-environment node
// Evaluator + localized notification & summary copy tests (Plan 3).
import { describe, expect, it, vi } from "vitest";

import { evaluateRunningExperiments, type EvaluatorDeps, type EvaluatorProjectInfo } from "./evaluator";
import type { AbExperimentRow } from "./store";
import { abNotificationTexts, abSummaryLine } from "./texts";
import type { AbMetricsSnapshot } from "./types";

const NOW = new Date("2026-11-19T14:00:00Z");

function makeExp(patch: Partial<AbExperimentRow> = {}): AbExperimentRow {
  return {
    id: "ab_9f3c2a1b",
    projectId: "p1",
    assistantId: null,
    name: "Hero principal",
    hypothesis: "Botón más claro",
    targetPath: "/",
    includeLocales: false,
    primaryMetric: "conversion_any",
    splitBps: 5000,
    salt: "salt",
    status: "running",
    decisionStatus: "none",
    copyProjectId: "copy1",
    branch: "ab/ab_9f3c2a1b",
    baseCommitOid: "oid0",
    variantBCommitOid: "oid1",
    controlReleaseSha: "shaA",
    experimentReleaseSha: "shaAB",
    promotedReleaseSha: null,
    bringState: null,
    winnerVariant: null,
    metricsSnapshot: null,
    startedAt: new Date(NOW.getTime() - 96 * 3_600_000),
    minEndAt: new Date(NOW.getTime() - 24 * 3_600_000),
    endedAt: null,
    evaluatedAt: null,
    notifiedAt: null,
    snoozeUntil: null,
    decidedAt: null,
    decidedBy: null,
    createdBy: "u1",
    createdAt: new Date(NOW.getTime() - 100 * 3_600_000),
    updatedAt: new Date(NOW.getTime() - 96 * 3_600_000),
    ...patch,
  };
}

function makeSnapshot(verdict: AbMetricsSnapshot["stats"]["verdict"]): AbMetricsSnapshot {
  return {
    a: { views: 500, clicks: 40, conversions: 20, rate: 0.04 },
    b: { views: 500, clicks: 75, conversions: 35, rate: 0.07 },
    stats: {
      verdict,
      winner: verdict === "winner_b" ? "b" : verdict === "winner_a" || verdict === "harm_stop" ? "a" : null,
      probBBeatsA: verdict === "winner_b" ? 0.98 : 0.02,
      probABeatsB: verdict === "winner_b" ? 0.02 : 0.98,
      probHarm30: verdict === "harm_stop" ? 0.97 : 0.01,
      expectedLossB: 0.0005,
      expectedLossA: 0.02,
      relativeLift: verdict === "winner_b" ? 0.75 : -0.5,
      liftCiLow: 0.2,
      liftCiHigh: 1.2,
      alwaysValidP: 0.008,
      srmChi2: 0.1,
      srmWarning: false,
      durationHours: 96,
    },
    computedAt: NOW.toISOString(),
  };
}

function makeDeps(opts: {
  exp?: AbExperimentRow;
  project?: EvaluatorProjectInfo;
  verdict?: AbMetricsSnapshot["stats"]["verdict"];
}): EvaluatorDeps {
  const exp = opts.exp ?? makeExp();
  const proj: EvaluatorProjectInfo = opts.project ?? {
    id: "p1",
    ownerId: "u1",
    title: "Cafetería Sol",
    subdomain: "cafesol",
    assistant: null,
  };
  return {
    listRunning: vi.fn(async () => [exp]),
    projectInfo: vi.fn(async () => proj),
    computeMetrics: vi.fn(async () => makeSnapshot(opts.verdict ?? "winner_b")),
    saveSnapshot: vi.fn(async () => {}),
    upsertDaily: vi.fn(async () => {}),
    autoStopForHarm: vi.fn(async () => {}),
    notify: vi.fn(async () => {}),
    siteUrl: "https://openlen.com",
  };
}

describe("evaluateRunningExperiments", () => {
  it("transitions to winner_ready and notifies directly when project has NO assistant with morningSummary", async () => {
    const deps = makeDeps({ verdict: "winner_b" });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats).toEqual({
      evaluated: 1,
      winners: 1,
      inconclusive: 0,
      harmStopped: 0,
      notifiedDirectly: 1,
    });
    expect(deps.saveSnapshot).toHaveBeenCalledWith(
      "ab_9f3c2a1b",
      expect.objectContaining({ status: "winner_ready", decisionStatus: "pending", winnerVariant: "b" }),
    );
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [event, key] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.type).toBe("ab_result");
    expect(event.verdict).toBe("winner_b");
    expect(key).toBe("ab_result:ab_9f3c2a1b:winner_b");
  });

  it("defers winner notification to the 8 a.m. morning summary when the assistant has morningSummary enabled", async () => {
    const deps = makeDeps({
      verdict: "winner_b",
      project: {
        id: "p1",
        ownerId: "u1",
        title: "Cafetería Sol",
        subdomain: "cafesol",
        assistant: {
          id: "a1",
          name: "Lucía",
          slug: "lucia",
          morningSummary: true,
          summaryLocale: "es",
        },
      },
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.winners).toBe(1);
    expect(stats.notifiedDirectly).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).toHaveBeenCalledWith(
      "ab_9f3c2a1b",
      expect.objectContaining({ status: "winner_ready", decisionStatus: "pending" }),
    );
  });

  it("auto-stops and notifies IMMEDIATELY on harm_stop even with morningSummary ON and snoozeUntil set", async () => {
    const deps = makeDeps({
      verdict: "harm_stop",
      exp: makeExp({ snoozeUntil: new Date(NOW.getTime() + 48 * 3_600_000) }),
      project: {
        id: "p1",
        ownerId: "u1",
        title: "Cafetería Sol",
        subdomain: "cafesol",
        assistant: {
          id: "a1",
          name: "Lucía",
          slug: "lucia",
          morningSummary: true,
          summaryLocale: "es",
        },
      },
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.harmStopped).toBe(1);
    expect(stats.notifiedDirectly).toBe(1);
    expect(deps.autoStopForHarm).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.verdict).toBe("harm_stop");
    expect(event.assistantId).toBe("a1");
  });

  it("respects snoozeUntil for non-harm verdicts while still refreshing snapshot", async () => {
    const deps = makeDeps({
      verdict: "winner_b",
      exp: makeExp({ snoozeUntil: new Date(NOW.getTime() + 24 * 3_600_000) }),
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.evaluated).toBe(1);
    expect(stats.winners).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).toHaveBeenCalledWith(
      "ab_9f3c2a1b",
      expect.not.objectContaining({ status: "winner_ready" }),
    );
  });
});

describe("abNotificationTexts & abSummaryLine across all 10 locales", () => {
  const LOCALES = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"];

  it("renders valid, under-200-char pushes with zero leaked placeholders for every verdict and locale", () => {
    for (const locale of LOCALES) {
      for (const verdict of ["winner_b", "winner_a", "inconclusive", "harm_stop"] as const) {
        const res = abNotificationTexts(locale, {
          name: "Hero CTA",
          assistantName: "Lucía",
          verdict,
          liftPct: 31,
          probabilityPct: 97,
          url: "https://openlen.com/es/assistant/lucia",
        });
        expect(res.push.length, `${locale}:${verdict}`).toBeLessThan(200);
        expect(res.push, `${locale}:${verdict}`).not.toMatch(/ownAssistant|\{/);
        expect(res.emailText, `${locale}:${verdict}`).toContain("https://openlen.com/es/assistant/lucia");
      }

      const line = abSummaryLine(locale, [
        {
          experimentId: "ab_1",
          projectId: "p1",
          projectTitle: "Tienda",
          name: "Hero CTA",
          status: "winner_ready",
          winnerVariant: "b",
          rateA: 0.04,
          rateB: 0.052,
          liftPct: 31,
          totalViews: 840,
          probability: 0.97,
        },
      ]);
      expect(line.length, locale).toBeGreaterThan(10);
      expect(line, locale).not.toMatch(/ownAssistant|\{/);
    }
  });
});
