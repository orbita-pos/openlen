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

/** The shell of an installed version, as `toolReleases.files` keeps it. */
const shell = (permissions: string[]): Record<string, { content: string; contentType: string }> => ({
  "/index.html": {
    content: `<!doctype html><html><head><script id="openlen-app-manifest" type="application/json">${JSON.stringify({ permissions })}</script></head><body><div id="root"></div></body></html>`,
    contentType: "text/html; charset=utf-8",
  },
});

/** A shell whose manifest is not valid JSON. */
const BROKEN = {
  "/index.html": { content: `<script id="openlen-app-manifest" type="application/json">{nope</script>`, contentType: "text/html" },
};

/** `row` is the row the lookup answers (null = none); everything else overrides a dependency. */
function deps(over: Partial<Omit<PageStateDeps, "row">> & { row?: DesktopAppRow | null } = {}): PageStateDeps {
  const { row = PLAIN, ...rest } = over;
  return {
    enabled: () => true,
    notificationsEnabled: () => true,
    toolsEnabled: () => true,
    row: vi.fn(async () => row),
    toolInstallation: vi.fn(async () => RAIL_ON),
    plan: vi.fn(async () => "pro" as const),
    readRelease: vi.fn(async () => shell([])),
    env: PROD,
    ...rest,
  };
}

