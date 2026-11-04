// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { ToolInstallationRow } from "./store";
import { toInstalledToolView } from "./view";

const row = (over: Partial<ToolInstallationRow> = {}): ToolInstallationRow => ({
  id: "i1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  placement: "rail",
  titles: { en: "Bookings", es: "Reservas" },
  descriptions: { en: "Today's bookings", es: "Las reservas de hoy" },
  iconPath: "/icon.svg",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  enabled: true,
  installedAt: new Date("2026-11-04T10:00:00Z"),
  updatedAt: new Date("2026-11-04T10:00:00Z"),
  removedAt: null,
  ...over,
});

const ENV = { NODE_ENV: "development" };
const view = (r: ToolInstallationRow, o: Partial<Parameters<typeof toInstalledToolView>[1]> = {}) =>
  toInstalledToolView(r, { locale: "es", requestHost: "localhost:3000", plan: "pro", releaseExists: true, env: ENV, ...o });

describe("toInstalledToolView", () => {
  it("an installed tool, in the person's language, with its frame and icon", () => {
    expect(view(row())).toEqual({
      id: "i1",
      projectId: "p1",
      title: "Reservas",
      description: "Las reservas de hoy",
      placement: "rail",
      iconUrl: "/api/tools/i1/icon?v=sha1",
      iconTinted: true,
      frameUrl: "http://lienzo-0123456789abcdef0123456789abcdef.localhost:3000/?v=sha1",
      frameOrigin: "http://lienzo-0123456789abcdef0123456789abcdef.localhost:3000",
      releaseSha: "sha1",
      enabled: true,
      installedAt: "2026-11-04T10:00:00.000Z",
      status: "ok",
    });
  });

  it("an SVG icon is tinted with the workspace's colour; a raster one is shown as it is", () => {
    expect(view(row({ iconPath: "/icon.svg" })).iconTinted).toBe(true);
    expect(view(row({ iconPath: "/branding/mark.SVG" })).iconTinted).toBe(true);
    expect(view(row({ iconPath: "/icon.png" })).iconTinted).toBe(false);
  });

  it("falls back to English for a language it doesn't have", () => {
    expect(view(row(), { locale: "ja" }).title).toBe("Bookings");
  });

  it("removed: no frame", () => {
    const v = view(row({ removedAt: new Date() }));
    expect(v.status).toBe("removed");
    expect(v.frameUrl).toBeNull();
  });

  it("on the free plan: plan_required, no frame (Review Focus 5)", () => {
    const v = view(row(), { plan: "free" });
    expect(v.status).toBe("plan_required");
    expect(v.frameUrl).toBeNull();
  });

  it("a release that isn't there any more: broken", () => {
    expect(view(row(), { releaseExists: false }).status).toBe("broken");
  });

  it("a reinstall changes the frame URL (Review Focus 3)", () => {
    expect(view(row({ releaseSha: "sha2" })).frameUrl).toMatch(/\?v=sha2$/);
  });
});
