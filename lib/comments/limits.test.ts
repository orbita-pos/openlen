// @vitest-environment node

import { describe, expect, it } from "vitest";
import { COMMENT_POST_LIMITS, commentPostKey } from "./limits";

describe("comment post limits", () => {
  it("scopes the key by project AND member, with no raw memberId (PII)", () => {
    const k = commentPostKey("p1", "member-uuid-123");
    expect(k).toMatch(/^member:p1:[0-9a-f]{16}:comment-post$/);
    expect(k).not.toContain("member-uuid-123");
  });

  it("same member in different projects → different keys (no cross-site burn)", () => {
    expect(commentPostKey("p1", "m1")).not.toBe(commentPostKey("p2", "m1"));
  });

  it("different members in the same project → different keys", () => {
    expect(commentPostKey("p1", "m1")).not.toBe(commentPostKey("p1", "m2"));
  });

  it("has a tight per-minute cooldown and an hourly ceiling", () => {
    expect(COMMENT_POST_LIMITS[0].windowMs).toBe(60 * 1000);
    expect(COMMENT_POST_LIMITS[0].max).toBeLessThanOrEqual(3);
    expect(COMMENT_POST_LIMITS[1].label).toBe("hourly");
  });
});
