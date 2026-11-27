// @vitest-environment node
// «Instalar en el escritorio» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.2, §5, §6): the checks before the
// gates, in order, then the gates themselves (shared with a tool's install) and the person's row. Fake dependencies.
import { describe, expect, it, vi } from "vitest";

import { AppNoCompilaError } from "@/lib/apps/compilador";
import { DataChangesNeedConfirmationError } from "@/lib/backend/data-changes";
import type { ProjectData } from "@/lib/projects/types";

import { filesFingerprint } from "./fingerprint";
import { desktopAppState, desktopInstalledForPublish, installDesktopApp, removeDesktopApp, type DesktopDeps } from "./install";
import type { DesktopAppRow } from "./store";

const HTML = '<div id="root"></div>';
const FILES: Record<string, string> = { "/src/main.tsx": "x", "/src/App.tsx": "y", "/tests/App.test.tsx": "t" };
const RELEASE = { sha: "sha1", files: { "/index.html": { content: "x", contentType: "text/html" } }, jobFiles: {} };
const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };

type Project = { title: string; subdomain: string | null; data: ProjectData };
const project = (over: Partial<Project> = {}, data: Partial<ProjectData> = {}): Project => ({
  title: "Mis reservas",
  subdomain: null,
  data: { html: HTML, app: APP, ...data } as ProjectData,
  ...over,
});

/** What the real store promises (its own test proves it against Postgres): the row of a person and a project keeps its
 *  id and host label, an update moves the release, and a removed row comes back. */
function fakeStore() {
  const rows = new Map<string, DesktopAppRow>();
  let n = 0;
  const upsertDesktopApp = vi.fn(async (i: Parameters<DesktopDeps["upsertDesktopApp"]>[0]) => {
    const key = `${i.personId}/${i.projectId}`;
    const existing = rows.get(key);
    const id = existing?.id ?? `d${++n}`;
    const row: DesktopAppRow = {
      id,
      personId: i.personId,
      projectId: i.projectId,
      releaseSha: i.releaseSha,
      name: i.name,
      iconPath: i.iconPath,
      toolInstallationId: i.toolInstallationId,
      filesFingerprint: i.filesFingerprint,
      hostLabel: existing?.hostLabel ?? i.hostLabelFor(id),
      installedAt: existing?.installedAt ?? new Date("2026-11-26T10:00:00Z"),
      updatedAt: new Date("2026-11-26T11:00:00Z"),
      removedAt: null,
    };
    rows.set(key, row);
    return row;
  });
  const desktopAppOf = vi.fn(async (personId: string, projectId: string) => rows.get(`${personId}/${projectId}`) ?? null);
  const markRemoved = vi.fn(async (id: string, personId: string) => {
    const row = [...rows.values()].find((r) => r.id === id && r.personId === personId);
    if (!row) return false;
    row.removedAt ??= new Date("2026-11-26T12:00:00Z");
    return true;
  });
  const hasActiveDesktopApp = vi.fn(async (projectId: string) => [...rows.values()].some((r) => r.projectId === projectId && !r.removedAt));
  return { rows, upsertDesktopApp, desktopAppOf, hasActiveDesktopApp, markRemoved };
}

const deps = (over: Partial<DesktopDeps> = {}, store = fakeStore()): DesktopDeps & { store: ReturnType<typeof fakeStore> } => ({
  store,
  enabled: () => true,
  plan: vi.fn(async () => "pro" as const),
  access: vi.fn(async () => ({ rol: "dueno" as const, duenoId: "u1" })),
  loadProject: vi.fn(async () => project()),
  files: vi.fn(async () => FILES),
  usesStripe: vi.fn(async () => false),
  toolInstallation: vi.fn(async () => null),
  releaseExists: vi.fn(async () => true),
  securityGate: vi.fn(async () => ({ fingerprint: "fp1" })),
  entorno: vi.fn(async () => ({})),
  build: vi.fn(async () => RELEASE),
  prepareFunctions: vi.fn(async () => null),
  dataChanges: vi.fn(async () => {}),
  saveRelease: vi.fn(async () => {}),
  markPublished: vi.fn(async () => {}),
  desktopAppOf: store.desktopAppOf,
  hasActiveDesktopApp: store.hasActiveDesktopApp,
  upsertDesktopApp: store.upsertDesktopApp,
  markRemoved: store.markRemoved,
  hostLabelFor: (id) => `lienzo-${id.padEnd(32, "0")}`,
  ...over,
});

