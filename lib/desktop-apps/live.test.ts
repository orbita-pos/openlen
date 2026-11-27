// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { desktopAppIsLive, type ToolInstallationState } from "./live";

const PLAIN = { removedAt: null, toolInstallationId: null, projectId: "p1", personId: "u1" };
const TOOL = { ...PLAIN, toolInstallationId: "ti1" };
const ON: ToolInstallationState = { enabled: true, removedAt: null, projectId: "p1", personId: "u1" };

const check = (installation: ToolInstallationState | null = ON, toolsEnabled = true) => ({
  toolsEnabled,
  toolInstallation: vi.fn(async () => installation),
});

describe("desktopAppIsLive", () => {
  it("an ordinary app is live until it is removed, and never asks about a tool", async () => {
    const c = check();
    expect(await desktopAppIsLive(PLAIN, c)).toBe(true);
    expect(await desktopAppIsLive({ ...PLAIN, removedAt: new Date() }, c)).toBe(false);
    expect(c.toolInstallation).not.toHaveBeenCalled();
  });

  it("a tool is live while its installation exists, is on and is not removed", async () => {
    const c = check();
    expect(await desktopAppIsLive(TOOL, c)).toBe(true);
    expect(c.toolInstallation).toHaveBeenCalledWith("ti1");
    expect(await desktopAppIsLive(TOOL, check({ ...ON, enabled: false }))).toBe(false);
    expect(await desktopAppIsLive(TOOL, check({ ...ON, removedAt: new Date() }))).toBe(false);
    expect(await desktopAppIsLive(TOOL, check(null))).toBe(false);
    expect(await desktopAppIsLive({ ...TOOL, removedAt: new Date() }, check())).toBe(false);
  });

  it("an installation of another project or person is not live", async () => {
    expect(await desktopAppIsLive(TOOL, check({ ...ON, projectId: "p2" }))).toBe(false);
    expect(await desktopAppIsLive(TOOL, check({ ...ON, personId: "u2" }))).toBe(false);
  });

  it("a tool obeys OPENLEN_TOOLS=0 (and does not even ask), an ordinary app does not", async () => {
    const off = check(ON, false);
    expect(await desktopAppIsLive(TOOL, off)).toBe(false);
    expect(off.toolInstallation).not.toHaveBeenCalled();
    expect(await desktopAppIsLive(PLAIN, off)).toBe(true);
  });
});
