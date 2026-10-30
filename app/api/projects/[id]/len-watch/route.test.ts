// @vitest-environment node
// Len Watch's API for one project (spec local 2026-10-30-len-watch, §5.7): the state and the switches
// (only the owner changes them), «Fix with Len» and Approve — for the web and for Len mobile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: vi.fn() }));
vi.mock("@/lib/len-watch/store", () => ({ getSettings: vi.fn(), saveSettings: vi.fn(), activeIncident: vi.fn() }));
vi.mock("@/lib/len-watch/owner", () => ({ projectForWatch: vi.fn() }));
vi.mock("@/lib/len-watch/orchestrate", () => ({ startFix: vi.fn(async () => undefined), approveFix: vi.fn(), recoverIfStale: vi.fn(async (i: unknown) => i) }));

import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { activeIncident, getSettings, saveSettings } from "@/lib/len-watch/store";
import { projectForWatch } from "@/lib/len-watch/owner";
import { approveFix, recoverIfStale, startFix } from "@/lib/len-watch/orchestrate";
import type { Incident } from "@/lib/len-watch/types";

import { GET, PUT } from "./route";
import { POST as FIX } from "./fix/route";
import { POST as APPROVE } from "./approve/route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const SETTINGS = { autoFix: false, autoPublish: false, muted: false, locale: null };
const PROJECT = { projectId: "p1", ownerId: "owner", title: "Holi", subdomain: "holi", url: "https://holi.openlen.app", locale: "es", timeZone: "UTC" };
const now = new Date("2026-10-30T12:00:00Z");
const incident = (status: Incident["status"]): Incident => ({ id: "i1", projectId: "p1", status, sample: { message: "boom", file: null, line: null, col: null, page: null }, reports: 3, summary: "Arreglado.", reason: null, shipsUnpublished: false, turnRowId: "row-1", createdAt: now, updatedAt: now, resolvedAt: null, resolution: null, fixStamp: null, copyProjectId: null, branch: null, base: null, bringState: null });

const req = (method: string, body?: unknown) => new Request("https://openlen.com/api/projects/p1/len-watch", { method, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(usuarioDeLaPeticion).mockResolvedValue("owner");
  vi.mocked(exigirAcceso).mockResolvedValue({ rol: "dueno", duenoId: "owner" });
  vi.mocked(getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(saveSettings).mockImplementation(async (_p, patch) => ({ ...SETTINGS, ...patch }));
  vi.mocked(activeIncident).mockResolvedValue(null);
  vi.mocked(projectForWatch).mockResolvedValue(PROJECT);
});

afterEach(() => {
  delete process.env.OPENLEN_WATCH;
});

describe("GET", () => {
  it("the switches and the incident, for whoever can see the project", async () => {
    vi.mocked(activeIncident).mockResolvedValue(incident("fix_ready"));
    const res = await GET(req("GET"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      isOwner: true,
      settings: SETTINGS,
      incident: { id: "i1", status: "fix_ready", reason: null, summary: "Arreglado.", shipsUnpublished: false, createdAt: now.toISOString() },
    });
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "owner", "ver");
  });

  it("401 without a session, 404 with Len Watch off", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValueOnce(null);
    expect((await GET(req("GET"), ctx)).status).toBe(401);
    process.env.OPENLEN_WATCH = "0";
    expect((await GET(req("GET"), ctx)).status).toBe(404);
  });
});

describe("PUT", () => {
  it("the owner changes the switches", async () => {
    const res = await PUT(req("PUT", { autoFix: true, locale: "es" }), ctx);
    expect(res.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledWith("p1", { autoFix: true, locale: "es" });
    expect(await res.json()).toEqual({ settings: { ...SETTINGS, autoFix: true, locale: "es" } });
  });

  it("an editor can't: it spends the owner's credits", async () => {
    vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" });
    expect((await PUT(req("PUT", { autoFix: true }), ctx)).status).toBe(403);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("a bad body is a 400", async () => {
    expect((await PUT(req("PUT", { autoFix: "yes" }), ctx)).status).toBe(400);
    expect((await PUT(req("PUT", { locale: "xx" }), ctx)).status).toBe(400);
  });
});

describe("POST fix", () => {
  it("starts Len on a down site", async () => {
    vi.mocked(activeIncident).mockResolvedValue(incident("needs_owner"));
    const res = await FIX(req("POST"), ctx);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "fixing" });
    expect(startFix).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }), PROJECT, undefined, { actorId: "owner" });
    expect(exigirAcceso).toHaveBeenCalledWith("p1", "owner", "editar");
  });

  it("an editor's press runs as the editor", async () => {
    vi.mocked(usuarioDeLaPeticion).mockResolvedValue("editor-1");
    vi.mocked(exigirAcceso).mockResolvedValue({ rol: "editor", duenoId: "owner" });
    vi.mocked(activeIncident).mockResolvedValue(incident("open"));
    expect((await FIX(req("POST"), ctx)).status).toBe(202);
    expect(startFix).toHaveBeenCalledWith(expect.anything(), PROJECT, undefined, { actorId: "editor-1" });
  });

  it("a fix cut by a restart is recovered first, so the owner can start it again", async () => {
    vi.mocked(activeIncident).mockResolvedValue(incident("fixing"));
    vi.mocked(recoverIfStale).mockImplementationOnce(async (i) => ({ ...i, status: "needs_owner", reason: "interrupted" }));
    expect((await FIX(req("POST"), ctx)).status).toBe(202);
    expect(startFix).toHaveBeenCalledWith(expect.objectContaining({ status: "needs_owner" }), PROJECT, undefined, { actorId: "owner" });
  });

  it("nothing to fix, or already at it: 409", async () => {
    expect(await (await FIX(req("POST"), ctx)).json()).toEqual({ error: "no_incident" });
    vi.mocked(activeIncident).mockResolvedValue(incident("fixing"));
    const res = await FIX(req("POST"), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(startFix).not.toHaveBeenCalled();
  });
});

describe("POST approve", () => {
  it("answers what publishing answered, a gate included", async () => {
    vi.mocked(activeIncident).mockResolvedValue(incident("fix_ready"));
    vi.mocked(approveFix).mockResolvedValue({ status: 428, body: { error: "security_findings" } });
    const res = await APPROVE(req("POST"), ctx);
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ error: "security_findings" });
  });

  it("passes on who approves and whether they confirmed what came after the fix", async () => {
    vi.mocked(activeIncident).mockResolvedValue(incident("fix_ready"));
    vi.mocked(approveFix).mockResolvedValue({ status: 200, body: {} });
    await APPROVE(req("POST", { confirmChanged: true }), ctx);
    expect(approveFix).toHaveBeenCalledWith(expect.anything(), PROJECT, undefined, { actorId: "owner", confirmChanged: true });
    await APPROVE(req("POST"), ctx);
    expect(approveFix).toHaveBeenLastCalledWith(expect.anything(), PROJECT, undefined, { actorId: "owner", confirmChanged: false });
  });

  it("no incident: 409", async () => {
    expect((await APPROVE(req("POST"), ctx)).status).toBe(409);
    expect(approveFix).not.toHaveBeenCalled();
  });
});
