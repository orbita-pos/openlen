// @vitest-environment node

import { describe, expect, it } from "vitest";
import { filterAudience } from "./audience";

const m = (id: string, email: string, status = "active", name: string | null = null) => ({
  id,
  email,
  name,
  status,
});

describe("filterAudience", () => {
  it("includes only active members", () => {
    const out = filterAudience(
      [m("1", "a@x.co"), m("2", "b@x.co", "invited"), m("3", "c@x.co", "active")],
      [],
    );
    expect(out.map((o) => o.memberId)).toEqual(["1", "3"]);
  });

  it("excludes suppressed emails (case/space-insensitive)", () => {
    const out = filterAudience(
      [m("1", "Keep@x.co"), m("2", "drop@x.co")],
      ["  DROP@X.CO "],
    );
    expect(out.map((o) => o.email)).toEqual(["keep@x.co"]);
  });

  it("dedupes by normalized email, keeping the first", () => {
    const out = filterAudience([m("1", "Dup@x.co"), m("2", "dup@x.co ")], []);
    expect(out).toHaveLength(1);
    expect(out[0].memberId).toBe("1");
  });

  it("normalizes the emails it returns", () => {
    const out = filterAudience([m("1", "  MixedCase@X.Co ")], []);
    expect(out[0].email).toBe("mixedcase@x.co");
  });

  it("returns empty when everyone is suppressed or inactive", () => {
    expect(
      filterAudience([m("1", "a@x.co", "invited"), m("2", "b@x.co")], ["b@x.co"]),
    ).toEqual([]);
  });

  it("carries the name through", () => {
    const out = filterAudience([m("1", "a@x.co", "active", "Ana")], []);
    expect(out[0]).toEqual({ memberId: "1", email: "a@x.co", name: "Ana" });
  });
});
