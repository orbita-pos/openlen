// @vitest-environment node
//
// /api/tools/jobs (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): start (POST) and list (GET), one job
// (GET [id]) and its cancel (POST [id]/cancel) — the browser session only, the caller resolved like the bridge's, each
// refusal with its status.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/movil/llaves", () => ({ usuarioDeLaLlave: vi.fn(async (k: string) => (k === "phone-key-0123456789abcdef" ? "u1" : null)) }));
vi.mock("@/lib/tools/bridge/caller", () => ({ resolveBridgeCaller: vi.fn() }));
vi.mock("@/lib/tools/jobs/start", () => ({
  startToolJob: vi.fn(),
  realStartDeps: vi.fn(async () => ({})),
  listToolJobs: vi.fn(async () => [{ id: "job-new" }, { id: "job-old" }]),
  toolJobView: vi.fn(async (id: string) => (id === "job-mine" ? { id, status: "running" } : null)),
  cancelToolJob: vi.fn(async (id: string) => (id === "job-mine" ? { id, status: "stopping" } : null)),
  describeToolJob: vi.fn(async (_c: unknown, name: string) => (name === "export-video" ? { name, title: "Exportar", maxMinutes: 10, mostCentis: 332 } : null)),
}));

const { auth } = await import("@/auth");
const { resolveBridgeCaller } = await import("@/lib/tools/bridge/caller");
const start = await import("@/lib/tools/jobs/start");
const jobs = await import("./route");
const one = await import("./[id]/route");
const cancel = await import("./[id]/cancel/route");
const declared = await import("./declared/route");

const caller = { personId: "u1", personEmail: "a@b.c", locale: "es", timeZone: "UTC", mode: "installed", installation: { id: "inst-1", projectId: "tool-1" } };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postJson = (body: unknown) => new Request("http://x/api/tools/jobs", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
  vi.mocked(resolveBridgeCaller).mockResolvedValue({ caller } as never);
});

