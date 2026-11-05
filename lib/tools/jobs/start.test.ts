// @vitest-environment node
//
// STARTING, FOLLOWING AND STOPPING A JOB (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): the refusals in
// their order — none leaves a row or calls the runner —, an accepted start, and DeepSeek's owner scope (another
// person's job, or another tool's, is not found).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("./store", () => ({
  toJobView: (r: Record<string, unknown>) => ({ id: r.id, name: r.name, title: r.title, status: r.status }),
  jobById: async (id: string) => rows.get(id) ?? null,
  jobsOf: async (personId: string, toolProjectId: string) =>
    [...rows.values()].filter((r) => r.personId === personId && r.toolProjectId === toolProjectId).sort((a, b) => Number(b.startedAt) - Number(a.startedAt)),
  requestCancel: async (id: string) => {
    const r = rows.get(id);
    if (!r || r.status !== "running") return null;
    r.status = "stopping";
    return r;
  },
}));

const { cancelToolJob, jobMostCentis, listToolJobs, startToolJob, toolJobView } = await import("./start");
type Deps = Parameters<typeof startToolJob>[2];

const PKG = JSON.stringify({ openlen: { tool: { placement: "rail", jobs: { "export-video": { script: "./jobs/export.mjs", maxMinutes: 10 } } } } });
const version = {
  jobFiles: { "/package.json": PKG, "/jobs/export.mjs": "console.log(1)" },
  locales: { "/locale/en.json": JSON.stringify({ jobs: { "export-video": "Export the video" } }), "/locale/es.json": JSON.stringify({ jobs: { "export-video": "Exportar el vídeo" } }) },
};

const installed = {
  personId: "u1",
  personEmail: "a@b.c",
  locale: "es",
  timeZone: "UTC",
  mode: "installed" as const,
  installation: { id: "inst-1", projectId: "tool-1", releaseSha: "sha-1" } as never,
};

function makeDeps() {
  const inserted: unknown[] = [];
  const runs: unknown[] = [];
  return {
    inserted,
    runs,
    version: vi.fn<Deps["version"]>(async () => version),
    uploadsOf: vi.fn<Deps["uploadsOf"]>(async (_p, ids) => ids.filter((id) => id.startsWith("up-mine")).map((id) => ({ id, name: `${id}.jpg`, size: 3 }))),
    plan: vi.fn<Deps["plan"]>(async () => "pro"),
    balance: vi.fn<Deps["balance"]>(async () => 100_000),
    sandbox: vi.fn<Deps["sandbox"]>(() => ({ apiKey: "k", template: "t", dailyUsd: 5, onlyUsers: null })),
    budgetOk: vi.fn<Deps["budgetOk"]>(async () => true),
    busy: vi.fn<Deps["busy"]>(async () => false),
    insert: vi.fn<Deps["insert"]>(async (row) => {
      inserted.push(row);
      const full = { ...row, status: "running", startedAt: new Date() };
      rows.set(row.id, full);
      return full as never;
    }),
    run: vi.fn<Deps["run"]>((job, o) => void runs.push({ job, o })),
    newId: () => "job-0123456789abcdef",
  };
}

let deps: ReturnType<typeof makeDeps>;
beforeEach(() => {
  rows.clear();
  deps = makeDeps();
});

const start = (o: Partial<{ name: string; input: unknown; uploads: unknown }> = {}) =>
  startToolJob(installed, { name: "export-video", input: { quality: "high" }, uploads: [], ...o }, deps);

