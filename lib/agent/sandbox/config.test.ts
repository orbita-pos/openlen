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

// What Len is told about its terminal follows the same decision as terminalForTurn. Jesús, 05/11 (spec local
// 2026-11-05-modo-juego-design, §11): the box is for the OWNER's paid plan — the owner pays it — and the list
// still adds accounts (test ones, even on Free). Free and off the list: today's terminal, told as such.
describe("🔴 realTerminalFor: whose turns get the box", () => {
  const BOX = { E2B_API_KEY: "k" };
  const LIST = { ...BOX, OPENLEN_SANDBOX_ONLY_USERS: "u1, u2" };

  it("a paid owner gets it, on the list or not", () => {
    expect(realTerminalFor("u3", BOX, true)).toBe(true);
    expect(realTerminalFor("u3", LIST, true)).toBe(true);
  });

  it("a Free owner only on the list — and with no list, not at all", () => {
    expect(realTerminalFor("u1", LIST, false)).toBe(true);
    expect(realTerminalFor("u3", LIST, false)).toBe(false);
    expect(realTerminalFor("u3", BOX, false)).toBe(false);
    expect(realTerminalFor("u3", BOX)).toBe(false);
  });

  it("without a person, nobody; with the box off, nobody", () => {
    expect(realTerminalFor(null, BOX, true)).toBe(false);
    expect(realTerminalFor(null, LIST)).toBe(false);
    expect(realTerminalFor("u1", { ...LIST, OPENLEN_SANDBOX: "0" }, true)).toBe(false);
    expect(realTerminalFor("u1", {}, true)).toBe(false);
  });
});
