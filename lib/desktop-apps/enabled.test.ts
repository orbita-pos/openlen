// @vitest-environment node
import { describe, expect, it } from "vitest";

import { desktopAppsEnabled, desktopNotificationsEnabled } from "./enabled";

describe("desktopAppsEnabled", () => {
  it("is on unless OPENLEN_DESKTOP_APPS is the literal 0", () => {
    expect(desktopAppsEnabled({})).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "1" })).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "" })).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_APPS: "0" })).toBe(false);
  });
});

describe("desktopNotificationsEnabled", () => {
  it("is on unless OPENLEN_DESKTOP_NOTIFICATIONS is the literal 0", () => {
    expect(desktopNotificationsEnabled({})).toBe(true);
    expect(desktopNotificationsEnabled({ OPENLEN_DESKTOP_NOTIFICATIONS: "1" })).toBe(true);
    expect(desktopNotificationsEnabled({ OPENLEN_DESKTOP_NOTIFICATIONS: "" })).toBe(true);
    expect(desktopNotificationsEnabled({ OPENLEN_DESKTOP_NOTIFICATIONS: "false" })).toBe(true);
    expect(desktopNotificationsEnabled({ OPENLEN_DESKTOP_NOTIFICATIONS: "0" })).toBe(false);
  });

  it("is independent of OPENLEN_DESKTOP_APPS (that switch is the page's own 404)", () => {
    expect(desktopNotificationsEnabled({ OPENLEN_DESKTOP_APPS: "0" })).toBe(true);
    expect(desktopAppsEnabled({ OPENLEN_DESKTOP_NOTIFICATIONS: "0" })).toBe(true);
  });
});
