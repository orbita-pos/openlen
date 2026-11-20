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
    decisionPrevStatus: null,
    decisionLockedAt: null,
    maxEndAt: null,
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
    locale: "en",
    assistant: null,
  };
  return {
    releaseStaleLocks: vi.fn(async () => []),
    listRunning: vi.fn(async () => [exp]),
    listUnannounced: vi.fn(async () => []),
    projectInfo: vi.fn(async () => proj),
    computeMetrics: vi.fn(async () => makeSnapshot(opts.verdict ?? "winner_b")),
    saveSnapshot: vi.fn(async () => true),
    upsertDaily: vi.fn(async () => {}),
    autoStopForHarm: vi.fn(async () => ({ restored: true })),
    notify: vi.fn(async () => {}),
    markNotified: vi.fn(async () => {}),
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
    // The snapshot write never claims it was told: only the queue does, afterwards.
    expect(vi.mocked(deps.saveSnapshot).mock.calls[0]![1]).not.toHaveProperty("notifiedAt");
    expect(deps.markNotified).toHaveBeenCalledWith("ab_9f3c2a1b", NOW);
  });

  it("defers winner notification to the 8 a.m. morning summary when the assistant has morningSummary enabled", async () => {
    const deps = makeDeps({
      verdict: "winner_b",
      project: {
        id: "p1",
        ownerId: "u1",
        title: "Cafetería Sol",
        subdomain: "cafesol",
        locale: "es",
        assistant: {
          id: "a1",
          name: "Lucía",
          slug: "lucia",
          morningSummary: true,
        },
      },
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.winners).toBe(1);
    expect(stats.notifiedDirectly).toBe(0);
    expect(deps.notify).not.toHaveBeenCalled();
    // The summary says it, and marks it told: the evaluator marks nothing it didn't send.
    expect(deps.markNotified).not.toHaveBeenCalled();
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
        locale: "es",
        assistant: {
          id: "a1",
          name: "Lucía",
          slug: "lucia",
          morningSummary: true,
        },
      },
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.harmStopped).toBe(1);
    expect(stats.notifiedDirectly).toBe(1);
    expect(deps.autoStopForHarm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.autoStopForHarm).mock.calls[0]!.slice(1, 3)).toEqual(["u1", "cafesol"]);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.verdict).toBe("harm_stop");
    expect(event.assistantId).toBe("a1");
    expect(event.emailText).not.toMatch(/un clic|one click/i);
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

