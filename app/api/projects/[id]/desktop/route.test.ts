// @vitest-environment node
// /api/projects/[id]/desktop (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.4, §4.6): POST installs or updates,
// GET says what is installed and whether the project moved on, DELETE removes. Only the dependencies are fake — the
// route, `installDesktopApp`/`desktopAppState`/`removeDesktopApp` and the fingerprint are the real ones.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopDeps } from "@/lib/desktop-apps/install";
import type { DesktopAppRow } from "@/lib/desktop-apps/store";
import type { ProjectData } from "@/lib/projects/types";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/desktop-apps/deps", () => ({ realDesktopDeps: vi.fn() }));

const { auth } = await import("@/auth");
const { realDesktopDeps } = await import("@/lib/desktop-apps/deps");
const { POST, GET, DELETE } = await import("./route");

const ctx = { params: Promise.resolve({ id: "p1" }) };
const url = "http://localhost:3000/api/projects/p1/desktop";
const post = (body: unknown = {}) => POST(new Request(url, { method: "POST", headers: { host: "localhost:3000" }, body: JSON.stringify(body) }), ctx);
const get = () => GET(new Request(url), ctx);
const del = () => DELETE(new Request(url, { method: "DELETE" }), ctx);

// The project, its files and the person's row live in these, and the fake store keeps the row's id like the real one.
let files: Record<string, string>;
let rol: "dueno" | "editor";
let row: DesktopAppRow | null;
let gate: { stop: { status: number; body: Record<string, unknown> } } | { fingerprint: string | null };
let sha: string;

function fakeDeps(): DesktopDeps {
  return {
    enabled: () => true,
    plan: async () => "pro",
    access: async () => ({ rol, duenoId: "u1" }),
    loadProject: async () => ({ title: "Reservas", subdomain: null, data: { html: "<div id=root></div>", app: { catalogo: "2026-11", entrada: "/src/main.tsx" } } as ProjectData }),
    files: async () => files,
    usesStripe: async () => false,
    toolInstallation: async () => null,
    securityGate: async () => gate,
    entorno: async () => ({}),
    build: async () => ({ sha, files: { "/index.html": { content: "x", contentType: "text/html" } }, jobFiles: {} }),
    prepareFunctions: async () => null,
    dataChanges: async () => {},
    saveRelease: async () => {},
    markPublished: async () => {},
    desktopAppOf: async () => row,
    upsertDesktopApp: async (i) => {
      row = {
        id: row?.id ?? "d1",
        personId: i.personId,
        projectId: i.projectId,
        releaseSha: i.releaseSha,
        name: i.name,
        iconPath: i.iconPath,
        toolInstallationId: i.toolInstallationId,
        filesFingerprint: i.filesFingerprint,
        hostLabel: row?.hostLabel ?? i.hostLabelFor("d1"),
        installedAt: row?.installedAt ?? new Date("2026-11-26T10:00:00Z"),
        updatedAt: new Date("2026-11-26T11:00:00Z"),
        removedAt: null,
      };
      return row;
    },
    markRemoved: async (id, personId) => {
      if (!row || row.id !== id || row.personId !== personId) return false;
      row = { ...row, removedAt: new Date("2026-11-26T12:00:00Z") };
      return true;
    },
    hostLabelFor: (id) => `lienzo-${id.padEnd(32, "0")}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  files = { "/src/main.tsx": "import './App'", "/src/App.tsx": "export default () => 1" };
  rol = "dueno";
  row = null;
  gate = { fingerprint: "fp1" };
  sha = "sha1";
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
  vi.mocked(realDesktopDeps).mockImplementation(async () => fakeDeps());
});

describe("POST /api/projects/[id]/desktop", () => {
  it("POST 401 without session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(realDesktopDeps).not.toHaveBeenCalled();
  });

  it("installs for the person in the session and answers the view", async () => {
    const res = await post({ locale: "es" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      desktopApp: { id: "d1", url: "/desktop/d1", name: "Reservas", releaseSha: "sha1", installedAt: "2026-11-26T10:00:00.000Z" },
      published: false,
    });
    expect(row?.personId).toBe("u1");
  });

  it("answers a gate's status as it is, and leaves nothing installed", async () => {
    gate = { stop: { status: 428, body: { error: "security_findings", fingerprint: "fp9" } } };
    const res = await post({});
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "security_findings", fingerprint: "fp9" });
    expect(row).toBeNull();
  });

  it("a member editor: 403 owner_only", async () => {
    rol = "editor";
    const res = await post({});
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "owner_only" });
  });

  it("an empty body is fine (the locale defaults); a malformed one is 400; invalid JSON is 400", async () => {
    expect((await POST(new Request(url, { method: "POST" }), ctx)).status).toBe(200);
    expect((await post({ copyDraftData: "yes" })).status).toBe(400);
    expect((await POST(new Request(url, { method: "POST", body: "{" }), ctx)).status).toBe(400);
  });
});

describe("GET /api/projects/[id]/desktop", () => {
  it("GET 401 without session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await get()).status).toBe(401);
  });

  it("not installed: no desktopApp", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ desktopApp: null, updateAvailable: false, published: false });
  });

  it("GET updateAvailable flips after a source changes", async () => {
    await post({});
    const before = await (await get()).json();
    expect(before.desktopApp).toMatchObject({ id: "d1", releaseSha: "sha1" });
    expect(before.updateAvailable).toBe(false);

    files = { ...files, "/src/App.tsx": "export default () => 2" };
    expect((await (await get()).json()).updateAvailable).toBe(true);

    // Updating from the window runs the install again: the new release, the new fingerprint, no update left.
    sha = "sha2";
    expect((await post({})).status).toBe(200);
    const after = await (await get()).json();
    expect(after.desktopApp).toMatchObject({ id: "d1", releaseSha: "sha2" });
    expect(after.updateAvailable).toBe(false);
  });

  it("GET 404 for a non-owner", async () => {
    await post({});
    rol = "editor";
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});

describe("DELETE /api/projects/[id]/desktop", () => {
  it("DELETE 401 without session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await del()).status).toBe(401);
  });

  it("DELETE then GET shows no desktopApp", async () => {
    await post({});
    expect((await (await get()).json()).desktopApp).not.toBeNull();

    const res = await del();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(await (await get()).json()).toEqual({ desktopApp: null, updateAvailable: false, published: false });
  });

  it("DELETE 404 for a non-owner, and nothing is removed", async () => {
    await post({});
    rol = "editor";
    expect((await del()).status).toBe(404);
    expect(row?.removedAt).toBeNull();
  });
});