const install = (d: DesktopDeps, over: Partial<Parameters<typeof installDesktopApp>[0]> = {}) =>
  installDesktopApp({ projectId: "p1", actorId: "u1", locale: "es", requestHost: "localhost:3000", ...over }, d);

describe("installDesktopApp: the order of the checks", () => {
  it("1. OPENLEN_DESKTOP_APPS=0: 404 desktop_apps_off, nothing else is asked", async () => {
    const d = deps({ enabled: () => false });
    expect(await install(d)).toEqual({ status: 404, body: { error: "desktop_apps_off" } });
    expect(d.plan).not.toHaveBeenCalled();
    expect(d.securityGate).not.toHaveBeenCalled();
  });

  it("2. free plan: 402 plan_required, before the access check, nothing saved", async () => {
    const d = deps({ plan: vi.fn(async () => "free" as const) });
    expect(await install(d)).toEqual({ status: 402, body: { error: "plan_required" } });
    expect(d.access).not.toHaveBeenCalled();
    expect(d.saveRelease).not.toHaveBeenCalled();
  });

  it("3. no access: the access answer as it is", async () => {
    const d = deps({ access: vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })) });
    expect(await install(d)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(d.loadProject).not.toHaveBeenCalled();
  });

  it("3. a member editor: 403 owner_only", async () => {
    const d = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) });
    expect(await install(d)).toEqual({ status: 403, body: { error: "owner_only" } });
    expect(d.access).toHaveBeenCalledWith("p1", "u1");
    expect(d.securityGate).not.toHaveBeenCalled();
  });

  it("4. a page that is not an app: 409 not_an_app", async () => {
    const d = deps({ loadProject: vi.fn(async () => project({}, { app: undefined })) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "not_an_app" } });
    expect(d.usesStripe).not.toHaveBeenCalled();
    expect(d.securityGate).not.toHaveBeenCalled();
  });

  it("4. a project that is gone: 409 not_an_app", async () => {
    const d = deps({ loadProject: vi.fn(async () => null) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "not_an_app" } });
  });

  it("5. an app that uses Stripe: 409 uses_stripe, before the gates", async () => {
    const d = deps({ usesStripe: vi.fn(async () => true) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "uses_stripe" } });
    expect(d.usesStripe).toHaveBeenCalledWith("p1");
    expect(d.securityGate).not.toHaveBeenCalled();
    expect(d.saveRelease).not.toHaveBeenCalled();
  });

  it("6. a tool the person has not installed: 409 tool_not_installed", async () => {
    const d = deps({ loadProject: vi.fn(async () => project({}, { tool: { bornAt: "x" } })), toolInstallation: vi.fn(async () => null) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "tool_not_installed" } });
    expect(d.toolInstallation).toHaveBeenCalledWith("u1", "p1");
    expect(d.securityGate).not.toHaveBeenCalled();
  });

  it("6. a tool whose installation was removed: 409 tool_not_installed", async () => {
    const removed = { id: "i1", iconPath: "/icon.svg", enabled: true, removedAt: new Date("2026-11-20T00:00:00Z") };
    const d = deps({ loadProject: vi.fn(async () => project({}, { tool: { bornAt: "x" } })), toolInstallation: vi.fn(async () => removed) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "tool_not_installed" } });
    expect(d.securityGate).not.toHaveBeenCalled();
  });

  // Switching a tool off stops it everywhere (controller ruling on the spec): off in the rail is not installed here.
  it("a switched-off tool is tool_not_installed", async () => {
    const off = { id: "i1", iconPath: "/icon.svg", enabled: false, removedAt: null };
    const d = deps({ loadProject: vi.fn(async () => project({}, { tool: { bornAt: "x" } })), toolInstallation: vi.fn(async () => off) });
    expect(await install(d)).toEqual({ status: 409, body: { error: "tool_not_installed" } });
    expect(d.securityGate).not.toHaveBeenCalled();
    expect(d.upsertDesktopApp).not.toHaveBeenCalled();
  });

  it("the checks that don't need the project run before it is loaded, and the cheap ones before the gates", async () => {
    const order: string[] = [];
    const d = deps({
      enabled: () => (order.push("enabled"), true),
      plan: vi.fn(async () => (order.push("plan"), "pro" as const)),
      access: vi.fn(async () => (order.push("access"), { rol: "dueno" as const, duenoId: "u1" })),
      loadProject: vi.fn(async () => (order.push("load"), project())),
      usesStripe: vi.fn(async () => (order.push("stripe"), false)),
      securityGate: vi.fn(async () => (order.push("gate"), { fingerprint: "fp1" })),
    });
    expect((await install(d)).status).toBe(200);
    expect(order).toEqual(["enabled", "plan", "access", "load", "stripe", "gate"]);
  });
});