describe("the evaluator never overwrites a person (item 21)", () => {
  it("🔴 an experiment whose decision is being applied is not touched at all", async () => {
    const deps = makeDeps({ verdict: "winner_b", exp: makeExp({ decisionStatus: "applying" }) });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.evaluated).toBe(0);
    expect(deps.computeMetrics).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
    expect(deps.autoStopForHarm).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("🔴 a verdict write that doesn't land (a person claimed the decision meanwhile) changes nothing and tells nobody", async () => {
    const deps = makeDeps({ verdict: "winner_b" });
    vi.mocked(deps.saveSnapshot).mockResolvedValue(false);
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats).toMatchObject({ winners: 0, inconclusive: 0, notifiedDirectly: 0 });
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.markNotified).not.toHaveBeenCalled();
  });

  it("🔴 the harm brake claims the decision first: when it can't (a person is deciding) nothing is published, saved or announced", async () => {
    const deps = makeDeps({ verdict: "harm_stop" });
    vi.mocked(deps.autoStopForHarm).mockResolvedValue(null);
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.harmStopped).toBe(0);
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("sweeps the stale decision locks first, and a sweep that fails doesn't stop the pass", async () => {
    const deps = makeDeps({ verdict: "collecting" });
    vi.mocked(deps.releaseStaleLocks).mockRejectedValue(new Error("db"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(evaluateRunningExperiments(deps, NOW)).resolves.toMatchObject({ evaluated: 1 });
    warn.mockRestore();
    expect(deps.releaseStaleLocks).toHaveBeenCalledWith(NOW);
  });
});

describe("notices are at least once (item 22)", () => {
  it("🔴 notifiedAt is set only after the notice was queued: a queue that fails leaves it unset", async () => {
    const deps = makeDeps({ verdict: "winner_b" });
    vi.mocked(deps.notify).mockRejectedValue(new Error("queue down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await evaluateRunningExperiments(deps, NOW);
    warn.mockRestore();
    expect(deps.saveSnapshot).toHaveBeenCalledWith("ab_9f3c2a1b", expect.objectContaining({ status: "winner_ready" }));
    expect(deps.markNotified).not.toHaveBeenCalled();
  });

  it("🔴 the next pass sends what a deploy cut between the verdict and the queue (final status, never notified)", async () => {
    const cut = makeExp({ status: "winner_ready", decisionStatus: "pending", winnerVariant: "b", metricsSnapshot: makeSnapshot("winner_b") });
    const deps = makeDeps({ verdict: "collecting", exp: makeExp({ startedAt: null }) });
    vi.mocked(deps.listUnannounced).mockResolvedValue([cut]);
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats.notifiedDirectly).toBe(1);
    const [event, key] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.verdict).toBe("winner_b");
    expect(key).toBe("ab_result:ab_9f3c2a1b:winner_b");
    expect(deps.markNotified).toHaveBeenCalledWith("ab_9f3c2a1b", NOW);
  });

  it("the sweep leaves a winner to the morning summary, but a harm stop is always sent", async () => {
    const morning = { id: "a1", name: "Lucía", slug: "lucia", morningSummary: true };
    const proj = { id: "p1", ownerId: "u1", title: "Cafetería", subdomain: "cafesol", locale: "en", assistant: morning };
    const winner = makeExp({ status: "winner_ready", decisionStatus: "pending", winnerVariant: "b", metricsSnapshot: makeSnapshot("winner_b") });
    const harm = makeExp({ id: "ab_harm0001", status: "paused_harm", decisionStatus: "resolved", winnerVariant: "a", metricsSnapshot: makeSnapshot("harm_stop") });
    const deps = makeDeps({ verdict: "collecting", exp: makeExp({ startedAt: null }), project: proj });
    vi.mocked(deps.listUnannounced).mockResolvedValue([winner, harm]);
    await evaluateRunningExperiments(deps, NOW);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.notify).mock.calls[0]![0].experimentId).toBe("ab_harm0001");
  });

  it("🔴 the harm notice says the original was put back only if it was: no site address → another text", async () => {
    const deps = makeDeps({ verdict: "harm_stop", project: { id: "p1", ownerId: "u1", title: "Cafetería", subdomain: null, locale: "en", assistant: null } });
    vi.mocked(deps.autoStopForHarm).mockResolvedValue({ restored: false });
    await evaluateRunningExperiments(deps, NOW);
    expect(vi.mocked(deps.autoStopForHarm).mock.calls[0]![2]).toBeNull();
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.push).toMatch(/isn't published/);
    expect(event.push).not.toMatch(/restored the original/);
  });
});

describe("the notices speak the owner's language (item 29)", () => {
  const info = (locale: string, assistant: EvaluatorProjectInfo["assistant"] = null): EvaluatorProjectInfo => ({ id: "p1", ownerId: "u1", title: "Cafetería", subdomain: "cafesol", locale, assistant });

  it("🔴 the text and the link use the OWNER's locale, not the assistant's summary locale or English", async () => {
    const deps = makeDeps({ verdict: "winner_b", project: info("es") });
    await evaluateRunningExperiments(deps, NOW);
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.locale).toBe("es");
    expect(event.push).toMatch(/convirtió/);
    expect(event.emailText).toContain("https://openlen.com/es/new?project=p1");
  });

  it("with an assistant the link is her place, in the owner's language too", async () => {
    const deps = makeDeps({ verdict: "harm_stop", project: info("ja", { id: "a1", name: "Lucía", slug: "lucia", morningSummary: true }) });
    await evaluateRunningExperiments(deps, NOW);
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.locale).toBe("ja");
    expect(event.emailText).toContain("https://openlen.com/ja/assistant/lucia");
  });
});

