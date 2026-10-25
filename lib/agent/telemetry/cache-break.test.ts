import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_CACHE_TTL_MS, detectCacheBreak, type CallSnapshot } from "./cache-break";

const T0 = 1_760_000_000_000;

function snap(o: Partial<CallSnapshot> & { hashes?: string[] }): CallSnapshot {
  const hashes = o.hashes ?? ["a", "b", "c"];
  return {
    turnId: o.turnId ?? "T",
    step: o.step ?? 0,
    kind: o.kind ?? "loop",
    provider: o.provider ?? "deepinfra",
    model: o.model ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    effort: o.effort ?? "high",
    endedAt: o.endedAt ?? T0,
    cachedTokens: o.cachedTokens ?? 100_000,
    fingerprint: o.fingerprint ?? {
      systemHash: "s",
      toolsHash: "t",
      messageHashes: hashes,
      prefixHash: hashes.join(""),
      messageCount: hashes.length,
    },
    ...(o.turnFirstMessageCount !== undefined ? { turnFirstMessageCount: o.turnFirstMessageCount } : {}),
  };
}
const OPTS = { ttlMs: DEFAULT_PROVIDER_CACHE_TTL_MS, compactedSincePrev: false };

describe("detectCacheBreak", () => {
  it("graciasa: a rewritten earlier message is messages_rewritten at its index, owned by the previous turn", () => {
    const prev = snap({ turnId: "T", cachedTokens: 221_952, hashes: ["a", "b", "c", "d", "e"], turnFirstMessageCount: 3 });
    const cur = snap({ turnId: "U", cachedTokens: 192_256, hashes: ["a", "b", "c", "X", "e", "f"], endedAt: T0 + 30_000 });
    expect(detectCacheBreak(prev, cur, OPTS)).toEqual({
      causes: ["messages_rewritten"],
      firstChangedIndex: 3,
      changedOwner: { turnId: "T", positionInTurn: 1 },
      prevCached: 221_952,
      cached: 192_256,
    });
  });

  it("a change before the previous turn's own messages is owned by an earlier turn", () => {
    const prev = snap({ cachedTokens: 200_000, hashes: ["a", "b", "c", "d"], turnFirstMessageCount: 3 });
    const cur = snap({ cachedTokens: 10_000, hashes: ["a", "Z", "c", "d", "e"] });
    expect(detectCacheBreak(prev, cur, OPTS)).toMatchObject({ causes: ["messages_rewritten"], firstChangedIndex: 1, changedOwner: "earlier" });
  });

  it("a provider fallback is provider_changed, not messages_rewritten", () => {
    const prev = snap({ cachedTokens: 220_000 });
    const cur = snap({ provider: "fireworks", cachedTokens: 0, hashes: ["a", "b", "c", "d"] });
    expect(detectCacheBreak(prev, cur, OPTS)?.causes).toEqual(["provider_changed"]);
  });

  it("ignores drops under 2048 tokens or under 2 %", () => {
    expect(detectCacheBreak(snap({ cachedTokens: 221_952 }), snap({ cachedTokens: 220_000 }), OPTS)).toBeNull();
    expect(detectCacheBreak(snap({ cachedTokens: 3_000 }), snap({ cachedTokens: 1_000 }), OPTS)).toBeNull();
    expect(detectCacheBreak(snap({ cachedTokens: 50_000 }), snap({ cachedTokens: 47_000 }), OPTS)).not.toBeNull();
  });

  it("never compares a loop call with a closeOut call, and needs a previous call", () => {
    expect(detectCacheBreak(snap({ kind: "closeOut", cachedTokens: 9_000 }), snap({ cachedTokens: 0 }), OPTS)).toBeNull();
    expect(detectCacheBreak(null, snap({ cachedTokens: 0 }), OPTS)).toBeNull();
  });

  it("a compaction since the previous call is reported as compaction", () => {
    const r = detectCacheBreak(snap({ cachedTokens: 200_000 }), snap({ cachedTokens: 5_000, hashes: ["a", "S"] }), { ...OPTS, compactedSincePrev: true });
    expect(r?.causes).toContain("compaction");
  });

  it("same prefix after the TTL is ttl_expired; within it, likely_server_side", () => {
    const prev = snap({ cachedTokens: 200_000 });
    expect(detectCacheBreak(prev, snap({ cachedTokens: 0, endedAt: T0 + DEFAULT_PROVIDER_CACHE_TTL_MS + 1 }), OPTS)?.causes).toEqual(["ttl_expired"]);
    expect(detectCacheBreak(prev, snap({ cachedTokens: 0, endedAt: T0 + 60_000 }), OPTS)?.causes).toEqual(["likely_server_side"]);
  });

  it("effort, system and tools changes are named, in vocabulary order", () => {
    const prev = snap({ cachedTokens: 200_000 });
    const cur = snap({ cachedTokens: 0, effort: "low", fingerprint: { systemHash: "s2", toolsHash: "t2", messageHashes: ["a", "b", "c"], prefixHash: "abc", messageCount: 3 } });
    expect(detectCacheBreak(prev, cur, OPTS)?.causes).toEqual(["effort_changed", "system_changed", "tools_changed"]);
  });
});
