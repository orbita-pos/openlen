// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { ToolInstallationState } from "./live";
import { desktopPageState, desktopWindow, type PageStateDeps } from "./page-state";
import type { DesktopAppRow } from "./store";

const LABEL = "lienzo-0123456789abcdef0123456789abcdef";
const INSTALLED_AT = new Date("2026-11-20T10:00:00.000Z");
const PLAIN: DesktopAppRow = {
  id: "d1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  name: "Bookings",
  iconPath: null,
  toolInstallationId: null,
  filesFingerprint: "fp1",
  hostLabel: LABEL,
  installedAt: INSTALLED_AT,
  updatedAt: INSTALLED_AT,
  removedAt: null,
};
const TOOL: DesktopAppRow = { ...PLAIN, toolInstallationId: "ti1", iconPath: "/icon.svg" };
const RAIL_ON: ToolInstallationState = { enabled: true, removedAt: null, projectId: "p1", personId: "u1" };

const PROD = { NODE_ENV: "production", PUBLISH_BASE_HOST: "openlen.app" };

/** `row` is the row the lookup answers (null = none); everything else overrides a dependency. */
function deps(over: Partial<Omit<PageStateDeps, "row">> & { row?: DesktopAppRow | null } = {}): PageStateDeps {
  const { row = PLAIN, ...rest } = over;
  return {
    enabled: () => true,
    toolsEnabled: () => true,
    row: vi.fn(async () => row),
    toolInstallation: vi.fn(async () => RAIL_ON),
    plan: vi.fn(async () => "pro" as const),
    env: PROD,
    ...rest,
  };
}

