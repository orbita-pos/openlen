// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { desktopAppIsLive, desktopAppStatus, type ToolInstallationState } from "./live";

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

// The window says why an app is gone, as Claude's «Can't open the app…» does: the same decision as `desktopAppIsLive`, with
// the reason that decided it (the person's own row only; the caller never gives it for anyone else's).
describe("desktopAppStatus", () => {
  it("live: no reason", async () => {
    expect(await desktopAppStatus(PLAIN, check())).toEqual({ live: true });
    expect(await desktopAppStatus(TOOL, check())).toEqual({ live: true });
  });

  it("a removed row is `removed`, before any tool is asked", async () => {
    const c = check();
    expect(await desktopAppStatus({ ...PLAIN, removedAt: new Date() }, c)).toEqual({ live: false, reason: "removed" });
    expect(await desktopAppStatus({ ...TOOL, removedAt: new Date() }, c)).toEqual({ live: false, reason: "removed" });
    expect(c.toolInstallation).not.toHaveBeenCalled();
  });

  it("a tool with OPENLEN_TOOLS=0, or whose installation is switched off, is `tool_off`", async () => {
    const off = check(ON, false);
    expect(await desktopAppStatus(TOOL, off)).toEqual({ live: false, reason: "tool_off" });
    expect(off.toolInstallation).not.toHaveBeenCalled();
    expect(await desktopAppStatus(TOOL, check({ ...ON, enabled: false }))).toEqual({ live: false, reason: "tool_off" });
  });

  it("a tool whose installation was removed or is gone is `removed`", async () => {
    expect(await desktopAppStatus(TOOL, check({ ...ON, removedAt: new Date() }))).toEqual({ live: false, reason: "removed" });
    expect(await desktopAppStatus(TOOL, check({ ...ON, enabled: false, removedAt: new Date() }))).toEqual({ live: false, reason: "removed" });
    expect(await desktopAppStatus(TOOL, check(null))).toEqual({ live: false, reason: "removed" });
  });

  it("an installation of another project or person is not live and gives no reason", async () => {
    expect(await desktopAppStatus(TOOL, check({ ...ON, projectId: "p2" }))).toEqual({ live: false });
    expect(await desktopAppStatus(TOOL, check({ ...ON, personId: "u2" }))).toEqual({ live: false });
  });

  it("an ordinary app obeys only its own row", async () => {
    expect(await desktopAppStatus(PLAIN, check(null, false))).toEqual({ live: true });
  });
});