const ask = (
  d: PageStateDeps,
  over: { id?: string; sessionUserId?: string | null; requestHost?: string | null; withDeclaredPermissions?: boolean } = {},
) => desktopPageState({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com", ...over }, d);

/** What the PAGE asks: the window's state with the release read for what the app declares. */
const askAsPage = (d: PageStateDeps, over: { sessionUserId?: string | null } = {}) => ask(d, { ...over, withDeclaredPermissions: true });

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

  // The window says why, like Claude's «Can't open the app…»: only for the person's own row.
  it("a removed row is gone, and says whose app it was and why (the person's own: its name is theirs to read)", async () => {
    expect(await ask(deps({ row: { ...PLAIN, removedAt: new Date() } }))).toEqual({ kind: "gone", name: "Bookings", reason: "removed" });
  });

  it("🔴 a tool whose rail installation was removed is gone: removed", async () => {
    const d = deps({ row: TOOL, toolInstallation: vi.fn(async () => ({ ...RAIL_ON, removedAt: new Date() })) });
    expect(await ask(d)).toEqual({ kind: "gone", name: "Bookings", reason: "removed" });
    expect(d.toolInstallation).toHaveBeenCalledWith("ti1");
  });

  it("a tool whose installation is switched off is gone: tool_off", async () => {
    expect(await ask(deps({ row: TOOL, toolInstallation: vi.fn(async () => ({ ...RAIL_ON, enabled: false })) }))).toEqual({
      kind: "gone",
      name: "Bookings",
      reason: "tool_off",
    });
  });

  it("a tool whose installation is missing is gone: removed; one of another project or person is gone with no reason", async () => {
    expect(await ask(deps({ row: TOOL, toolInstallation: vi.fn(async () => null) }))).toEqual({ kind: "gone", name: "Bookings", reason: "removed" });
    for (const installation of [{ ...RAIL_ON, projectId: "p2" }, { ...RAIL_ON, personId: "u2" }]) {
      expect(await ask(deps({ row: TOOL, toolInstallation: vi.fn(async () => installation) }))).toEqual({ kind: "gone", name: "Bookings" });
    }
  });

  it("a tool with OPENLEN_TOOLS=0 is gone: tool_off; an ordinary app is not gone", async () => {
    expect(await ask(deps({ row: TOOL, toolsEnabled: () => false }))).toEqual({ kind: "gone", name: "Bookings", reason: "tool_off" });
    expect((await ask(deps({ row: PLAIN, toolsEnabled: () => false }))).kind).toBe("ready");
  });

  it("🔴 another person's row gives no reason either — not even for a removed one or a switched-off tool", async () => {
    const strangers = [
      { ...PLAIN, personId: "someone-else", removedAt: new Date() },
      { ...TOOL, personId: "someone-else" },
    ];
    for (const row of strangers) {
      const state = await ask(deps({ row, toolsEnabled: () => false, toolInstallation: vi.fn(async () => ({ ...RAIL_ON, enabled: false })) }));
      expect(state).toEqual({ kind: "gone" });
      expect(Object.keys(state)).toEqual(["kind"]);
    }
    expect(await ask(deps({ row: null }))).toEqual({ kind: "gone" });
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
      personId: "u1",
      declaredPermissions: [],
      manifestWarning: null,
      notificationsOn: true,
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

  // What the installed version declares (spec local 2026-11-27-notificaciones-del-escritorio, §4.1): read from the shell of the
  // release the window frames, so what the dialog asks about is what the frame runs.
  it("ready carries the release's declared permissions", async () => {
    const d = deps({ readRelease: vi.fn(async () => shell(["notifications", "shortcuts", "nonsense"])) });
    const state = await askAsPage(d);
    expect(state).toMatchObject({ kind: "ready", declaredPermissions: ["notifications", "shortcuts"], manifestWarning: null });
    // The release read is the installed one — the frame's own version.
    expect(d.readRelease).toHaveBeenCalledWith("sha1");
  });

  it("ready carries no declared permissions, and no warning, for a release that declares none", async () => {
    const plain = { "/index.html": { content: "<!doctype html><html><body>hi</body></html>", contentType: "text/html" } };
    expect(await askAsPage(deps({ readRelease: vi.fn(async () => plain) }))).toMatchObject({
      kind: "ready",
      declaredPermissions: [],
      manifestWarning: null,
    });
  });

  // Only the page needs what an app declares. The manifest and the icon ask for the window too, for the row, and must not pay
  // for reading a release — which is the whole `files` of a version — to throw the answer away.
  it("the manifest route path does not read the release", async () => {
    const d = deps({ readRelease: vi.fn(async () => shell(["notifications"])) });
    const state = await ask(d);
    expect(state).toMatchObject({ kind: "ready", declaredPermissions: [], manifestWarning: null });
    expect(d.readRelease).not.toHaveBeenCalled();
    // The row still comes with it (the manifest and the icon need it).
    expect((await desktopWindow({ id: "d1", sessionUserId: "u1", requestHost: "openlen.com" }, d)).row).toEqual(PLAIN);
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("two answers that declare nothing never share one list: changing one changes nothing of the next", async () => {
    const d = deps({ readRelease: vi.fn(async () => shell(["notifications"])) });
    const first = await ask(d);
    if (first.kind !== "ready") throw new Error("expected ready");
    try {
      first.declaredPermissions.push("notifications");
    } catch {
      // a frozen list is fine too
    }
    expect(await ask(d)).toMatchObject({ kind: "ready", declaredPermissions: [] });
  });

  it("notifications off → no release read", async () => {
    // A release a read of which WOULD warn: with the switch off it is not even read.
    const d = deps({ notificationsEnabled: () => false, readRelease: vi.fn(async () => BROKEN) });
    const state = await askAsPage(d);
    // Every permission is «unavailable» with the switch off: there is nothing to ask about, and nothing to warn about.
    expect(state).toMatchObject({ kind: "ready", notificationsOn: false, declaredPermissions: [], manifestWarning: null });
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("an unreadable release shell gives no permissions, still ready", async () => {
    const unreadable: Array<[string, PageStateDeps["readRelease"]]> = [
      ["no release row", async () => null],
      ["no /index.html", async () => ({ "/main.js": { content: "x", contentType: "text/javascript" } })],
      // A blob pointer is a file kept in object storage: the shell is never one a manifest can be read from.
      ["a blob pointer", async () => ({ "/index.html": { content: `￿openlen-blob:${"a".repeat(64)}:10:${"b".repeat(40)}`, contentType: "text/html" } })],
      ["a read that throws", async () => { throw new Error("db down"); }],
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const [, readRelease] of unreadable) {
        const state = await askAsPage(deps({ readRelease: vi.fn(readRelease) }));
        expect(state).toMatchObject({ kind: "ready", name: "Bookings", declaredPermissions: [], manifestWarning: null });
      }
      // Only the read that FAILED is logged: a missing file is a fact about the app, not a fault.
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  // The spec (§4.1): a manifest that does not parse leaves the app with no permissions and says so in the page's CONSOLE —
  // never to the person. The window logs it (Claude logs its EINVAL to the page console the same way), so the state carries it.
  it("a broken manifest gives no permissions, still ready, and carries its warning for the console", async () => {
    const state = await askAsPage(deps({ readRelease: vi.fn(async () => BROKEN) }));
    expect(state).toMatchObject({ kind: "ready", name: "Bookings", declaredPermissions: [] });
    const warning = (state as { manifestWarning: string | null }).manifestWarning;
    expect(warning).toContain("openlen-app-manifest");
    expect(warning).toContain("not valid JSON");
    expect(Object.keys(state)).not.toContain("error");
  });

  it("an over-sized manifest carries its warning too; a valid one carries none", async () => {
    const big = {
      "/index.html": {
        content: `<script id="openlen-app-manifest" type="application/json">${JSON.stringify({ permissions: ["notifications"], pad: "x".repeat(20_000) })}</script>`,
        contentType: "text/html",
      },
    };
    const over = await askAsPage(deps({ readRelease: vi.fn(async () => big) }));
    expect(over).toMatchObject({ kind: "ready", declaredPermissions: [] });
    expect((over as { manifestWarning: string | null }).manifestWarning).toContain("16000");
    expect(await askAsPage(deps({ readRelease: vi.fn(async () => shell(["notifications"])) }))).toMatchObject({
      declaredPermissions: ["notifications"],
      manifestWarning: null,
    });
  });

  it("notificationsOn follows OPENLEN_DESKTOP_NOTIFICATIONS", async () => {
    expect(await ask(deps({ notificationsEnabled: () => true }))).toMatchObject({ kind: "ready", notificationsOn: true });
    expect(await ask(deps({ notificationsEnabled: () => false }))).toMatchObject({ kind: "ready", notificationsOn: false });
  });

  it("🔴 personId is the session's own, the one the row was checked against", async () => {
    const state = await ask(deps({ row: { ...PLAIN, personId: "u9" } }), { sessionUserId: "u9" });
    expect(state).toMatchObject({ kind: "ready", personId: "u9" });
  });

  it("🔴 the release is not read for any state but ready: no name, no files, no person for anyone else's row", async () => {
    const readRelease = vi.fn(async () => shell(["notifications"]));
    for (const d of [
      deps({ readRelease, enabled: () => false }),
      deps({ readRelease, row: null }),
      deps({ readRelease, row: { ...PLAIN, personId: "someone-else" } }),
      deps({ readRelease, row: { ...PLAIN, removedAt: new Date() } }),
      deps({ readRelease, plan: vi.fn(async () => "free" as const) }),
      deps({ readRelease, env: { ...PROD, OPENLEN_LIENZO_ORIGEN: "0" } }),
    ]) {
      expect((await askAsPage(d)).kind).not.toBe("ready");
    }
    expect(await askAsPage(deps({ readRelease }), { sessionUserId: null })).toEqual({ kind: "sign_in" });
    expect(readRelease).not.toHaveBeenCalled();
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
