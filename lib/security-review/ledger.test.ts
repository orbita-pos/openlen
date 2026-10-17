import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ recordUncharged: vi.fn(async () => undefined) }));
vi.mock("@/lib/credits", () => ({ recordUncharged: mocks.recordUncharged }));

import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";

import { recordReviewCost } from "./ledger";

beforeEach(() => vi.clearAllMocks());

describe("recordReviewCost", () => {
  it("records the review for the project owner, charged 0, with its tokens", async () => {
    await recordReviewCost({
      ownerId: "dueno-1",
      projectId: "p1",
      usage: { inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2_000 },
      costCentiCredits: 120,
    });
    expect(mocks.recordUncharged).toHaveBeenCalledWith("dueno-1", {
      surface: "security_review",
      outcome: "ok",
      projectId: "p1",
      listCenticredits: 120,
      uses: [
        expect.objectContaining({
          provider: "fireworks",
          model: modelIdForRole(roleForOperation("security_review")),
          inputTokens: 40_000,
          cachedTokens: 30_000,
          outputTokens: 2_000,
        }),
      ],
    });
  });

  // Desde el 17/10 la revisión corre donde los turnos de Len: el libro apunta
  // quién la atendió de verdad, con la regla de la ruta del agente (una sola
  // fila lleva los totales del bucle; con respaldo, una fila por proveedor).
  const DI_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";
  const FW_MODEL = "accounts/fireworks/models/deepseek-v4p1-flash";
  const row = (provider: "deepinfra" | "fireworks", model: string, inputTokens: number, cachedTokens: number, outputTokens: number) => ({
    provider,
    model,
    inputTokens,
    cachedTokens,
    outputTokens,
    thinkingTokens: 0,
  });

  it("a review served by DeepInfra is recorded as DeepInfra, with the review's totals", async () => {
    await recordReviewCost({
      ownerId: "dueno-1",
      projectId: "p1",
      usage: { inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2_000 },
      costCentiCredits: 120,
      providers: [row("deepinfra", DI_MODEL, 20_000, 15_000, 900), row("deepinfra", DI_MODEL, 19_000, 15_000, 1_000)],
    });
    expect(mocks.recordUncharged).toHaveBeenCalledWith(
      "dueno-1",
      expect.objectContaining({
        uses: [expect.objectContaining({ provider: "deepinfra", model: DI_MODEL, inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2_000 })],
      }),
    );
  });

  it("a review that fell back writes one row per provider, summed across its subagents", async () => {
    await recordReviewCost({
      ownerId: "dueno-1",
      projectId: "p1",
      usage: { inputTokens: 40_000, cachedTokens: 30_000, outputTokens: 2_000 },
      costCentiCredits: 120,
      providers: [
        row("deepinfra", DI_MODEL, 10_000, 8_000, 500),
        row("fireworks", FW_MODEL, 20_000, 15_000, 1_000),
        row("deepinfra", DI_MODEL, 10_000, 7_000, 500),
      ],
    });
    expect(mocks.recordUncharged).toHaveBeenCalledWith(
      "dueno-1",
      expect.objectContaining({
        uses: [
          expect.objectContaining({ provider: "deepinfra", model: DI_MODEL, inputTokens: 20_000, cachedTokens: 15_000, outputTokens: 1_000 }),
          expect.objectContaining({ provider: "fireworks", model: FW_MODEL, inputTokens: 20_000, cachedTokens: 15_000, outputTokens: 1_000 }),
        ],
      }),
    );
  });

  it("a review that spent nothing records nothing", async () => {
    await recordReviewCost({ ownerId: "dueno-1", projectId: "p1", usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, costCentiCredits: 0 });
    expect(mocks.recordUncharged).not.toHaveBeenCalled();
  });
});
