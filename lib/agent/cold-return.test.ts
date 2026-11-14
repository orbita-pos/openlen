import { describe, expect, it } from "vitest";

import { COLD_AFTER_MIN_DEFAULT, COLD_TRIM_MARK, coldAfterMs, coldReturnEnabled, isColdReturn, isColdTrimMark } from "./cold-return";

describe("cold return: when a turn counts as cold", () => {
  // The probe of 14/11 (run 20261114T0326): the provider still read a prefix from its cache after 45 minutes
  // of silence and no longer after 60. Claude Code's 65 are its own provider's hour plus five minutes.
  it("is cold only past the threshold, 60 minutes by default: where the probe found the provider's cache gone", () => {
    expect(COLD_AFTER_MIN_DEFAULT).toBe(60);
    expect(coldAfterMs({})).toBe(60 * 60_000);
    expect(isColdReturn(60 * 60_000, {})).toBe(false);
    expect(isColdReturn(60 * 60_000 + 1, {})).toBe(true);
  });

  it("an unknown or negative elapsed time is never cold", () => {
    expect(isColdReturn(null, {})).toBe(false);
    expect(isColdReturn(-5_000, {})).toBe(false);
  });

  it("OPENLEN_COLD_AFTER_MIN moves the threshold; a bad value is ignored", () => {
    expect(coldAfterMs({ OPENLEN_COLD_AFTER_MIN: "30" })).toBe(30 * 60_000);
    expect(isColdReturn(31 * 60_000, { OPENLEN_COLD_AFTER_MIN: "30" })).toBe(true);
    for (const bad of ["abc", "0", "-3", "1.5", ""]) expect(coldAfterMs({ OPENLEN_COLD_AFTER_MIN: bad })).toBe(60 * 60_000);
  });

  it("only the literal 0 turns it off", () => {
    expect(coldReturnEnabled({})).toBe(true);
    expect(coldReturnEnabled({ OPENLEN_COLD_RETURN: "0" })).toBe(false);
    expect(coldReturnEnabled({ OPENLEN_COLD_RETURN: "false" })).toBe(true);
    expect(isColdReturn(10 * 3_600_000, { OPENLEN_COLD_RETURN: "0" })).toBe(false);
  });

  it("recognizes its own mark and nothing else", () => {
    expect(isColdTrimMark(COLD_TRIM_MARK)).toBe(true);
    expect(COLD_TRIM_MARK).toEqual({ v: 1, keepResults: 12, clearAtLeastTokens: 20_000 });
    const bad: unknown[] = [
      null,
      true,
      {},
      { v: 2, keepResults: 12, clearAtLeastTokens: 20_000 },
      { v: 1, keepResults: -1, clearAtLeastTokens: 20_000 },
      { v: 1, keepResults: 12 },
      { v: 1, keepResults: 1.5, clearAtLeastTokens: 20_000 },
    ];
    for (const b of bad) expect(isColdTrimMark(b)).toBe(false);
  });
});
