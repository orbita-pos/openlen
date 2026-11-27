// @vitest-environment node
import { describe, expect, it } from "vitest";

import { desktopAppsEnabled } from "./enabled";

describe("desktopAppsEnabled", () => {
  it("is on unless OPENLEN_DESKTOP_APPS is the literal 0", () => {
    expect(desktopAppsEnabled({})).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "1" })).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "" })).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "0" })).toBe(false);
  });
});
