import { describe, expect, it } from "vitest";

import { SANDBOX_TEMPLATE, sandboxConfig } from "./config";

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