describe("installDesktopApp: through the gates, then the row", () => {
  it("installs an app: the gates run, the release is saved, and the row has the project's name and the fingerprint of its files", async () => {
    const d = deps();
    const r = await install(d);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      desktopApp: { id: "d1", url: "/desktop/d1", name: "Mis reservas", releaseSha: "sha1", installedAt: "2026-11-26T10:00:00.000Z" },
      published: false,
    });
    expect(d.saveRelease).toHaveBeenCalledWith("sha1", "p1", RELEASE.files, {}, null);
    expect(d.markPublished).toHaveBeenCalledWith("p1", "fp1");
    expect(d.upsertDesktopApp).toHaveBeenCalledWith(
      expect.objectContaining({
        personId: "u1",
        projectId: "p1",
        releaseSha: "sha1",
        name: "Mis reservas",
        iconPath: null,
        toolInstallationId: null,
        filesFingerprint: filesFingerprint(HTML, FILES),
      }),
    );
  });

  it("the build gets the app's shell and files, an empty icon path for a plain app, and the acceptances reach their gates", async () => {
    const d = deps();
    await install(d, { acceptSecurityFingerprint: "sfp", confirmFingerprint: "dfp", copyDraftData: true, skipMissingSecrets: true });
    expect(d.securityGate).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", locale: "es", accept: "sfp" });
    expect(d.build).toHaveBeenCalledWith({ projectId: "p1", html: HTML, files: FILES, app: APP, entorno: {}, iconPath: "" });
    expect(d.prepareFunctions).toHaveBeenCalledWith("p1", { skipMissingSecrets: true });
    expect(d.dataChanges).toHaveBeenCalledWith({ projectId: "p1", confirmFingerprint: "dfp", copyDraftData: true });
  });

  it("a published project says so, for the warning that the site and the desktop app share their data", async () => {
    const d = deps({ loadProject: vi.fn(async () => project({ subdomain: "acme" })) });
    expect((await install(d)).body.published).toBe(true);
  });

  it("a tool uses its toolInstallation id and icon", async () => {
    const active = { id: "ti1", iconPath: "/icon.svg", enabled: true, removedAt: null };
    const d = deps({ loadProject: vi.fn(async () => project({}, { tool: { bornAt: "x" } })), toolInstallation: vi.fn(async () => active) });
    const r = await install(d);

    expect(r.status).toBe(200);
    expect(d.build).toHaveBeenCalledWith(expect.objectContaining({ iconPath: "/icon.svg" }));
    expect(d.upsertDesktopApp).toHaveBeenCalledWith(expect.objectContaining({ toolInstallationId: "ti1", iconPath: "/icon.svg" }));
  });

  it("reinstall keeps the same desktop id", async () => {
    let files = FILES;
    const d = deps({ files: vi.fn(async () => files) });
    const first = await install(d);
    files = { ...FILES, "/src/App.tsx": "changed" }; // something to update: with nothing changed the install does nothing
    const second = await install(d, { locale: "en" });

    expect(second.status).toBe(200);
    const id = (first.body.desktopApp as { id: string }).id;
    expect((second.body.desktopApp as { id: string }).id).toBe(id);
    expect(d.store.rows.size).toBe(1);
    // The same person and project reach the store both times: that key is what keeps the row (and its host label).
    expect(d.upsertDesktopApp).toHaveBeenNthCalledWith(1, expect.objectContaining({ personId: "u1", projectId: "p1" }));
    expect(d.upsertDesktopApp).toHaveBeenNthCalledWith(2, expect.objectContaining({ personId: "u1", projectId: "p1" }));
  });

  it("an update moves the release and the fingerprint, and keeps the address", async () => {
    let files = FILES;
    const d = deps({ files: vi.fn(async () => files), build: vi.fn(async () => RELEASE) });
    await install(d);
    const before = d.store.rows.get("u1/p1")!;

    files = { ...FILES, "/src/App.tsx": "changed" };
    d.build = vi.fn(async () => ({ ...RELEASE, sha: "sha2" }));
    const r = await install(d);

    expect(r.status).toBe(200);
    const after = d.store.rows.get("u1/p1")!;
    expect(after.releaseSha).toBe("sha2");
    expect(after.filesFingerprint).toBe(filesFingerprint(HTML, files));
    expect(after.filesFingerprint).not.toBe(before.filesFingerprint);
    expect(after.id).toBe(before.id);
    expect(after.hostLabel).toBe(before.hostLabel);
  });

  // Claude has no «update» when nothing changed (its content is live and identical bytes are skipped): an install of an
  // app whose files are the installed ones, whose release is still there, is the same row — no review, no build, no deploy.
  describe("nothing changed since the installed version", () => {
    const gatesRan = (d: DesktopDeps) =>
      [d.securityGate, d.entorno, d.build, d.prepareFunctions, d.dataChanges, d.saveRelease, d.markPublished].some((g) => vi.mocked(g).mock.calls.length > 0);

    it("🔴 the same row comes back and the gates do not run", async () => {
      const d = deps();
      const first = await install(d);
      vi.clearAllMocks();

      const again = await install(d);

      expect(again).toEqual(first);
      expect(gatesRan(d)).toBe(false);
      expect(d.upsertDesktopApp).not.toHaveBeenCalled();
      expect(d.releaseExists).toHaveBeenCalledWith("sha1");
      expect(d.store.rows.get("u1/p1")!.updatedAt).toEqual(new Date("2026-11-26T11:00:00Z"));
    });

    it("the window's own update does the same", async () => {
      const d = deps();
      await install(d);
      vi.clearAllMocks();
      expect((await install(d, { fromWindow: true })).status).toBe(200);
      expect(gatesRan(d)).toBe(false);
    });

    it("a release that is gone is built again", async () => {
      const d = deps();
      await install(d);
      vi.clearAllMocks();
      d.releaseExists = vi.fn(async () => false);
      expect((await install(d)).status).toBe(200);
      expect(d.build).toHaveBeenCalled();
      expect(d.saveRelease).toHaveBeenCalled();
    });

    it("a removed app is installed again whatever its files", async () => {
      const d = deps();
      await install(d);
      await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d);
      vi.clearAllMocks();
      expect((await install(d)).status).toBe(200);
      expect(d.build).toHaveBeenCalled();
      expect(d.store.rows.get("u1/p1")!.removedAt).toBeNull();
    });

    it("a renamed project is an update: the window takes the new name", async () => {
      let p = project();
      const d = deps({ loadProject: vi.fn(async () => p) });
      await install(d);
      vi.clearAllMocks();
      p = project({ title: "Mis reservas 2" });
      const r = await install(d);
      expect(r.status).toBe(200);
      expect((r.body.desktopApp as { name: string }).name).toBe("Mis reservas 2");
      expect(d.build).toHaveBeenCalled();
    });

    it("a changed file, test or shell: the gates run, as for any update", async () => {
      let files = FILES;
      const d = deps({ files: vi.fn(async () => files) });
      await install(d);
      vi.clearAllMocks();
      files = { ...FILES, "/src/App.tsx": "changed" };
      expect((await install(d)).status).toBe(200);
      expect(d.securityGate).toHaveBeenCalledTimes(1);
      expect(d.upsertDesktopApp).toHaveBeenCalledTimes(1);
    });

    it("the checks before the gates still answer: a free plan, an app that now uses Stripe", async () => {
      const d = deps();
      await install(d);
      d.plan = vi.fn(async () => "free" as const);
      expect(await install(d)).toEqual({ status: 402, body: { error: "plan_required" } });
      d.plan = vi.fn(async () => "pro" as const);
      d.usesStripe = vi.fn(async () => true);
      expect(await install(d)).toEqual({ status: 409, body: { error: "uses_stripe" } });
    });

    it("a tool whose rail installation moved is an update: the row points at the new one", async () => {
      const tool = { loadProject: vi.fn(async () => project({}, { tool: { bornAt: "x" } })) };
      let installation = { id: "ti1", iconPath: "/icon.svg", enabled: true, removedAt: null };
      const d = deps({ ...tool, toolInstallation: vi.fn(async () => installation) });
      await install(d);
      vi.clearAllMocks();
      installation = { ...installation, id: "ti2" };
      expect((await install(d)).status).toBe(200);
      expect(d.upsertDesktopApp).toHaveBeenCalledWith(expect.objectContaining({ toolInstallationId: "ti2" }));
    });
  });

  it("a removed app comes back when it is installed again", async () => {
    const d = deps();
    await install(d);
    await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d);
    expect(d.store.rows.get("u1/p1")!.removedAt).not.toBeNull();
    expect((await install(d)).status).toBe(200);
    expect(d.store.rows.get("u1/p1")!.removedAt).toBeNull();
  });

  // Claude reconciles with what is installed before it acts, and a window cannot outlive an uninstall. A window that stayed
  // open after the app was removed elsewhere must not bring it back: only the workspace's own button (no flag) installs again.
  describe("from the window (fromWindow: true)", () => {
    it("🔴 an app removed elsewhere is not installed again: 409 desktop_app_removed, nothing run, nothing saved", async () => {
      const d = deps();
      await install(d);
      await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d);
      vi.clearAllMocks();

      expect(await install(d, { fromWindow: true })).toEqual({ status: 409, body: { error: "desktop_app_removed" } });
      expect(d.securityGate).not.toHaveBeenCalled();
      expect(d.build).not.toHaveBeenCalled();
      expect(d.saveRelease).not.toHaveBeenCalled();
      expect(d.upsertDesktopApp).not.toHaveBeenCalled();
      expect(d.store.rows.get("u1/p1")!.removedAt).not.toBeNull();
    });

    it("🔴 an app never installed is the same: 409 desktop_app_removed", async () => {
      const d = deps();
      expect(await install(d, { fromWindow: true })).toEqual({ status: 409, body: { error: "desktop_app_removed" } });
      expect(d.securityGate).not.toHaveBeenCalled();
      expect(d.upsertDesktopApp).not.toHaveBeenCalled();
    });

    it("an installed app updates as usual", async () => {
      let files = FILES;
      const d = deps({ files: vi.fn(async () => files) });
      await install(d);
      files = { ...FILES, "/src/App.tsx": "changed" };
      d.build = vi.fn(async () => ({ ...RELEASE, sha: "sha2" }));
      const r = await install(d, { fromWindow: true });
      expect(r.status).toBe(200);
      expect(d.store.rows.get("u1/p1")!.releaseSha).toBe("sha2");
    });

    it("the workspace's own install (no flag) still brings a removed app back", async () => {
      const d = deps();
      await install(d);
      await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d);
      expect((await install(d, { fromWindow: false })).status).toBe(200);
      expect(d.store.rows.get("u1/p1")!.removedAt).toBeNull();
    });

    it("the earlier checks answer first: a free owner is plan_required, a member is owner_only", async () => {
      expect(await install(deps({ plan: vi.fn(async () => "free" as const) }), { fromWindow: true })).toEqual({ status: 402, body: { error: "plan_required" } });
      const asEditor = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) });
      expect(await install(asEditor, { fromWindow: true })).toEqual({ status: 403, body: { error: "owner_only" } });
      expect(asEditor.desktopAppOf).not.toHaveBeenCalled();
    });
  });

  it("a gate stop leaves the row's releaseSha unchanged", async () => {
    let files = FILES;
    const d = deps({ files: vi.fn(async () => files) });
    await install(d);
    expect(d.store.rows.get("u1/p1")!.releaseSha).toBe("sha1");
    const keep = { ...d.store.rows.get("u1/p1")! };

    files = { ...FILES, "/src/App.tsx": "changed" };
    d.securityGate = vi.fn(async () => ({ stop: { status: 428, body: { error: "security_findings", fingerprint: "fp9" } } }));
    d.build = vi.fn(async () => ({ ...RELEASE, sha: "sha2" }));
    const r = await install(d);

    expect(r).toEqual({ status: 428, body: { error: "security_findings", fingerprint: "fp9" } });
    expect(d.build).not.toHaveBeenCalled();
    expect(d.upsertDesktopApp).toHaveBeenCalledTimes(1);
    expect(d.store.rows.get("u1/p1")).toEqual(keep);
  });

  it("an app that doesn't compile: 422, nothing migrated, the row unchanged", async () => {
    const d = deps({
      build: vi.fn(async () => {
        throw new AppNoCompilaError([{ ruta: "/src/App.tsx", linea: 3, columna: 1, mensaje: "Unexpected token" }]);
      }),
    });
    const r = await install(d);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("app_does_not_compile");
    expect(d.dataChanges).not.toHaveBeenCalled();
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.upsertDesktopApp).not.toHaveBeenCalled();
  });

  it("a destructive data change asks for its confirmation: 428, no release, no row", async () => {
    const d = deps({
      dataChanges: vi.fn(async () => {
        throw new DataChangesNeedConfirmationError([], "dfp1");
      }),
    });
    const r = await install(d);
    expect(r.status).toBe(428);
    expect(d.saveRelease).not.toHaveBeenCalled();
    expect(d.upsertDesktopApp).not.toHaveBeenCalled();
  });

  it("a failure saving the row is a 500 install_failed, logged with the desktop tag", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const d = deps({
        upsertDesktopApp: vi.fn(async () => {
          throw new Error("db down");
        }),
      });
      expect(await install(d)).toEqual({ status: 500, body: { error: "install_failed" } });
      expect(error).toHaveBeenCalledWith("[desktop-apps] install failed:", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });

  // Claude saves its install list and undoes what came before when that fails: the row is saved BEFORE the security review's
  // base moves, so a row that is not saved leaves the base on what it was.
  it("the row is saved before the security review's base moves, and a row that fails to save never moves it", async () => {
    const order: string[] = [];
    const ok = deps({
      saveRelease: vi.fn(async () => void order.push("release")),
      markPublished: vi.fn(async () => void order.push("markPublished")),
    });
    const upsert = ok.upsertDesktopApp;
    ok.upsertDesktopApp = vi.fn(async (...a: Parameters<typeof upsert>) => (order.push("row"), upsert(...a)));
    expect((await install(ok)).status).toBe(200);
    expect(order).toEqual(["release", "row", "markPublished"]);

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failing = deps({
        upsertDesktopApp: vi.fn(async () => {
          throw new Error("db down");
        }),
      });
      expect(await install(failing)).toEqual({ status: 500, body: { error: "install_failed" } });
      expect(failing.markPublished).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("the gates log under the desktop tag too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const d = deps({
        saveRelease: vi.fn(async () => {
          throw new Error("disk full");
        }),
      });
      expect((await install(d)).status).toBe(500);
      expect(error).toHaveBeenCalledWith("[desktop-apps] install failed:", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });
});

