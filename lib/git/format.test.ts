// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bodyOf, cleanupMessage, subjectOf, withSignoff } from "./format";

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
