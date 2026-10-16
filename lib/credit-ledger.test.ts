import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  isNull: (value: unknown) => ({ op: "is-null", value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@/lib/db", () => {
  mocks.update.mockImplementation(() => ({
    set: (values: unknown) => {
      mocks.updateSet(values);
      return { where: () => ({ returning: async () => [] }) };
    },
  }));
  return {
    db: { execute: mocks.execute, update: mocks.update },
    schema: { users: { id: "users.id", plan: "users.plan", credits: "users.credits", creditsRefreshedAt: "users.creditsRefreshedAt" } },
  };
});

import { chargeCredits, recordUncharged } from "./credits";
import { ledgerFields, type LedgerEntry } from "./credit-ledger";

const FLASH = "accounts/fireworks/models/deepseek-v4p1-flash";
const AT = new Date("2026-10-16T15:00:00Z");
const ENTRY: LedgerEntry = { surface: "agent_turn", outcome: "ok", listCenticredits: 120 };

/** What Drizzle throws: the driver's error rides in `cause`. */
function drizzleError(cause: unknown): Error {
  return Object.assign(new Error("Failed query: …"), { cause });
}

describe("ledgerFields", () => {
  it("sums tokens across uses and prices each one", () => {
    const f = ledgerFields({
      surface: "chat",
      outcome: "ok",
      uses: [
        { provider: "fireworks", model: FLASH, inputTokens: 1_000_000, cachedTokens: 900_000, outputTokens: 20_000, at: AT },
        { provider: "fireworks", model: FLASH, inputTokens: 1_000, cachedTokens: 0, outputTokens: 4, reasoningTokens: 2, at: AT },
      ],
    });
    expect(f).toEqual({
      provider: "fireworks",
      model: FLASH,
      inputTokens: 1_001_000,
      cachedTokens: 900_000,
      outputTokens: 20_004,
      reasoningTokens: 2,
      // 59 400 + (1 000 × 0.30 + 4 × 1.20 = 304.8 → 305)
      costMicroUsd: 59_705,
    });
  });

  it("prices unit uses", () => {
    expect(ledgerFields({ surface: "agent_tool", outcome: "ok", uses: [{ provider: "exa", model: "search", queries: 2 }] }).costMicroUsd).toBe(30_000);
  });

  it("cost is null when there are no uses or one use is unknown", () => {
    expect(ledgerFields({ surface: "autofill", outcome: "ok" }).costMicroUsd).toBeNull();
    expect(ledgerFields({ surface: "autofill", outcome: "ok", uses: [] }).costMicroUsd).toBeNull();
    expect(
      ledgerFields({
        surface: "chat",
        outcome: "ok",
        uses: [
          { provider: "fireworks", model: FLASH, inputTokens: 10, cachedTokens: 0, outputTokens: 1, at: AT },
          { provider: "fireworks", model: "accounts/fireworks/models/nope", inputTokens: 10, outputTokens: 1, at: AT },
        ],
      }).costMicroUsd,
    ).toBeNull();
  });
});

describe("when the ledger statement fails", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("a Postgres error with a code falls back to the plain debit and logs [ledger]", async () => {
    mocks.execute.mockRejectedValueOnce(drizzleError({ code: "42P01", severity: "ERROR", message: 'relation "creditLedger" does not exist' }));
    await expect(chargeCredits("u1", 120, ENTRY)).resolves.toBe(120);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("[ledger]");
  });

  it("a network error without a Postgres code is rethrown and never retried", async () => {
    mocks.execute.mockRejectedValueOnce(drizzleError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
    await expect(chargeCredits("u1", 120, ENTRY)).rejects.toThrow();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("recordUncharged never throws", async () => {
    mocks.execute.mockRejectedValueOnce(drizzleError(new Error("socket hang up")));
    await expect(recordUncharged("u1", { surface: "security_review", outcome: "ok" })).resolves.toBeUndefined();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain("[ledger]");
  });

  it("does nothing for a zero or negative amount", async () => {
    await expect(chargeCredits("u1", 0, ENTRY)).resolves.toBe(0);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