describe("desktopAppState (the GET)", () => {
  it("OPENLEN_DESKTOP_APPS=0: 404", async () => {
    expect(await desktopAppState({ projectId: "p1", actorId: "u1" }, deps({ enabled: () => false }))).toEqual({ status: 404, body: { error: "desktop_apps_off" } });
  });

  it("not installed: no desktopApp, no update, and whether the project is published", async () => {
    const d = deps({ loadProject: vi.fn(async () => project({ subdomain: "acme" })) });
    expect(await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).toEqual({
      status: 200,
      body: { desktopApp: null, updateAvailable: false, published: true },
    });
  });

  it("installed: the view, and no update while the files are the installed ones", async () => {
    const d = deps();
    await install(d);
    const r = await desktopAppState({ projectId: "p1", actorId: "u1" }, d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      desktopApp: { id: "d1", url: "/desktop/d1", name: "Mis reservas", releaseSha: "sha1", installedAt: "2026-11-26T10:00:00.000Z" },
      updateAvailable: false,
      published: false,
    });
  });

  it("a changed source: update available; a changed test or note: not", async () => {
    let files = FILES;
    const d = deps({ files: vi.fn(async () => files) });
    await install(d);
    files = { ...FILES, "/tests/App.test.tsx": "other", "/LEN.md": "notes" };
    expect((await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).body.updateAvailable).toBe(false);
    files = { ...FILES, "/src/App.tsx": "changed" };
    expect((await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).body.updateAvailable).toBe(true);
  });

  it("a changed shell is an update too", async () => {
    let p = project();
    const d = deps({ loadProject: vi.fn(async () => p) });
    await install(d);
    p = project({}, { html: `${HTML}<!-- v2 -->` });
    expect((await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).body.updateAvailable).toBe(true);
  });

  it("only the owner: a member, no access and a missing project are all 404 not_found", async () => {
    for (const access of [
      vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })),
      vi.fn(async () => ({ rol: "lector" as const, duenoId: "u9" })),
      vi.fn(async () => new Response(null, { status: 403 })),
    ]) {
      const d = deps({ access });
      expect(await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).toEqual({ status: 404, body: { error: "not_found" } });
      expect(d.desktopAppOf).not.toHaveBeenCalled();
    }
    expect(await desktopAppState({ projectId: "p1", actorId: "u1" }, deps({ loadProject: vi.fn(async () => null) }))).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

