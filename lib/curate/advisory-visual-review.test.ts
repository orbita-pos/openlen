import { describe, expect, it, vi } from "vitest";

import type { SafeCreativeCandidate } from "./creative-baseline";
import { runAdvisoryVisualReview, type AdvisoryReviewDeps } from "./advisory-visual-review";
import { effortProfile } from "./page-effort";

const CANDIDATE: SafeCreativeCandidate = {
  html: "<!doctype html><html><body><section>safe</section></body></html>",
  title: "Marca",
  visualEngine: { route: "section_composition", templateId: null } as never,
  filled: true,
  appliedOps: 4,
  source: "deepseek",
};

const REPAIRED: SafeCreativeCandidate = { ...CANDIDATE, html: "<!doctype html><html><body><section>repaired</section></body></html>", source: "deepseek_repair" };

const INPUT = { requestId: "page-1", brief: "terror vhs", candidate: CANDIDATE };

function deps(over: Partial<AdvisoryReviewDeps> = {}): AdvisoryReviewDeps {
  return {
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    review: async () => ({ ok: true as const, accepted: true, issues: [] }),
    repair: async () => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const }),
    ...over,
  };
}

describe("advisory visual review", () => {
  it("delivers the candidate untouched when Qwen accepts", async () => {
    const repair = vi.fn();
    const result = await runAdvisoryVisualReview(INPUT, deps({ repair: repair as never }));
    expect(result).toMatchObject({ reviewed: true, repaired: false });
    expect(result.candidate).toEqual(CANDIDATE);
    expect(repair).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", { review: async () => ({ ok: false as const }) }],
    ["malformed", { review: async () => ({ ok: true as const, accepted: undefined as never, issues: undefined as never }) }],
    ["throws", { review: async () => { throw new Error("qwen down"); } }],
  ])("cannot veto the page when Qwen is %s", async (_name, over) => {
    const result = await runAdvisoryVisualReview(INPUT, deps(over as Partial<AdvisoryReviewDeps>));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("allows exactly one repair turn when Qwen asks for improvement", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["hero reads generic"] }));
    const repair = vi.fn(async () => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const }));
    const result = await runAdvisoryVisualReview(INPUT, deps({ review, repair }));
    expect(result).toMatchObject({ reviewed: true, repaired: true });
    expect(result.candidate).toEqual(REPAIRED);
    expect(review).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("passes the reviewer's issues into the repair turn", async () => {
    const repair = vi.fn(async (_input: { issueSummary: string }) => ({ candidate: REPAIRED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const }));
    await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["hero reads generic", "palette is muddy"] }),
      repair,
    }));
    expect(String(repair.mock.calls[0][0].issueSummary)).toContain("hero reads generic");
  });

  it("keeps the pre-review candidate when the repair changes nothing", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      repair: async () => ({ candidate: CANDIDATE, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "provider" as const }),
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("keeps the pre-review candidate when the repair turn throws", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      repair: async () => { throw new Error("provider down"); },
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it.each([
    ["overflows on mobile", { mobileOverflow: true, invalidGeometry: false }],
    ["has invalid geometry", { mobileOverflow: false, invalidGeometry: true }],
  ])("reverts a repair that %s deterministically", async (_name, bad) => {
    let call = 0;
    const result = await runAdvisoryVisualReview(INPUT, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      render: async () => (call++ === 0 ? { mobileOverflow: false, invalidGeometry: false } : bad),
    }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.repaired).toBe(false);
  });

  it("renders once for the review and never calls Qwen twice", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["x"] }));
    await runAdvisoryVisualReview(INPUT, deps({ review }));
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("delivers the candidate even when the pre-review render is unavailable", async () => {
    const result = await runAdvisoryVisualReview(INPUT, deps({ render: async () => null }));
    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.reviewed).toBe(false);
  });
});

