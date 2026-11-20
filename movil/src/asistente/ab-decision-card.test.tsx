// Mobile A/B decision card tests (Plan 3).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("use-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k} ${JSON.stringify(v)}` : k,
}));
vi.mock("../api/asistente", () => ({
  decidirPruebaAb: vi.fn(),
}));

import type { AbExperimentView } from "@/lib/ab/types";
import { decidirPruebaAb } from "../api/asistente";
import { MobileAbDecisionCard } from "./ab-decision-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EXP: AbExperimentView = {
  id: "ab_9f3c2a1b",
  projectId: "p1",
  projectTitle: "Cafetería Sol",
  assistantId: "a1",
  name: "Hero principal",
  hypothesis: "CTA más visible",
  targetPath: "/",
  includeLocales: false,
  primaryMetric: "conversion_any",
  splitBps: 5000,
  status: "winner_ready",
  decisionStatus: "pending",
  copyProjectId: "copy1",
  bringState: null,
  winnerVariant: "b",
  metrics: {
    a: { views: 412, clicks: 30, conversions: 16, rate: 16 / 412 },
    b: { views: 428, clicks: 52, conversions: 22, rate: 22 / 428 },
    stats: {
      verdict: "winner_b",
      winner: "b",
      probBBeatsA: 0.97,
      probABeatsB: 0.03,
      probHarm30: 0,
      expectedLossB: 0.0008,
      expectedLossA: 0.015,
      relativeLift: 0.31,
      liftCiLow: 0.05,
      liftCiHigh: 0.62,
      alwaysValidP: 0.01,
      srmChi2: 0.3,
      srmWarning: false,
      durationHours: 100,
    },
    computedAt: "2026-11-19T12:00:00Z",
  },
  startedAt: "2026-11-15T08:00:00Z",
  minEndAt: "2026-11-18T08:00:00Z",
  endedAt: "2026-11-19T12:00:00Z",
  evaluatedAt: "2026-11-19T12:00:00Z",
  createdAt: "2026-11-15T07:50:00Z",
};

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function mountCard(exp: AbExperimentView = EXP, onActualizado = vi.fn()) {
  const host = document.createElement("ul");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MobileAbDecisionCard
        cliente={{} as never}
        experiment={exp}
        assistantName="Lucía"
        idioma="es"
        resaltado={false}
        onActualizado={onActualizado}
      />,
    );
  });
  return { host, onActualizado };
}

describe("MobileAbDecisionCard", () => {
  it("calls decidirPruebaAb('promote_b') and refreshes on success", async () => {
    vi.mocked(decidirPruebaAb).mockResolvedValueOnce({
      ok: true,
      experiment: { ...EXP, status: "promoted_b", decisionStatus: "resolved", bringState: "brought" },
    });
    const { host, onActualizado } = await mountCard();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-ab-promote-b]")!.click();
    });
    expect(decidirPruebaAb).toHaveBeenCalledWith(expect.anything(), "p1", "ab_9f3c2a1b", "promote_b", "es");
    expect(onActualizado).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("own.ab.promotedDone");
  });

  it("🔴 a test the harm brake stopped is a card to read: its headline and notice, no decision buttons (item 23)", async () => {
    const { host } = await mountCard({ ...EXP, status: "paused_harm", decisionStatus: "resolved", winnerVariant: "a" });
    expect(host.textContent).toContain("own.ab.harmStopTitle");
    expect(host.textContent).toContain("own.ab.pausedHarmNotice");
    expect(host.querySelector("[data-ab-promote-b]")).toBeNull();
    expect(host.querySelector("[data-ab-keep-a]")).toBeNull();
    expect(host.querySelector("[data-ab-extend]")).toBeNull();
  });

  it("shows conflict message when another device decided first (409)", async () => {
    vi.mocked(decidirPruebaAb).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "decision_conflict",
    });
    const { host, onActualizado } = await mountCard();
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-ab-keep-a]")!.click();
    });
    expect(onActualizado).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("own.ab.decidedByConflict");
  });
});
