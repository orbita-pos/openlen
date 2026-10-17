import { describe, expect, it } from "vitest";

import { PROVIDER_STICKY_MS, billedUsage, preferredProviderFrom } from "./provider-billing";
import type { TranscripcionGuardada } from "./transcripcion";

const transcript = (provider?: TranscripcionGuardada["provider"]): TranscripcionGuardada => ({
  mensajes: [],
  leidos: [],
  ...(provider ? { provider } : {}),
});

describe("billedUsage", () => {
  it("takes off what the user does not pay and bills the re-read as cached", () => {
    const real = { inputTokens: 1_000, outputTokens: 100, cachedTokens: 300, thinkingTokens: 10 };
    const minus = { inputTokens: 200, outputTokens: 30, cachedTokens: 0, thinkingTokens: 5 };
    expect(billedUsage(real, { minus, extraCached: 600 })).toEqual({
      inputTokens: 800,
      outputTokens: 70,
      cachedTokens: 800,
      thinkingTokens: 5,
    });
  });

  it("never goes below 0 and is the real usage without an adjustment", () => {
    const real = { inputTokens: 10, outputTokens: 5, cachedTokens: 2, thinkingTokens: 1 };
    const big = { inputTokens: 50, outputTokens: 50, cachedTokens: 50, thinkingTokens: 50 };
    expect(billedUsage(real, { minus: big, extraCached: 0 })).toEqual({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 });
    const zero = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thinkingTokens: 0 };
    expect(billedUsage(real, { minus: zero, extraCached: 0 })).toEqual(real);
  });
});

describe("preferredProviderFrom", () => {
  const now = Date.parse("2026-10-16T20:00:00.000Z");
  it("keeps the last turn's provider while its cache is warm (under 10 min)", () => {
    expect(PROVIDER_STICKY_MS).toBe(600_000);
    const at3 = new Date(now - 3 * 60_000).toISOString();
    const at12 = new Date(now - 12 * 60_000).toISOString();
    expect(preferredProviderFrom(transcript({ id: "fireworks", at: at3 }), now)).toBe("fireworks");
    expect(preferredProviderFrom(transcript({ id: "fireworks", at: at12 }), now)).toBeNull();
  });

  it("without a provider, or without a transcript, there is no preference", () => {
    expect(preferredProviderFrom(transcript(), now)).toBeNull();
    expect(preferredProviderFrom(null, now)).toBeNull();
    expect(preferredProviderFrom(undefined, now)).toBeNull();
    expect(preferredProviderFrom(transcript({ id: "deepinfra", at: "not a date" }), now)).toBeNull();
  });
});