describe("varias rondas de revisión", () => {
  const HIGH = { ...INPUT, effort: "high" as const };

  it("un nivel alto sobre una página que el crítico firma cuesta una sola ronda", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: true, issues: [] }));
    const repair = vi.fn();
    const result = await runAdvisoryVisualReview(HIGH, deps({ review, repair: repair as never }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(repair).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rounds: 1, accepted: true, repaired: false });
  });

  // La trampa del bucle: si la segunda reparación partiera del candidato con el
  // que ENTRÓ la revisión, cada ronda desharía la anterior y sólo sobreviviría
  // la última. El candidato viaja en cada llamada justamente por esto.
  it("cada reparación parte de la página que dejó la anterior", async () => {
    const seen: string[] = [];
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["x"] }));
    let n = 0;
    const repair = vi.fn(async (input: { candidate: SafeCreativeCandidate }) => {
      seen.push(input.candidate.html);
      n += 1;
      return {
        candidate: { ...CANDIDATE, html: `<p>ronda-${n}</p>` },
        changed: true,
        acceptedMutations: 1,
        rejections: [],
        stoppedBy: "finished" as const,
      };
    });
    const result = await runAdvisoryVisualReview(HIGH, deps({ review, repair }));
    expect(seen).toEqual([CANDIDATE.html, "<p>ronda-1</p>", "<p>ronda-2</p>"]);
    expect(result.candidate.html).toBe("<p>ronda-3</p>");
    expect(result).toMatchObject({ rounds: 3, repaired: true, accepted: false });
  });

  it("el crítico juzga la página reparada, no la que entró", async () => {
    const judged: string[] = [];
    const review = vi.fn(async (input: { html: string }) => {
      judged.push(input.html);
      return { ok: true as const, accepted: judged.length === 2, issues: ["x"] };
    });
    const result = await runAdvisoryVisualReview(HIGH, deps({ review }));
    expect(judged).toEqual([CANDIDATE.html, REPAIRED.html]);
    expect(result).toMatchObject({ rounds: 2, accepted: true, repaired: true });
  });

  it("una reparación que no cambió nada cierra el ciclo en vez de repetirlo", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["x"] }));
    const repair = vi.fn(async () => ({
      candidate: CANDIDATE, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "turn_limit" as const,
    }));
    const result = await runAdvisoryVisualReview(HIGH, deps({ review, repair }));
    expect(repair).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ rounds: 1, repaired: false, accepted: false });
  });

  it("cada nivel compra los turnos de reparación que dice su tabla", async () => {
    const turns: number[] = [];
    const repair = vi.fn(async (input: { maxTurns: number }) => {
      turns.push(input.maxTurns);
      return { candidate: REPAIRED, changed: true, acceptedMutations: 1, rejections: [], stoppedBy: "finished" as const };
    });
    await runAdvisoryVisualReview({ ...INPUT, effort: "low" }, deps({
      review: async () => ({ ok: true, accepted: false, issues: ["x"] }),
      repair,
    }));
    expect(turns).toEqual([effortProfile("low").repairTurns]);
  });

  it("sin nivel se comporta exactamente como `low`: una sola ronda", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["x"] }));
    const result = await runAdvisoryVisualReview(INPUT, deps({ review }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(result.rounds).toBe(1);
  });

  // Cuatro salidas que antes se veían idénticas en la evidencia («se rindió en
  // la ronda 1»), y que piden arreglos opuestos: un crítico caído se reintenta,
  // una reparación que empeora la página se investiga.
  it.each([
    ["accepted", {}],
    ["critic_failed", { review: async () => ({ ok: false as const }) }],
    ["render_failed", { render: async () => null }],
    ["repair_unchanged", {
      review: async () => ({ ok: true as const, accepted: false, issues: ["flojo"] }),
      repair: async () => ({ candidate: CANDIDATE, changed: false, acceptedMutations: 0, rejections: [], stoppedBy: "finished" as const }),
    }],
    ["repair_regressed", {
      review: async () => ({ ok: true as const, accepted: false, issues: ["flojo"] }),
      render: vi.fn()
        .mockResolvedValueOnce({ mobileOverflow: false, invalidGeometry: false })
        .mockResolvedValueOnce({ mobileOverflow: true, invalidGeometry: false }),
    }],
  ])("names %s as the reason the loop ended", async (expected, over) => {
    const result = await runAdvisoryVisualReview(INPUT, deps(over as Partial<AdvisoryReviewDeps>));
    expect(result.exit).toBe(expected);
  });

  it("exhausts every round the level bought before giving up", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["flojo"] }));
    const result = await runAdvisoryVisualReview({ ...INPUT, effort: "high" }, deps({ review }));
    expect(result.exit).toBe("rounds_exhausted");
    expect(result.rounds).toBe(effortProfile("high").reviewRounds);
  });

  // Medido en este repo: una reparación contestó una queja de tipografía y
  // dejó detrás texto a 1.02:1. La puerta sólo leía desbordes y geometría, así
  // que esa página se entregaba.
  it("descarta una reparación que deja texto invisible que antes no estaba", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["typography:both"] }));
    const render = vi.fn()
      .mockResolvedValueOnce({ mobileOverflow: false, invalidGeometry: false, unreadableText: [] })
      .mockResolvedValueOnce({ mobileOverflow: false, invalidGeometry: false, unreadableText: [{ contrast: 1.02 }] });
    const result = await runAdvisoryVisualReview(INPUT, deps({ review, render }));
    expect(result.exit).toBe("repair_regressed");
    expect(result.candidate).toEqual(CANDIDATE);
  });

  it("no castiga una reparación que hereda el contraste que ya venía roto", async () => {
    const review = vi.fn(async () => ({ ok: true as const, accepted: false, issues: ["typography:both"] }));
    const render = vi.fn()
      .mockResolvedValueOnce({ mobileOverflow: false, invalidGeometry: false, unreadableText: [{ contrast: 1.02 }] })
      .mockResolvedValueOnce({ mobileOverflow: false, invalidGeometry: false, unreadableText: [{ contrast: 1.02 }] });
    const result = await runAdvisoryVisualReview(INPUT, deps({ review, render }));
    expect(result.candidate).toEqual(REPAIRED);
  });
});
