import { describe, expect, it } from "vitest";
import { MAX_STEP_SCREENSHOTS, screenshotsFrom } from "./step-screenshots";

const url = (n: number) => `https://uploads.openlen.com/uploads/p1/screenshot-${n.toString(16).padStart(32, "0")}.jpg`;

describe("screenshotsFrom", () => {
  it("keeps the URLs storeStepScreenshots gives, from R2 or the local disk, in order", () => {
    const local = "/uploads/uploads/p1/screenshot-0123456789abcdef0123456789abcdef.png";
    expect(screenshotsFrom([url(1), local])).toEqual([url(1), local]);
  });

  it("drops anything that is not one of our screenshots", () => {
    expect(
      screenshotsFrom([
        "javascript:alert(1)",
        "https://evil.test/x.jpg",
        "https://uploads.openlen.com/uploads/p1/design-0123456789abcdef0123456789abcdef.png",
        'https://x.test/uploads/p1/screenshot-0123456789abcdef0123456789abcdef.jpg" onerror="x',
        42,
      ]),
    ).toBeNull();
  });

  it("keeps at most MAX_STEP_SCREENSHOTS", () => {
    const many = Array.from({ length: MAX_STEP_SCREENSHOTS + 3 }, (_, i) => url(i));
    expect(screenshotsFrom(many)).toEqual(many.slice(0, MAX_STEP_SCREENSHOTS));
  });

  it("returns null for what is not a list", () => {
    expect(screenshotsFrom(undefined)).toBeNull();
    expect(screenshotsFrom("https://uploads.openlen.com/uploads/p1/screenshot-0.jpg")).toBeNull();
  });
});