describe("startToolJob", () => {
  it("an accepted start: the row as the person, the title in their language, and the runner once", async () => {
    const r = await start({ uploads: ["up-mine-1"] });
    expect(r).toEqual({ ok: true, job: { id: "job-0123456789abcdef", name: "export-video", title: "Exportar el vídeo", status: "running" } });
    expect(deps.inserted).toEqual([
      {
        id: "job-0123456789abcdef",
        personId: "u1",
        toolProjectId: "tool-1",
        installationId: "inst-1",
        releaseSha: "sha-1",
        name: "export-video",
        title: "Exportar el vídeo",
        input: { quality: "high" },
        uploads: [{ id: "up-mine-1", name: "up-mine-1.jpg", size: 3 }],
        maxSeconds: 10 * 60 + 120,
      },
    ]);
    expect(deps.runs).toEqual([{ job: expect.objectContaining({ id: "job-0123456789abcdef" }), o: { files: version.jobFiles, maxMinutes: 10, script: "/jobs/export.mjs" } }]);
  });

  it("the most it can cost: its minutes and the install allowance, in centicredits", () => {
    expect(jobMostCentis(10)).toBe(Math.ceil((10 * 60 + 120) * 0.000046 * 10_000));
  });

  const refusals: Array<[string, () => void, Partial<{ name: string; input: unknown; uploads: unknown }>]> = [
    ["unknown_job", () => {}, { name: "nope" }],
    ["bad_input", () => {}, { input: "x".repeat(16 * 1024) }],
    ["bad_upload", () => {}, { uploads: ["up-mine-1", "up-theirs"] }],
    ["plan_required", () => void deps.plan.mockResolvedValue("free"), {}],
    ["no_credits", () => void deps.balance.mockResolvedValue(jobMostCentis(10) - 1), {}],
    ["sandbox_off", () => void deps.sandbox.mockReturnValue(null), {}],
    ["budget", () => void deps.budgetOk.mockResolvedValue(false), {}],
    ["busy", () => void deps.busy.mockResolvedValue(true), {}],
  ];
  for (const [reason, arrange, o] of refusals) {
    it(`refuses ${reason} with no row and no runner`, async () => {
      arrange();
      expect(await start(o)).toEqual({ ok: false, reason });
      expect(deps.inserted).toEqual([]);
      expect(deps.runs).toEqual([]);
    });
  }

  it("the refusals come in their order: an unknown job is told before a free plan", async () => {
    deps.plan.mockResolvedValue("free");
    deps.balance.mockResolvedValue(0);
    expect(await start({ name: "nope" })).toEqual({ ok: false, reason: "unknown_job" });
    expect(await start()).toEqual({ ok: false, reason: "plan_required" });
  });

  it("a rollout that leaves the person out is the box being off for them", async () => {
    deps.sandbox.mockReturnValue({ apiKey: "k", template: "t", dailyUsd: 5, onlyUsers: ["someone-else"] });
    expect(await start()).toEqual({ ok: false, reason: "sandbox_off" });
  });

  it("a declared job whose script is not in the version is unknown", async () => {
    deps.version.mockResolvedValue({ jobFiles: { "/package.json": PKG }, locales: version.locales });
    expect(await start()).toEqual({ ok: false, reason: "unknown_job" });
  });

  it("uploads must be a list of ids, at most 8", async () => {
    expect(await start({ uploads: "up-mine-1" })).toEqual({ ok: false, reason: "bad_upload" });
    expect(await start({ uploads: Array.from({ length: 9 }, (_, i) => `up-mine-${i}`) })).toEqual({ ok: false, reason: "bad_upload" });
  });
});

describe("following and stopping", () => {
  const row = (id: string, personId: string, toolProjectId: string, startedAt: number) =>
    rows.set(id, { id, personId, toolProjectId, name: "export-video", title: "T", status: "running", startedAt });

  it("another person's job, or another tool's, is not found", async () => {
    row("job-a", "u2", "tool-1", 1);
    row("job-b", "u1", "tool-2", 1);
    expect(await toolJobView("job-a", "u1", "tool-1")).toBeNull();
    expect(await toolJobView("job-b", "u1", "tool-1")).toBeNull();
    expect(await cancelToolJob("job-a", "u1", "tool-1")).toBeNull();
  });

  it("cancel moves running to stopping, and asking again changes nothing", async () => {
    row("job-a", "u1", "tool-1", 1);
    expect(await cancelToolJob("job-a", "u1", "tool-1")).toMatchObject({ status: "stopping" });
    expect(await cancelToolJob("job-a", "u1", "tool-1")).toMatchObject({ status: "stopping" });
  });

  it("the list is the person's for that tool, newest first", async () => {
    row("job-old", "u1", "tool-1", 1);
    row("job-new", "u1", "tool-1", 2);
    row("job-other", "u2", "tool-1", 3);
    expect((await listToolJobs("u1", "tool-1")).map((j) => j.id)).toEqual(["job-new", "job-old"]);
  });
});

describe("describeToolJob", () => {
  it("what OpenLen's confirmation shows comes from the declaration: its title, minutes and most credits", async () => {
    const { describeToolJob } = await import("./start");
    expect(await describeToolJob(installed, "export-video", deps)).toEqual({ name: "export-video", title: "Exportar el vídeo", maxMinutes: 10, mostCentis: jobMostCentis(10) });
    expect(await describeToolJob(installed, "nope", deps)).toBeNull();
  });
});