describe("an experiment that never got an even split ends, and the owner is told (item 24)", () => {
  it("🔴 inconclusive for uneven traffic: it becomes a pending decision and the notice says why", async () => {
    const deps = makeDeps({ verdict: "inconclusive" });
    vi.mocked(deps.computeMetrics).mockResolvedValue({
      ...makeSnapshot("inconclusive"),
      stats: { ...makeSnapshot("inconclusive").stats, srmWarning: true, reason: "uneven_traffic" },
    });
    const stats = await evaluateRunningExperiments(deps, NOW);
    expect(stats).toMatchObject({ inconclusive: 1, notifiedDirectly: 1 });
    expect(deps.saveSnapshot).toHaveBeenCalledWith("ab_9f3c2a1b", expect.objectContaining({ status: "inconclusive", decisionStatus: "pending" }));
    const [event] = vi.mocked(deps.notify).mock.calls[0]!;
    expect(event.verdict).toBe("inconclusive");
    expect(event.push).toMatch(/unevenly/);
  });

  it("an ordinary inconclusive keeps its ordinary text", async () => {
    const deps = makeDeps({ verdict: "inconclusive" });
    await evaluateRunningExperiments(deps, NOW);
    expect(vi.mocked(deps.notify).mock.calls[0]![0].push).toMatch(/no clear winner/);
  });
});

describe("abNotificationTexts & abSummaryLine across all 10 locales", () => {
  const LOCALES = ["de", "en", "es", "fr", "it", "ja", "ko", "nl", "pt", "zh"];

  it("🔴 a long experiment name is cut in the push, never the question after it — in every locale and every verdict", () => {
    const long = "Probando un titular larguísimo ".repeat(10).trim();
    for (const locale of LOCALES) {
      for (const verdict of ["winner_b", "winner_a", "inconclusive", "harm_stop"] as const) {
        const short = abNotificationTexts(locale, { name: "Hero", verdict, liftPct: 31, probabilityPct: 97, url: "https://openlen.com/x" });
        const res = abNotificationTexts(locale, { name: long, verdict, liftPct: 31, probabilityPct: 97, url: "https://openlen.com/x" });
        expect(res.push.length, `${locale}:${verdict}`).toBeLessThan(200);
        // the tail of the sentence (what comes after the name) is what the short version has, whole
        const tailOf = (s: string) => s.slice(s.indexOf("Hero") + "Hero".length);
        expect(res.push.endsWith(tailOf(short.push)), `${locale}:${verdict}: ${res.push}`).toBe(true);
        expect(res.push, `${locale}:${verdict}`).toContain("…");
        // the email keeps the whole name
        expect(res.emailText, locale).toContain(long);
      }
    }
  });

  it("🔴 the uneven-traffic ending has its own text in every locale, push and morning summary", () => {
    for (const locale of LOCALES) {
      const res = abNotificationTexts(locale, { name: "Hero CTA", verdict: "inconclusive", liftPct: 0, probabilityPct: 0, url: "https://openlen.com/x", reason: "uneven_traffic" });
      const plain = abNotificationTexts(locale, { name: "Hero CTA", verdict: "inconclusive", liftPct: 0, probabilityPct: 0, url: "https://openlen.com/x" });
      expect(res.push, locale).not.toBe(plain.push);
      expect(res.push, locale).toContain("Hero CTA");
      expect(res.push, locale).not.toMatch(/ownAssistant|\{/);
      const line = abSummaryLine(locale, [{ experimentId: "ab_1", projectId: "p1", projectTitle: "T", name: "Hero CTA", status: "inconclusive", winnerVariant: null, rateA: 0.04, rateB: 0.04, liftPct: 0, totalViews: 900, probability: 0.5, reason: "uneven_traffic" }]);
      expect(line, locale).toContain("Hero CTA");
      expect(line, locale).not.toMatch(/ownAssistant|\{/);
    }
  });

  it("🔴 the harm stop that found no site to restore says so in every locale, and its email only informs", () => {
    for (const locale of LOCALES) {
      const base = { name: "Hero CTA", verdict: "harm_stop" as const, liftPct: -50, probabilityPct: 97, url: "https://openlen.com/x" };
      const restored = abNotificationTexts(locale, base);
      const notRestored = abNotificationTexts(locale, { ...base, restored: false });
      expect(notRestored.push, locale).not.toBe(restored.push);
      expect(notRestored.push, locale).not.toMatch(/ownAssistant|\{/);
      expect(notRestored.emailText, locale).toContain("https://openlen.com/x");
      const decide = abNotificationTexts(locale, { ...base, verdict: "winner_b" });
      expect(restored.emailText, locale).not.toBe(decide.emailText.replace(decide.push, restored.push));
    }
  });

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
