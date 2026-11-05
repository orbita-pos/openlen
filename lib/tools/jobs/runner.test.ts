// @vitest-environment node
//
// THE JOB RUNNER (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): it opens the tool project's box outside any
// Len turn (holder = the job's id), runs the job in /tmp, polls it, and on settlement delivers `out/`, reads
// `result.json`, pauses the box, releases it and charges the person the seconds it ran — on every path.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDriver } from "@/lib/agent/sandbox/fake-driver";

import { jobDir } from "./command";
import type { ToolJobRow } from "./store";
import type { ToolJobStatus } from "./types";

vi.mock("server-only", () => ({}));

const { runToolJob } = await import("./runner");

const ID = "job-0123456789abcdef";
const DIR = jobDir(ID);

const job = (over: Partial<ToolJobRow> = {}): ToolJobRow =>
  ({
    id: ID,
    personId: "u1",
    toolProjectId: "tool-1",
    installationId: "inst-1",
    releaseSha: "sha-1",
    name: "pdf",
    title: "Hacer el PDF",
    status: "running",
    progress: null,
    detail: null,
    input: { size: "A4" },
    uploads: [{ id: "up-1", name: "foto.jpg", size: 3 }],
    result: null,
    delivered: [],
    startedAt: new Date(),
    finishedAt: null,
    seconds: 0,
    chargedCentis: 0,
    ...over,
  }) as ToolJobRow;

type Behaviour = (files: Map<string, string>) => void;

function setup(o: { behave?: Behaviour; held?: boolean; maxMinutes?: number; status?: () => ToolJobStatus } = {}) {
  let clock = 1_000_000;
  const driver = fakeDriver({
    onRun: (command, files) => {
      if (command.includes("launch.sh")) o.behave?.(files);
      if (command.startsWith("kill ")) files.set(`${DIR}/exit`, "143");
    },
  });
  let settled: { status: string; set: Record<string, unknown> } | null = null;
  const d = {
    driver,
    template: "openlen-terminal-v5",
    hold: vi.fn(async () => !o.held),
    release: vi.fn(async () => {}),
    boxRow: vi.fn(async () => null),
    saveBox: vi.fn(async () => {}),
    jobStatus: vi.fn(async () => (o.status ? o.status() : "running") as ToolJobStatus),
    setProgress: vi.fn(async () => {}),
    settle: vi.fn(async (_id: string, status: string, set: Record<string, unknown>) => {
      settled = { status, set };
      return null;
    }),
    blob: vi.fn(async () => new Uint8Array([1, 2, 3])),
    upload: vi.fn(async () => ({ name: "foto.jpg", bytes: new Uint8Array([9, 9, 9]) })),
    deliver: vi.fn(async (x: { name: string }) => ({ url: `/api/projects/tool-1/deliveries/${ID}/abcd1234-${x.name}` })),
    charge: vi.fn(async (x: { seconds: number }) => x.seconds),
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
    log: () => {},
  };
  const files = { "/jobs/pdf.py": "print('pdf')" };
  const run = () => runToolJob(job(), { files, maxMinutes: o.maxMinutes ?? 10, script: "/jobs/pdf.py" }, d);
  return { d, driver, run, settled: () => settled };
}

const box = (s: ReturnType<typeof setup>) => s.driver.files("fake-1");

beforeEach(() => vi.clearAllMocks());

describe("runToolJob", () => {
  it("completed: out/ delivered, result.json read, the box paused and released, the seconds charged", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/progress`, "1 of 2\n2 of 2\n");
        f.set(`${DIR}/out/fotos.pdf`, "%PDF-1.4");
        f.set(`${DIR}/result.json`, JSON.stringify({ pages: 2 }));
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "completed", set: { result: { pages: 2 }, delivered: [{ name: "fotos.pdf", size: 8 }] } });
    expect(s.d.deliver).toHaveBeenCalledWith(expect.objectContaining({ toolProjectId: "tool-1", jobId: ID, name: "fotos.pdf", contentType: "application/pdf" }));
    expect(s.d.setProgress).toHaveBeenCalledWith(ID, "2 of 2");
    expect(s.driver.paused("fake-1")).toBe(true);
    expect(s.d.release).toHaveBeenCalledWith("tool-1", ID);
    expect(s.d.charge).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", projectId: "tool-1", turnId: ID }));
    expect((s.settled()!.set as { seconds: number }).seconds).toBeGreaterThan(0);
  });

  it("writes only under its own folder in /tmp: the version's files, the input and the picked files; the folder goes after", async () => {
    let text = new Map<string, string>();
    let bytes = new Map<string, Uint8Array>();
    const s: ReturnType<typeof setup> = setup({
      behave: (f) => {
        text = new Map(f);
        bytes = new Map(s.driver.bytesOf("fake-1"));
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect([...text.keys(), ...bytes.keys()].every((p) => p.startsWith(`${DIR}/`))).toBe(true);
    expect(text.get(`${DIR}/app/jobs/pdf.py`)).toBe("print('pdf')");
    expect(JSON.parse(text.get(`${DIR}/input.json`) ?? "null")).toEqual({ size: "A4" });
    expect(bytes.get(`${DIR}/files/foto.jpg`)).toEqual(new Uint8Array([9, 9, 9]));
    expect([...box(s).keys()].filter((p) => p.startsWith(`${DIR}/`))).toEqual([]);
  });

  it("the box opens without the project's OpenLen hosts: a job never reaches the tool's backend", async () => {
    const s = setup({ behave: (f) => f.set(`${DIR}/exit`, "0") });
    await s.run();
    expect(s.driver.networkOf("fake-1")).toBeNull();
  });

  it("a script that fails: failed, with the end of its stderr", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/stderr`, "Traceback ...\nValueError: no photos\n");
        f.set(`${DIR}/exit`, "3");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed" });
    expect(String((s.settled()!.set as { detail: string }).detail)).toContain("ValueError: no photos");
  });

  it("🔴 past its minutes: killed with detail timeout, charged only up to then", async () => {
    const s = setup({ maxMinutes: 1 });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "killed", set: { detail: "timeout" } });
    expect(s.driver.commands("fake-1").some((c) => c.startsWith("kill "))).toBe(true);
    const seconds = (s.settled()!.set as { seconds: number }).seconds;
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThan(60 + 120 + 30);
    expect(s.driver.paused("fake-1")).toBe(true);
  });

  it("asked to stop: killed with detail cancelled", async () => {
    let polls = 0;
    const s = setup({ status: () => (++polls > 2 ? "stopping" : "running") });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "killed", set: { detail: "cancelled" } });
  });

  it("the box held by a Len turn: failed busy, nothing opened, nothing charged", async () => {
    const s = setup({ held: true });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed", set: { detail: "busy" } });
    expect(s.d.charge).not.toHaveBeenCalled();
    expect(s.d.release).not.toHaveBeenCalled();
  });

  it("a result.json over 64 KB, or not JSON: no result, and the detail says why", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/result.json`, JSON.stringify({ x: "y".repeat(70_000) }));
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "completed", set: { result: null, detail: "result_too_large" } });
  });

  it("the driver throwing still pauses, releases and charges; the job fails", async () => {
    const s = setup({ behave: () => { throw new Error("box died"); } });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed" });
    expect(s.d.release).toHaveBeenCalled();
    expect(s.d.charge).toHaveBeenCalled();
  });

  it("at most four files are delivered", async () => {
    const s = setup({
      behave: (f) => {
        for (const n of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) f.set(`${DIR}/out/${n}`, n);
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.d.deliver).toHaveBeenCalledTimes(4);
  });
});
