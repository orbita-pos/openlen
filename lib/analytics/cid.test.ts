import { describe, expect, it } from "vitest";
import {
  CID_MAX,
  SRC_FIELD_MAX,
  cidExpr,
  parseCid,
  parseSource,
  sourceExpr,
  sourceKey,
} from "./cid";

describe("parseCid", () => {
  it("accepts a uuid and a base36 fallback id", () => {
    expect(parseCid("3f8a1c2e-0b4d-4e6f-9a1b-2c3d4e5f6a7b")).toBe(
      "3f8a1c2e-0b4d-4e6f-9a1b-2c3d4e5f6a7b",
    );
    expect(parseCid("lk3j2h1g0f")).toBe("lk3j2h1g0f");
  });
  it("trims surrounding whitespace", () => {
    expect(parseCid("  abc123  ")).toBe("abc123");
  });
  it("rejects non-strings, empties, over-length and bad chars", () => {
    expect(parseCid(null)).toBeNull();
    expect(parseCid(42)).toBeNull();
    expect(parseCid("")).toBeNull();
    expect(parseCid("   ")).toBeNull();
    expect(parseCid("a".repeat(CID_MAX + 1))).toBeNull();
    expect(parseCid("has space")).toBeNull();
    expect(parseCid("inject'); DROP")).toBeNull();
    expect(parseCid("emoji😀")).toBeNull();
  });
});

describe("parseSource", () => {
  it("keeps only the known keys, trimmed + capped", () => {
    expect(
      parseSource({
        utmSource: "instagram",
        utmMedium: "bio",
        utmCampaign: "launch",
        ref: "t.co",
        evil: "ignore me",
      }),
    ).toEqual({
      utmSource: "instagram",
      utmMedium: "bio",
      utmCampaign: "launch",
      ref: "t.co",
    });
    expect(parseSource({ utmSource: "x".repeat(SRC_FIELD_MAX + 5) })).toEqual({
      utmSource: "x".repeat(SRC_FIELD_MAX),
    });
    expect(parseSource({ utmSource: "  ig  " })).toEqual({ utmSource: "ig" });
  });
  it("strips markup chars (safe-by-construction)", () => {
    expect(parseSource({ utmSource: "insta<script>" })).toEqual({
      utmSource: "instascript",
    });
    expect(parseSource({ ref: 'evil"onerror=' })).toEqual({ ref: "evilonerror" });
  });
  it("returns null when nothing identifiable survives", () => {
    expect(parseSource(null)).toBeNull();
    expect(parseSource("nope")).toBeNull();
    expect(parseSource({})).toBeNull();
    expect(parseSource({ utmSource: "   ", evil: 1 })).toBeNull();
    expect(parseSource({ utmSource: 123 })).toBeNull();
  });
});

describe("sourceKey", () => {
  it("prefers utm_source, then ref, then direct", () => {
    expect(sourceKey({ utmSource: "instagram", ref: "t.co" })).toBe("instagram");
    expect(sourceKey({ ref: "t.co" })).toBe("t.co");
    expect(sourceKey({})).toBe("direct");
    expect(sourceKey(null)).toBe("direct");
    expect(sourceKey(undefined)).toBe("direct");
  });
});

describe("client runtime fragments", () => {
  it("are self-contained, error-swallowing IIFEs", () => {
    for (const frag of [cidExpr(), sourceExpr()]) {
      expect(frag.startsWith("(function(){try{")).toBe(true);
      expect(frag.includes("catch(e)")).toBe(true);
      // No stray </script> that would break the inline <script> they live in.
      expect(frag.includes("</script")).toBe(false);
    }
  });
});