describe("desktopInstalledForPublish (the GET ?for=publish)", () => {
  const forPublish = (d: DesktopDeps, actorId = "u1") => desktopInstalledForPublish({ projectId: "p1", actorId }, d);

  it("OPENLEN_DESKTOP_APPS=0: nobody has anything installed, and nothing else is asked", async () => {
    const d = deps({ enabled: () => false });
    expect(await forPublish(d)).toEqual({ status: 200, body: { installed: false } });
    expect(d.access).not.toHaveBeenCalled();
    expect(d.hasActiveDesktopApp).not.toHaveBeenCalled();
  });

  it("an editor hears that the owner has it installed: a boolean, nothing about whose", async () => {
    const d = deps();
    await install(d); // the owner, u1
    const asEditor = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u1" })) }, d.store);
    vi.mocked(asEditor.desktopAppOf).mockClear(); // the store is shared with the owner's install, which read its row
    expect(await forPublish(asEditor, "u2")).toEqual({ status: 200, body: { installed: true } });
    expect(asEditor.access).toHaveBeenCalledWith("p1", "u2");
    expect(asEditor.hasActiveDesktopApp).toHaveBeenCalledWith("p1");
    // Not the owner's row, not the project: the answer needs neither.
    expect(asEditor.desktopAppOf).not.toHaveBeenCalled();
    expect(asEditor.loadProject).not.toHaveBeenCalled();
  });

  it("false while nobody has it installed, and again once it is removed", async () => {
    const d = deps();
    expect((await forPublish(d)).body).toEqual({ installed: false });
    await install(d);
    expect((await forPublish(d)).body).toEqual({ installed: true });
    await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d);
    expect((await forPublish(d)).body).toEqual({ installed: false });
  });

  it("no edit access (not a member, or a reader): 404 not_found, and the installation isn't looked up", async () => {
    for (const access of [
      vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })),
      vi.fn(async () => new Response(JSON.stringify({ error: "solo_lectura" }), { status: 403 })),
    ]) {
      const d = deps({ access });
      expect(await forPublish(d)).toEqual({ status: 404, body: { error: "not_found" } });
      expect(d.hasActiveDesktopApp).not.toHaveBeenCalled();
    }
  });

  it("for=publish 404 for a reader: an access that names the role (not a refusal) is not enough either", async () => {
    // `exigirAcceso(..., "editar")` already refuses a reader with a 403, but the answer must not depend on which permission
    // the dependency asked for: a reader doesn't publish, so it doesn't learn whether anyone has the app installed.
    const d = deps();
    await install(d); // the owner has it installed
    const asReader = deps({ access: vi.fn(async () => ({ rol: "lector" as const, duenoId: "u1" })) }, d.store);
    expect(await forPublish(asReader, "u3")).toEqual({ status: 404, body: { error: "not_found" } });
    expect(asReader.hasActiveDesktopApp).not.toHaveBeenCalled();
  });
});

