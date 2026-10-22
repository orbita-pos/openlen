import { describe, expect, it } from "vitest";

import { SANDBOX_TEMPLATE, realTerminalFor, sandboxConfig } from "./config";

describe("sandboxConfig", () => {
  it("is off with OPENLEN_SANDBOX=0, without a key, or with the terminal off", () => {
    expect(sandboxConfig({ OPENLEN_SANDBOX: "0", E2B_API_KEY: "k" })).toBeNull();
    expect(sandboxConfig({})).toBeNull();
    expect(sandboxConfig({ E2B_API_KEY: "  " })).toBeNull();
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_TERMINAL: "0" })).toBeNull();
  });

  it("is on with a key, and the daily cap defaults to 5", () => {
    expect(sandboxConfig({ E2B_API_KEY: "k" })).toEqual({ apiKey: "k", template: SANDBOX_TEMPLATE, dailyUsd: 5, onlyUsers: null });
  });

  it("an unreadable cap falls back to 5; 0 means no sandbox today", () => {
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_DAILY_USD: "x" })?.dailyUsd).toBe(5);
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_DAILY_USD: "-1" })?.dailyUsd).toBe(5);
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_DAILY_USD: "0" })?.dailyUsd).toBe(0);
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_DAILY_USD: "12.5" })?.dailyUsd).toBe(12.5);
  });

  it("can be limited to some accounts", () => {
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_ONLY_USERS: "u1, u2" })?.onlyUsers).toEqual(["u1", "u2"]);
    expect(sandboxConfig({ E2B_API_KEY: "k", OPENLEN_SANDBOX_ONLY_USERS: " , " })?.onlyUsers).toBeNull();
  });
});

// What Len is told about its terminal follows the same decision as terminalForTurn: during a rollout, a
// person off the list keeps today's terminal, and must be told today's terminal.
describe("🔴 realTerminalFor: whose turns get the box", () => {
  const ROLLOUT = { E2B_API_KEY: "k", OPENLEN_SANDBOX_ONLY_USERS: "u1, u2" };

  it("during a rollout, only the people on its list; without a person, nobody", () => {
    expect(realTerminalFor("u1", ROLLOUT)).toBe(true);
    expect(realTerminalFor("u3", ROLLOUT)).toBe(false);
    expect(realTerminalFor(null, ROLLOUT)).toBe(false);
  });

  it("without a rollout, everyone, with or without a person; with the box off, nobody", () => {
    expect(realTerminalFor("u3", { E2B_API_KEY: "k" })).toBe(true);
    expect(realTerminalFor(null, { E2B_API_KEY: "k" })).toBe(true);
    expect(realTerminalFor("u1", { ...ROLLOUT, OPENLEN_SANDBOX: "0" })).toBe(false);
    expect(realTerminalFor("u1", {})).toBe(false);
  });
});