// Phase 5 (§4.14): the phone app starts and follows a tool's jobs with its key, after drawing the confirmation itself.
describe("the jobs routes with the phone's key", () => {
  const withKey = (url: string, init: RequestInit = {}, key = "phone-key-0123456789abcdef") =>
    new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${key}`, origin: "https://localhost" } });

  it("a job starts as that person, with the app's CORS", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    vi.mocked(start.startToolJob).mockResolvedValue({ ok: true, job: { id: "job-1", status: "running" } as never });
    const res = await jobs.POST(withKey("http://x/api/tools/jobs", { method: "POST", body: JSON.stringify({ installationId: "inst-1", name: "export-video" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(resolveBridgeCaller).toHaveBeenCalledWith("u1", expect.anything());
  });

  it("one job, its cancel and the declaration too", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await one.GET(withKey("http://x/api/tools/jobs/job-mine?installationId=inst-1"), ctx("job-mine"))).status).toBe(200);
    expect((await cancel.POST(withKey("http://x/api/tools/jobs/job-mine/cancel", { method: "POST", body: JSON.stringify({ installationId: "inst-1" }) }), ctx("job-mine"))).status).toBe(200);
    expect((await declared.GET(withKey("http://x/api/tools/jobs/declared?installationId=inst-1&name=export-video"))).status).toBe(200);
  });

  it("a key that doesn't resolve: 401", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({ user: { id: "u1" } });
    expect((await jobs.GET(withKey("http://x/api/tools/jobs?installationId=inst-1", {}, "not-a-key-0123456789abcdef"))).status).toBe(401);
  });
});

describe("POST /api/tools/jobs", () => {
  it("starts the job as the person and answers its view", async () => {
    vi.mocked(start.startToolJob).mockResolvedValue({ ok: true, job: { id: "job-1", status: "running" } as never });
    const res = await jobs.POST(postJson({ installationId: "inst-1", name: "export-video", input: { q: 1 }, uploads: ["up-1"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ job: { id: "job-1", status: "running" } });
    expect(start.startToolJob).toHaveBeenCalledWith(caller, { name: "export-video", input: { q: 1 }, uploads: ["up-1"] }, {});
  });

  const statuses: Array<[string, number]> = [
    ["unknown_job", 404],
    ["bad_input", 400],
    ["bad_upload", 400],
    ["plan_required", 402],
    ["no_credits", 402],
    ["busy", 409],
    ["budget", 429],
    ["sandbox_off", 503],
  ];
  for (const [reason, status] of statuses) {
    it(`${reason} → ${status}`, async () => {
      vi.mocked(start.startToolJob).mockResolvedValue({ ok: false, reason: reason as never });
      const res = await jobs.POST(postJson({ installationId: "inst-1", name: "x" }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: reason });
    });
  }

  it("without a browser session (a phone key alone): 401, nothing started", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await jobs.POST(postJson({ installationId: "inst-1", name: "x" }))).status).toBe(401);
    expect((await jobs.GET(new Request("http://x/api/tools/jobs?installationId=inst-1"))).status).toBe(401);
    expect((await one.GET(new Request("http://x/api/tools/jobs/job-mine?installationId=inst-1"), ctx("job-mine"))).status).toBe(401);
    expect((await cancel.POST(postJson({ installationId: "inst-1" }), ctx("job-mine"))).status).toBe(401);
    expect(start.startToolJob).not.toHaveBeenCalled();
    expect(start.cancelToolJob).not.toHaveBeenCalled();
  });

  it("the caller refused: its answer", async () => {
    vi.mocked(resolveBridgeCaller).mockResolvedValue({ status: 402, body: { error: "plan_required" } });
    expect((await jobs.POST(postJson({ installationId: "inst-1", name: "x" }))).status).toBe(402);
    expect(start.startToolJob).not.toHaveBeenCalled();
  });
});

describe("following and stopping", () => {
  it("GET lists the person's jobs of the tool the query names", async () => {
    const res = await jobs.GET(new Request("http://x/api/tools/jobs?installationId=inst-1&locale=es"));
    expect(await res.json()).toEqual({ jobs: [{ id: "job-new" }, { id: "job-old" }] });
    expect(resolveBridgeCaller).toHaveBeenCalledWith("u1", expect.objectContaining({ installationId: "inst-1", locale: "es" }));
    expect(start.listToolJobs).toHaveBeenCalledWith("u1", "tool-1");
  });

  it("one job: the person's own of that tool, or 404", async () => {
    expect(await (await one.GET(new Request("http://x/api/tools/jobs/job-mine?installationId=inst-1"), ctx("job-mine"))).json()).toEqual({ job: { id: "job-mine", status: "running" } });
    expect(start.toolJobView).toHaveBeenCalledWith("job-mine", "u1", "tool-1");
    expect((await one.GET(new Request("http://x/api/tools/jobs/job-theirs?installationId=inst-1"), ctx("job-theirs"))).status).toBe(404);
  });

  it("cancel answers the job stopping, or 404", async () => {
    expect(await (await cancel.POST(postJson({ installationId: "inst-1" }), ctx("job-mine"))).json()).toEqual({ job: { id: "job-mine", status: "stopping" } });
    expect(start.cancelToolJob).toHaveBeenCalledWith("job-mine", "u1", "tool-1");
    expect((await cancel.POST(postJson({ installationId: "inst-1" }), ctx("job-theirs"))).status).toBe(404);
  });
});

describe("GET /api/tools/jobs/declared", () => {
  it("what the confirmation shows, from the version's declaration; an undeclared job is 404", async () => {
    const res = await declared.GET(new Request("http://x/api/tools/jobs/declared?installationId=inst-1&name=export-video"));
    expect(await res.json()).toEqual({ job: { name: "export-video", title: "Exportar", maxMinutes: 10, mostCentis: 332 } });
    expect((await declared.GET(new Request("http://x/api/tools/jobs/declared?installationId=inst-1&name=nope"))).status).toBe(404);
  });
});
