// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bodyOf, cleanupMessage, formatDate, relativeDate, subjectOf, withSignoff } from "./format";

describe("commit messages", () => {
  it("are cleaned up like `git commit -m` (cleanup=whitespace)", () => {
    expect(cleanupMessage("\n\nAdd the cart   \n\n\n\nSo people can order.  \n\n")).toBe("Add the cart\n\nSo people can order.\n");
    expect(cleanupMessage(" \n \n")).toBe("");
    expect(cleanupMessage("# not a comment with -m\n")).toBe("# not a comment with -m\n");
  });
  it("subject is the first paragraph, joined; body is the rest", () => {
    expect(subjectOf("Add the\ncart\n\nBody.\n")).toBe("Add the cart");
    expect(bodyOf("Add the cart\n\nBody one.\n\nBody two.\n")).toBe("Body one.\n\nBody two.\n");
    expect(bodyOf("Only a subject\n")).toBe("");
  });
  it("a sign-off joins a trailer block, or opens one", () => {
    const me = { name: "Ana Lopez", email: "ana@x" };
    expect(withSignoff("Fix\n", me)).toBe("Fix\n\nSigned-off-by: Ana Lopez <ana@x>\n");
    expect(withSignoff("Fix\n\nCo-Authored-By: Len <noreply@openlen.com>\n", me)).toBe("Fix\n\nCo-Authored-By: Len <noreply@openlen.com>\nSigned-off-by: Ana Lopez <ana@x>\n");
  });
});

describe("dates, as git prints them", () => {
  const sig = { name: "A", email: "a@b", timestamp: 1_760_500_000, timezone: "+0000" };
  it("default, iso, short, unix, raw", () => {
    expect(formatDate(sig, "default", new Date())).toBe("Wed Oct 15 03:46:40 2025 +0000");
    expect(formatDate(sig, "iso", new Date())).toBe("2025-10-15 03:46:40 +0000");
    expect(formatDate(sig, "short", new Date())).toBe("2025-10-15");
    expect(formatDate(sig, "unix", new Date())).toBe("1760500000");
    expect(formatDate(sig, "raw", new Date())).toBe("1760500000 +0000");
  });
  it("a day of the month is not zero-padded", () => {
    expect(formatDate({ ...sig, timestamp: 1_759_633_200 }, "default", new Date())).toBe("Sun Oct 5 03:00:00 2025 +0000");
  });
  it("relative, with git's rounding", () => {
    const now = new Date(1_760_500_000_000);
    const ago = (s: number) => relativeDate(1_760_500_000 - s, now);
    expect(ago(30)).toBe("30 seconds ago");
    expect(ago(120)).toBe("2 minutes ago");
    expect(ago(3 * 3600)).toBe("3 hours ago");
    expect(ago(3 * 86400)).toBe("3 days ago");
    expect(ago(20 * 86400)).toBe("3 weeks ago");
    expect(ago(100 * 86400)).toBe("3 months ago");
    expect(ago(400 * 86400)).toBe("1 year, 1 month ago");
    expect(ago(-10)).toBe("in the future");
  });
});
