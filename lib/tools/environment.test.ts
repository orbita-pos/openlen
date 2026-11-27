// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { isInstalledToolOrigin } from "./environment";

const LABEL = "lienzo-00112233445566778899aabbccddeeff";
const row = (over: Record<string, unknown> = {}) => ({ projectId: "p1", enabled: true, removedAt: null, ...over });

describe("isInstalledToolOrigin", () => {
  const lookup = (r: unknown) => vi.fn(async () => r as never);
  const ask = (origin: string | null, r: unknown) =>
    isInstalledToolOrigin({ origin, referer: null, lienzoLabel: "lienzo-ffffffffffffffffffffffffffffffff", projectId: "p1" }, lookup(r));

  it("its own installed tool: yes", async () => {
    expect(await ask(`https://${LABEL}.openlen.app`, row())).toBe(true);
  });
  it("another project's tool, switched off or removed: no", async () => {
    expect(await ask(`https://${LABEL}.openlen.app`, row({ projectId: "p2" }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, row({ enabled: false }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, row({ removedAt: new Date() }))).toBe(false);
    expect(await ask(`https://${LABEL}.openlen.app`, null)).toBe(false);
  });
  it("not a lienzo label, or this project's own canvas: no lookup at all", async () => {
    const l = lookup(row());
    expect(await isInstalledToolOrigin({ origin: "https://openlen.com", referer: null, lienzoLabel: "x", projectId: "p1" }, l)).toBe(false);
    expect(await isInstalledToolOrigin({ origin: `https://${LABEL}.openlen.app`, referer: null, lienzoLabel: LABEL, projectId: "p1" }, l)).toBe(false);
    expect(l).not.toHaveBeenCalled();
  });
});

// PHASE 4 (spec local 2026-11-04-herramientas-hechas-por-len, §4.7): an installed tool has no published page, yet its
// production functions are what its screen and Len's operations call — the gateway's «production only when published»
// counts an installed tool's project as published.
describe("toolLiveIsPublished", () => {
  it("a project with an installed, switched-on tool: yes; switched off, removed or never installed: no", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", async () => true)).toBe(true);
    expect(await toolLiveIsPublished("p1", async () => false)).toBe(false);
  });

  it("a lookup that fails is a no, never a throw", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", async () => Promise.reject(new Error("db down")))).toBe(false);
  });
});

describe("toolLiveIsPublished with tools off", () => {
  it("OPENLEN_TOOLS=0: no installed tool's production functions answer", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", async () => true, { OPENLEN_TOOLS: "0" })).toBe(false);
    expect(await toolLiveIsPublished("p1", async () => true, {})).toBe(true);
  });
});

