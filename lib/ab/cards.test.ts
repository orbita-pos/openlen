// @vitest-environment node
// THE CARD OF A HARM STOP (review item 23): the push says «stopped for protection» and opens a screen; the screen must have
// the experiment on it, as a card to read — for a while.
import { describe, expect, it } from "vitest";

import { HARM_NOTICE_DAYS, isRecentHarmStop, visibleAbCards } from "./cards";
import type { AbExperimentView } from "./types";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function exp(patch: Partial<AbExperimentView> & { id: string }): AbExperimentView {
  return {
    projectId: "p1",
    assistantId: null,
    name: "Hero",
    hypothesis: null,
    targetPath: "/",
    includeLocales: false,
    primaryMetric: "conversion_any",
    splitBps: 5000,
    status: "running",
    decisionStatus: "none",
    copyProjectId: null,
    bringState: null,
    winnerVariant: null,
    metrics: null,
    startedAt: iso(10 * DAY),
    minEndAt: null,
    endedAt: null,
    evaluatedAt: null,
    createdAt: iso(11 * DAY),
    ...patch,
  };
}

describe("isRecentHarmStop", () => {
  it("🔴 a harm stop of the last 14 days is a card; an older one, or a running test, is not", () => {
    expect(HARM_NOTICE_DAYS).toBe(14);
    expect(isRecentHarmStop(exp({ id: "a", status: "paused_harm", endedAt: iso(2 * DAY) }), NOW)).toBe(true);
    expect(isRecentHarmStop(exp({ id: "a", status: "paused_harm", endedAt: iso(13.9 * DAY) }), NOW)).toBe(true);
    expect(isRecentHarmStop(exp({ id: "a", status: "paused_harm", endedAt: iso(14.1 * DAY) }), NOW)).toBe(false);
    expect(isRecentHarmStop(exp({ id: "a", status: "paused_harm", endedAt: null }), NOW)).toBe(false);
    expect(isRecentHarmStop(exp({ id: "a", status: "kept_a", endedAt: iso(DAY) }), NOW)).toBe(false);
  });
});

describe("visibleAbCards", () => {
  it("lists drafts, pending decisions, conflicts, recent harm stops and the linked one — and nothing else", () => {
    const list = [
      exp({ id: "draft", status: "draft" }),
      exp({ id: "pending", status: "winner_ready", decisionStatus: "pending" }),
      exp({ id: "inconclusive", status: "inconclusive", decisionStatus: "pending" }),
      exp({ id: "applying", status: "winner_ready", decisionStatus: "applying" }),
      exp({ id: "conflict", status: "promoted_b", bringState: "conflict" }),
      exp({ id: "harm", status: "paused_harm", decisionStatus: "resolved", endedAt: iso(3 * DAY) }),
      exp({ id: "old-harm", status: "paused_harm", decisionStatus: "resolved", endedAt: iso(30 * DAY) }),
      exp({ id: "running" }),
      exp({ id: "kept", status: "kept_a", decisionStatus: "resolved" }),
      exp({ id: "linked", status: "kept_a", decisionStatus: "resolved" }),
    ];
    expect(visibleAbCards(list, { now: NOW, highlight: "linked" }).map((e) => e.id)).toEqual([
      "draft",
      "pending",
      "inconclusive",
      "conflict",
      "harm",
      "linked",
    ]);
  });
});