const ask = (d: PageStateDeps, over: { id?: string; sessionUserId?: string | null; requestHost?: string | null } = {}) =>
  desktopPageState({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com", ...over }, d);

describe("desktopPageState", () => {
  it("the switch off is `off`, and nothing is read", async () => {
    const d = deps({ enabled: () => false });
    expect(await ask(d)).toEqual({ kind: "off" });
    expect(d.row).not.toHaveBeenCalled();
  });

  it("no session is `sign_in`, and the row is not even looked up (nothing says whether the id exists)", async () => {
    const d = deps();
    expect(await ask(d, { sessionUserId: null })).toEqual({ kind: "sign_in" });
    expect(d.row).not.toHaveBeenCalled();
  });

  it("an id with no row is gone", async () => {
    expect(await ask(deps({ row: null }))).toEqual({ kind: "gone" });
  });

  it("🔴 another person's row is gone — not forbidden, and it does not carry its name", async () => {
    const d = deps({ row: { ...PLAIN, name: "Secret Plans", personId: "someone-else" } });
    const state = await ask(d);
    expect(state).toEqual({ kind: "gone" });
    expect(JSON.stringify(state)).not.toContain("Secret");
    // It does not go on to ask about the owner's plan or tool installation either.
    expect(d.plan).not.toHaveBeenCalled();
    expect(d.toolInstallation).not.toHaveBeenCalled();
  });

  it("a removed row is gone, and says whose app it was (the person's own: its name is theirs to read)", async () => {
    expect(await ask(deps({ row: { ...PLAIN, removedAt: new Date() } }))).toEqual({ kind: "gone", name: "Bookings" });
  });

  it("🔴 a tool whose rail installation was removed is gone", async () => {
    const d = deps({ row: TOOL, toolInstallation: vi.fn(async () => ({ ...RAIL_ON, removedAt: new Date() })) });
    expect(await ask(d)).toEqual({ kind: "gone", name: "Bookings" });
    expect(d.toolInstallation).toHaveBeenCalledWith("ti1");
  });

  it("a tool whose installation is switched off, is of another project, or is missing is gone", async () => {
    for (const installation of [{ ...RAIL_ON, enabled: false }, { ...RAIL_ON, projectId: "p2" }, { ...RAIL_ON, personId: "u2" }, null]) {
      expect(await ask(deps({ row: TOOL, toolInstallation: vi.fn(async () => installation) }))).toEqual({ kind: "gone", name: "Bookings" });
    }
  });

  it("a tool with OPENLEN_TOOLS=0 is gone, an ordinary app is not", async () => {
    expect(await ask(deps({ row: TOOL, toolsEnabled: () => false }))).toEqual({ kind: "gone", name: "Bookings" });
    expect((await ask(deps({ row: PLAIN, toolsEnabled: () => false }))).kind).toBe("ready");
  });

  it("🔴 a free owner is plan_required, with the name of their app", async () => {
    const d = deps({ plan: vi.fn(async () => "free" as const) });
    expect(await ask(d)).toEqual({ kind: "plan_required", name: "Bookings" });
    expect(d.plan).toHaveBeenCalledWith("u1");
  });

  it("a removed row is gone before the plan is asked", async () => {
    const d = deps({ row: { ...PLAIN, removedAt: new Date() }, plan: vi.fn(async () => "free" as const) });
    expect((await ask(d)).kind).toBe("gone");
    expect(d.plan).not.toHaveBeenCalled();
  });

  it("an ordinary app is ready: the frame is its private host with the release in the query", async () => {
    const d = deps();
    expect(await ask(d)).toEqual({
      kind: "ready",
      name: "Bookings",
      frameUrl: `https://${LABEL}.openlen.app/?v=sha1`,
      frameOrigin: `https://${LABEL}.openlen.app`,
      projectId: "p1",
      releaseSha: "sha1",
      toolInstallationId: null,
      installedAt: INSTALLED_AT.toISOString(),
    });
    // An ordinary app never asks about a tool installation.
    expect(d.toolInstallation).not.toHaveBeenCalled();
  });

  it("a tool is ready with its installation id: it is its bridge's caller", async () => {
    const state = await ask(deps({ row: TOOL }));
    expect(state).toMatchObject({ kind: "ready", toolInstallationId: "ti1" });
  });

  it("locally the frame is on the *.localhost label at the request's port", async () => {
    const state = await ask(deps({ env: { NODE_ENV: "development" } }), { requestHost: "localhost:3007" });
    expect(state).toMatchObject({ kind: "ready", frameUrl: `http://${LABEL}.localhost:3007/?v=sha1`, frameOrigin: `http://${LABEL}.localhost:3007` });
  });

  it("with the canvas origin switched off there is no isolated host, so the app is gone", async () => {
    const state = await ask(deps({ env: { ...PROD, OPENLEN_LIENZO_ORIGEN: "0" } }));
    expect(state).toEqual({ kind: "gone", name: "Bookings" });
  });

  it("a lookup that fails is an error, never «the app is gone» (the person would uninstall a working app)", async () => {
    const down = async (): Promise<never> => {
      throw new Error("db down");
    };
    await expect(ask({ ...deps(), row: vi.fn(down) })).rejects.toThrow("db down");
    await expect(ask(deps({ row: TOOL, toolInstallation: vi.fn(down) }))).rejects.toThrow("db down");
    await expect(ask(deps({ plan: vi.fn(down) }))).rejects.toThrow("db down");
  });
});

describe("desktopWindow — the row only comes with a window to show", () => {
  const win = (d: PageStateDeps, over: { sessionUserId?: string | null } = {}) =>
    desktopWindow({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com", ...over }, d);

  it("ready and plan_required bring the row (the manifest and the icon need its release and icon path)", async () => {
    expect((await win(deps())).row).toEqual(PLAIN);
    expect((await win(deps({ plan: vi.fn(async () => "free" as const) }))).row).toEqual(PLAIN);
  });

  it("🔴 every other state brings no row, not even a person's own removed one", async () => {
    expect((await win(deps({ enabled: () => false }))).row).toBeNull();
    expect((await win(deps(), { sessionUserId: null })).row).toBeNull();
    expect((await win(deps({ row: null }))).row).toBeNull();
    expect((await win(deps({ row: { ...PLAIN, personId: "someone-else" } }))).row).toBeNull();
    expect((await win(deps({ row: { ...PLAIN, removedAt: new Date() } }))).row).toBeNull();
  });
});