describe("removeDesktopApp (the DELETE)", () => {
  it("marks the person's row removed and the state no longer shows it", async () => {
    const d = deps();
    await install(d);
    expect(await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d)).toEqual({ status: 200, body: { removed: true } });
    expect(d.markRemoved).toHaveBeenCalledWith("d1", "u1");
    expect((await desktopAppState({ projectId: "p1", actorId: "u1" }, d)).body).toEqual({ desktopApp: null, updateAvailable: false, published: false });
  });

  it("nothing installed: removed false, nothing marked", async () => {
    const d = deps();
    expect(await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d)).toEqual({ status: 200, body: { removed: false } });
    expect(d.markRemoved).not.toHaveBeenCalled();
  });

  it("only the owner: anyone else gets 404 and nothing is removed", async () => {
    const d = deps({ access: vi.fn(async () => ({ rol: "editor" as const, duenoId: "u9" })) });
    expect(await removeDesktopApp({ projectId: "p1", actorId: "u1" }, d)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(d.markRemoved).not.toHaveBeenCalled();
  });

  it("OPENLEN_DESKTOP_APPS=0: 404", async () => {
    expect(await removeDesktopApp({ projectId: "p1", actorId: "u1" }, deps({ enabled: () => false }))).toEqual({ status: 404, body: { error: "desktop_apps_off" } });
  });
});