// APPS ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §5): for the backend an app of the desktop is exactly an
// installed tool — its `lienzo-` label is production, never the draft — with its own switch (OPENLEN_DESKTOP_APPS), which
// neither turns the tools off nor is turned off by them.
describe("a desktop app's label", () => {
  const DESKTOP_LABEL = "lienzo-aabbccddeeff00112233445566778899";
  const desktopRow = (over: Record<string, unknown> = {}) => ({ projectId: "p1", removedAt: null, toolInstallationId: null, ...over });
  const desktop = (r: unknown, tool: unknown = { enabled: true, removedAt: null }) => ({
    byLabel: vi.fn(async () => r as never),
    toolInstallation: vi.fn(async () => tool as never),
  });
  const none = vi.fn(async () => null);
  const ask = (r: unknown, env: Record<string, string | undefined> = {}, d = desktop(r), origin: string | null = `https://${DESKTOP_LABEL}.openlen.app`) =>
    isInstalledToolOrigin({ origin, referer: null, lienzoLabel: "lienzo-ffffffffffffffffffffffffffffffff", projectId: "p1" }, none, d, env);

  it("a desktop label of this project is production", async () => {
    expect(await ask(desktopRow())).toBe(true);
  });

  it("it is looked up by the label of the origin, and the referer serves when there is no origin", async () => {
    const d = desktop(desktopRow());
    await ask(desktopRow(), {}, d);
    expect(d.byLabel).toHaveBeenCalledWith(DESKTOP_LABEL);
    const viaReferer = desktop(desktopRow());
    expect(
      await isInstalledToolOrigin({ origin: null, referer: `https://${DESKTOP_LABEL}.openlen.app/`, lienzoLabel: "x", projectId: "p1" }, none, viaReferer, {}),
    ).toBe(true);
  });

  it("a desktop label of another project is not", async () => {
    expect(await ask(desktopRow({ projectId: "p2" }))).toBe(false);
  });

  it("a removed row, an unknown label or a lookup that fails: no", async () => {
    expect(await ask(desktopRow({ removedAt: new Date() }))).toBe(false);
    expect(await ask(null)).toBe(false);
    const down = { byLabel: vi.fn(async () => Promise.reject(new Error("db down"))), toolInstallation: vi.fn(async () => null) };
    expect(await ask(null, {}, down as never)).toBe(false);
  });

  it("desktop label with OPENLEN_DESKTOP_APPS=0 is not, and is not even looked up", async () => {
    const d = desktop(desktopRow());
    expect(await ask(desktopRow(), { OPENLEN_DESKTOP_APPS: "0" }, d)).toBe(false);
    expect(d.byLabel).not.toHaveBeenCalled();
  });

  it("OPENLEN_TOOLS=0 does not turn the desktop off: they are two switches", async () => {
    expect(await ask(desktopRow(), { OPENLEN_TOOLS: "0" })).toBe(true);
  });

  it("a tool on the desktop is production only while its installation is on", async () => {
    const row = desktopRow({ toolInstallationId: "ti1" });
    const d = desktop(row);
    expect(await ask(row, {}, d)).toBe(true);
    expect(d.toolInstallation).toHaveBeenCalledWith("ti1");
  });

  it("desktop label of a switched-off tool is not production", async () => {
    const row = desktopRow({ toolInstallationId: "ti1" });
    expect(await ask(row, {}, desktop(row, { enabled: false, removedAt: null }))).toBe(false);
    expect(await ask(row, {}, desktop(row, { enabled: true, removedAt: new Date() }))).toBe(false);
    expect(await ask(row, {}, desktop(row, null))).toBe(false);
  });

  it("an ordinary app asks nothing about tool installations", async () => {
    const d = desktop(desktopRow());
    await ask(desktopRow(), {}, d);
    expect(d.toolInstallation).not.toHaveBeenCalled();
  });

  it("a label that is the project's own canvas, or no lienzo label at all: no desktop lookup", async () => {
    const own = desktop(desktopRow());
    expect(await isInstalledToolOrigin({ origin: `https://${DESKTOP_LABEL}.openlen.app`, referer: null, lienzoLabel: DESKTOP_LABEL, projectId: "p1" }, none, own, {})).toBe(false);
    expect(await isInstalledToolOrigin({ origin: "https://openlen.com", referer: null, lienzoLabel: "x", projectId: "p1" }, none, own, {})).toBe(false);
    expect(own.byLabel).not.toHaveBeenCalled();
  });

  it("a tool's own label does not ask the desktop", async () => {
    const d = desktop(desktopRow());
    const yes = vi.fn(async () => ({ projectId: "p1", enabled: true, removedAt: null }));
    expect(
      await isInstalledToolOrigin({ origin: `https://${LABEL}.openlen.app`, referer: null, lienzoLabel: "x", projectId: "p1" }, yes, d, {}),
    ).toBe(true);
    expect(d.byLabel).not.toHaveBeenCalled();
  });
});

describe("toolLiveIsPublished with apps on the desktop", () => {
  const no = async () => false;
  const yes = async () => true;

  it("toolLiveIsPublished true with an active desktop app and OPENLEN_TOOLS=0", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", yes, { OPENLEN_TOOLS: "0" }, yes)).toBe(true);
  });

  it("an active desktop app counts alone, an installed tool counts alone, neither is a no", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", no, {}, yes)).toBe(true);
    expect(await toolLiveIsPublished("p1", yes, {}, no)).toBe(true);
    expect(await toolLiveIsPublished("p1", no, {}, no)).toBe(false);
  });

  it("OPENLEN_DESKTOP_APPS=0: the desktop does not count, and is not asked", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    const desktop = vi.fn(async () => true);
    expect(await toolLiveIsPublished("p1", no, { OPENLEN_DESKTOP_APPS: "0" }, desktop)).toBe(false);
    expect(desktop).not.toHaveBeenCalled();
    expect(await toolLiveIsPublished("p1", yes, { OPENLEN_DESKTOP_APPS: "0" }, desktop)).toBe(true);
  });

  it("a desktop lookup that fails is a no, never a throw", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", no, {}, async () => Promise.reject(new Error("db down")))).toBe(false);
  });

  it("a tool lookup that fails does not hide the desktop", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    expect(await toolLiveIsPublished("p1", async () => Promise.reject(new Error("db down")), {}, yes)).toBe(true);
  });

  it("it asks the desktop about this project", async () => {
    const { toolLiveIsPublished } = await import("./environment");
    const desktop = vi.fn(async () => false);
    await toolLiveIsPublished("p7", no, {}, desktop);
    expect(desktop).toHaveBeenCalledWith("p7");
  });
});
