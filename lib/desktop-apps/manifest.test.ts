// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DESKTOP_BACKGROUND_COLOR, DESKTOP_THEME_COLOR, desktopManifest } from "./manifest";

describe("desktopManifest", () => {
  const m = desktopManifest({ id: "0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55", name: "Bookings and invoices", iconPath: null });

  it("id, scope and start_url are /desktop/<id> without a trailing slash (next.config has no trailingSlash: /desktop/<id>/ would redirect)", () => {
    expect(m.id).toBe("/desktop/0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55");
    expect(m.scope).toBe(m.id);
    expect(m.start_url).toBe(m.id);
    expect(m.id.endsWith("/")).toBe(false);
  });

  it("is a standalone window named after the app, with a short name that fits under an icon", () => {
    expect(m.display).toBe("standalone");
    expect(m.name).toBe("Bookings and invoices");
    expect(m.short_name).toBe("Bookings and");
    expect(m.short_name.length).toBeLessThanOrEqual(12);
  });

  it("wears the workspace's light tokens, as hex (oklch is not safe in a manifest)", () => {
    expect(m.background_color).toBe(DESKTOP_BACKGROUND_COLOR);
    expect(m.theme_color).toBe(DESKTOP_THEME_COLOR);
    expect(DESKTOP_BACKGROUND_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    expect(DESKTOP_THEME_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("its icons are the window's own icon route, for any size", () => {
    expect(m.icons.length).toBeGreaterThan(0);
    for (const icon of m.icons) {
      expect(icon.src).toBe("/desktop/0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55/icon");
      expect(icon.sizes).toBe("any");
    }
    expect(m.icons[0]?.type).toBe("image/svg+xml");
    expect(m.icons.map((i) => i.purpose)).toEqual(["any", "maskable"]);
  });

  it("a tool's own icon says its own type", () => {
    expect(desktopManifest({ id: "d1", name: "T", iconPath: "/icon.png" }).icons[0]?.type).toBe("image/png");
    expect(desktopManifest({ id: "d1", name: "T", iconPath: "/img/Icon.SVG" }).icons[0]?.type).toBe("image/svg+xml");
    expect(desktopManifest({ id: "d1", name: "T", iconPath: "/a.webp" }).icons[0]?.type).toBe("image/webp");
    expect(desktopManifest({ id: "d1", name: "T", iconPath: "/a.jpeg" }).icons[0]?.type).toBe("image/jpeg");
  });

  it("a name of a single character or with astral characters is cut at characters, not code units", () => {
    expect(desktopManifest({ id: "d1", name: "X", iconPath: null }).short_name).toBe("X");
    const emojis = "😀".repeat(14);
    expect([...desktopManifest({ id: "d1", name: emojis, iconPath: null }).short_name]).toHaveLength(12);
  });
});
