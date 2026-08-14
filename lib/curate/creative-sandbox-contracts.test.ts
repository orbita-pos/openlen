import { describe, expect, it } from "vitest";

import { CreativePatchSchema } from "./creative-sandbox-contracts";

describe("CreativePatchSchema", () => {
  it("accepts every bounded creative operation and ignores top-level explanation", () => {
    const parsed = CreativePatchSchema.parse({
      explanation: "Try a more playful rhythm.",
      operations: [
        { op: "replace_section", targetId: "hero-1", html: "<section>Hero</section>", css: ".hero{display:grid}" },
        { op: "insert_section", afterTargetId: null, role: "gallery", html: "<section>Gallery</section>" },
        { op: "remove_section", targetId: "old-1" },
        { op: "move_section", targetId: "story-1", afterTargetId: "hero-1" },
        { op: "set_page_css", css: ":root{--accent:#f06}" },
        { op: "set_link", targetId: "cta-1", url: "/start", label: "Start" },
      ],
    });

    expect(parsed.operations).toHaveLength(6);
    expect(parsed).toHaveProperty("explanation", "Try a more playful rhythm.");
  });

  it.each([
    [{ operations: [] }, "empty operation list"],
    [{ operations: [{ op: "replace_section", targetId: "hero-1" }] }, "missing replacement HTML"],
    [{ operations: [{ op: "invent_section", targetId: "hero-1", html: "<section/>" }] }, "unknown operation"],
    [{ operations: [{ op: "remove_section", targetId: "spaces are unsafe" }] }, "unstable target id"],
    [{ operations: Array.from({ length: 13 }, () => ({ op: "set_page_css", css: "a{}" })) }, "too many operations"],
  ])("rejects %s (%s)", (input, _label) => {
    expect(CreativePatchSchema.safeParse(input).success).toBe(false);
  });
});
