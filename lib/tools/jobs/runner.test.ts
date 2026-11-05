// @vitest-environment node
//
// THE JOB RUNNER (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): it opens the tool project's box outside any
// Len turn (holder = the job's id), runs the job in /tmp as its own user, polls it, and on settlement delivers `out/`,
// reads `result.json`, pauses the box, releases it and charges the person the seconds it ran — on every path, never
// more than the most the confirmation showed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDriver } from "@/lib/agent/sandbox/fake-driver";

import {
  JOB_KILL_NOW,
  JOB_PREPARE_COMMAND,
  JOB_ROOT,
  JOB_USER,
  jobCleanupCommand,
  jobDir,
  jobKillCommand,
  jobPollCommand,
  POLL_MARK,
} from "./command";
import type { ToolJobRow } from "./store";
import type { ToolJobStatus } from "./types";

vi.mock("server-only", () => ({}));

const { JOB_NETWORK, runToolJob } = await import("./runner");

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

/** The box's side of the runner's commands, against the fake's files. */
function boxAnswers(o: { behave?: Behaviour; prepareExit?: number }) {
  return (command: string, f: Map<string, string>) => {
    const drop = (prefix: string) => {
      for (const p of [...f.keys()]) if (p.startsWith(prefix)) f.delete(p);
    };
    if (command === JOB_PREPARE_COMMAND) {
      drop(`${JOB_ROOT}/`);
      return { exitCode: o.prepareExit ?? 0 };
    }
    if (command.includes("launch.sh")) o.behave?.(f);
    if (command === jobKillCommand() || command === JOB_KILL_NOW) {
      if (!f.has(`${DIR}/exit`)) f.set(`${DIR}/exit`, "143");
    }
    if (command === jobCleanupCommand(ID)) drop(`${DIR}/`);
    if (command === jobPollCommand(ID)) {
      const last = (f.get(`${DIR}/progress`) ?? "").split("\n").filter(Boolean).at(-1) ?? "";
      return { stdout: `${last}\n${POLL_MARK}\n${f.get(`${DIR}/exit`) ?? ""}` };
    }
    const tail = /^tail -c (\d+) '([^']+)'/.exec(command);
    if (tail) return { stdout: (f.get(tail[2]!) ?? "").slice(-Number(tail[1])) };
    return undefined;
  };
}

function setup(
  o: {
    behave?: Behaviour;
    held?: boolean;
    maxMinutes?: number;
    status?: () => ToolJobStatus;
    prepareExit?: number;
    boxRow?: { sandboxId: string | null; template: string | null; syncedManifest: Record<string, string> } | null;
    files?: Record<string, string>;
  } = {},
) {
  let clock = 1_000_000;
  const driver = fakeDriver({ onRun: boxAnswers(o) });
  let settled: { status: string; set: Record<string, unknown> } | null = null;
  const flushes: Array<() => Promise<void>> = [];
  const d = {
    onExit: vi.fn((flush: () => Promise<void>) => {
      flushes.push(flush);
      return () => void flushes.splice(flushes.indexOf(flush), 1);
    }),
    driver,
    template: "openlen-terminal-v5",
    hold: vi.fn(async () => !o.held),
    release: vi.fn(async () => {}),
    boxRow: vi.fn(async () => o.boxRow ?? null),
    saveBox: vi.fn(async (_row: { sandboxId: string; syncedManifest: Record<string, string>; state: string }) => {}),
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
  const files = o.files ?? { "/jobs/pdf.py": "print('pdf')" };
  const run = () => runToolJob(job(), { files, maxMinutes: o.maxMinutes ?? 10, script: Object.keys(files).find((p) => p.startsWith("/jobs/") && /\.(py|mjs)$/.test(p)) ?? "/jobs/pdf.py" }, d);
  return { d, driver, run, settled: () => settled, flushes };
}

const box = (s: ReturnType<typeof setup>, id = "fake-1") => s.driver.files(id);

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
    expect(s.driver.commands("fake-1")).toContain(jobCleanupCommand(ID));
  });

  it("🔴 the job runs as its own user, after the box is prepared for it, never as the box's user (C4)", async () => {
    let launch = "";
    const s: ReturnType<typeof setup> = setup({
      behave: (f) => {
        launch = f.get(`${DIR}/launch.sh`) ?? "";
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    const commands = s.driver.commands("fake-1");
    expect(commands[0]).toBe(JOB_PREPARE_COMMAND);
    expect(commands.indexOf(`chmod -R a+rwX '${DIR}'`)).toBeGreaterThan(0);
    expect(commands.indexOf(`chmod -R a+rwX '${DIR}'`)).toBeLessThan(commands.findIndex((c) => c.includes("launch.sh")));
    expect(launch).toContain(`sudo -n -u ${JOB_USER} bash run.sh`);
  });

  it("a box that can't make the job's user: failed, nothing launched, still paused, released and charged", async () => {
    const s = setup({ prepareExit: 1, behave: () => {} });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed", set: { detail: "box_error" } });
    expect(s.driver.commands("fake-1").some((c) => c.includes("launch.sh"))).toBe(false);
    expect(s.driver.paused("fake-1")).toBe(true);
    expect(s.d.release).toHaveBeenCalled();
  });

  it("🔴 a new box starts from an empty manifest, never the old box's (C2)", async () => {
    const s = setup({
      boxRow: { sandboxId: "fake-old", template: "openlen-terminal-v4", syncedManifest: { "/src/App.tsx": "abc", "/package.json": "def" } },
      behave: (f) => f.set(`${DIR}/exit`, "0"),
    });
    await s.run();
    const saved = s.d.saveBox.mock.calls.map((c) => c[0]);
    expect(saved.length).toBeGreaterThan(0);
    for (const row of saved) {
      expect(row.sandboxId).toBe("fake-1");
      expect(row.syncedManifest).toEqual({});
    }
  });

  it("🔴 a box that can't be resumed is replaced by a new one, and the job runs (I4)", async () => {
    const s = setup({
      boxRow: { sandboxId: "fake-gone", template: "openlen-terminal-v5", syncedManifest: { "/src/App.tsx": "abc" } },
      behave: (f) => f.set(`${DIR}/exit`, "0"),
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "completed" });
    expect(s.d.saveBox.mock.calls.every((c) => c[0].sandboxId === "fake-1" && Object.keys(c[0].syncedManifest).length === 0)).toBe(true);
  });

  it("🔴 a resumed box gets the job's closed network, not the one Len's last turn left (C3)", async () => {
    const driverBox = setup({ behave: (f) => f.set(`${DIR}/exit`, "0") });
    // A Len turn opened the box with the tool's backend and canvas hosts.
    const opened = await driverBox.driver.create({ template: "openlen-terminal-v5", metadata: {}, network: { hosts: ["ref.backend.example"], headers: { "x-openlen-caja": "m" } } });
    await opened.pause();
    const s = setup({ boxRow: { sandboxId: opened.id, template: "openlen-terminal-v5", syncedManifest: { "/src/App.tsx": "abc" } }, behave: (f) => f.set(`${DIR}/exit`, "0") });
    // The same fake for both: reuse the first driver.
    Object.assign(s.d, { driver: driverBox.driver });
    await s.run();
    expect(driverBox.driver.networkOf(opened.id)).toEqual(JOB_NETWORK);
    expect(JOB_NETWORK).toEqual({ hosts: [], headers: {} });
    expect(s.d.saveBox.mock.calls[0]![0].syncedManifest).toEqual({ "/src/App.tsx": "abc" });
  });

  it("a new box opens with the job's closed network too", async () => {
    const s = setup({ behave: (f) => f.set(`${DIR}/exit`, "0") });
    await s.run();
    expect(s.driver.networkOf("fake-1")).toEqual(JOB_NETWORK);
  });

  it("a script that fails: failed, with the end of its stderr — read as a tail, never whole", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/stderr`, `${"noise\n".repeat(10_000)}Traceback ...\nValueError: no photos\n`);
        f.set(`${DIR}/exit`, "3");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed" });
    const detail = String((s.settled()!.set as { detail: string }).detail);
    expect(detail).toContain("ValueError: no photos");
    expect(detail.length).toBeLessThan(2_100);
    expect(s.driver.reads("fake-1")).not.toContain(`${DIR}/stderr`);
  });

  it("🔴 the progress is the poll's last line: the progress file is never read whole (I3)", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/progress`, `${"x\n".repeat(50_000)}99%\n`);
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.d.setProgress).toHaveBeenCalledWith(ID, "99%");
    expect(s.driver.reads("fake-1")).not.toContain(`${DIR}/progress`);
  });

  it("🔴 past its minutes: killed with detail timeout, charged at most its ceiling — what the confirmation showed (I1)", async () => {
    const s = setup({ maxMinutes: 1 });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "killed", set: { detail: "timeout" } });
    expect(s.driver.commands("fake-1")).toContain(jobKillCommand());
    const seconds = (s.settled()!.set as { seconds: number }).seconds;
    expect(seconds).toBe(60 + 120);
    expect(s.d.charge).toHaveBeenCalledWith(expect.objectContaining({ seconds: 180 }));
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

  it("a result.json over 64 KB, or not JSON: no result, and the detail says why — and a big one is never read", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/result.json`, JSON.stringify({ x: "y".repeat(70_000) }));
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "completed", set: { result: null, detail: "result_too_large" } });
    expect(s.driver.reads("fake-1")).not.toContain(`${DIR}/result.json`);
  });

  it("🔴 an out/ file over 20 MB is never read, and the detail names it (I2, I3)", async () => {
    let s!: ReturnType<typeof setup>;
    s = setup({
      behave: (f) => {
        f.set(`${DIR}/out/small.txt`, "ok");
        f.set(`${DIR}/out/big.mp4`, "x");
        s.driver.bytesOf("fake-1").set(`${DIR}/out/big.mp4`, new Uint8Array(20 * 1024 * 1024 + 1));
        f.set(`${DIR}/exit`, "0");
      },
    });
    await s.run();
    expect(s.d.deliver).toHaveBeenCalledTimes(1);
    expect(s.d.deliver).toHaveBeenCalledWith(expect.objectContaining({ name: "small.txt" }));
    expect(String((s.settled()!.set as { detail: string }).detail)).toContain("big.mp4");
  });

  it("🔴 a Node job installs /jobs's own package, never the app's /package.json (I5)", async () => {
    const run = async (files: Record<string, string>) => {
      let script = "";
      const s: ReturnType<typeof setup> = setup({
        files,
        behave: (f) => {
          script = f.get(`${DIR}/run.sh`) ?? "";
          f.set(`${DIR}/exit`, "0");
        },
      });
      await s.run();
      return script;
    };
    const app = { "/package.json": JSON.stringify({ dependencies: { react: "18" } }), "/package-lock.json": "{}" };
    expect(await run({ ...app, "/jobs/zip.mjs": "1" })).not.toMatch(/npm /);
    expect(await run({ ...app, "/jobs/zip.mjs": "1", "/jobs/package.json": JSON.stringify({ dependencies: { archiver: "7" } }) })).toMatch(/cd jobs && npm install/);
    expect(
      await run({ ...app, "/jobs/zip.mjs": "1", "/jobs/package.json": JSON.stringify({ dependencies: { archiver: "7" } }), "/jobs/package-lock.json": "{}" }),
    ).toMatch(/cd jobs && npm ci/);
    expect(await run({ "/jobs/pdf.py": "1", "/jobs/requirements.txt": "reportlab" })).toMatch(/pip install --user --quiet -r 'jobs\/requirements\.txt'/);
  });

  it("the driver throwing still pauses, releases and charges; the job fails", async () => {
    const s = setup({
      behave: () => {
        throw new Error("box died");
      },
    });
    await s.run();
    expect(s.settled()).toMatchObject({ status: "failed" });
    expect(s.d.release).toHaveBeenCalled();
    expect(s.d.charge).toHaveBeenCalled();
  });

  it("🔴 a deploy's exit while it runs: killed in the box, the box paused and released, the seconds charged, failed «stopped_by_restart» — once", async () => {
    let s!: ReturnType<typeof setup>;
    let exited = false;
    s = setup({
      status: () => {
        // The signal arrives mid-run: the exit flush runs while the runner still polls.
        if (!exited && s.flushes.length > 0) {
          exited = true;
          void s.flushes[0]!();
        }
        return "running";
      },
      behave: () => {},
      maxMinutes: 1,
    });
    await s.run();
    expect(s.d.settle).toHaveBeenCalledTimes(1);
    expect(s.settled()).toMatchObject({ status: "failed", set: { detail: "stopped_by_restart" } });
    expect(s.d.release).toHaveBeenCalledTimes(1);
    expect(s.d.charge).toHaveBeenCalledTimes(1);
    expect(s.driver.commands("fake-1")).toContain(JOB_KILL_NOW);
    expect(s.flushes).toEqual([]);
  });

  it("a job that ends on its own lets go of its exit flush", async () => {
    const s = setup({ behave: (f) => f.set(`${DIR}/exit`, "0") });
    await s.run();
    expect(s.d.onExit).toHaveBeenCalledTimes(1);
    expect(s.flushes).toEqual([]);
  });

  it("🔴 a delivery that fails never turns a finished job into a box error: it stays completed and the detail names the file (real check)", async () => {
    const s = setup({
      behave: (f) => {
        f.set(`${DIR}/out/fotos.pdf`, "%PDF-1.4");
        f.set(`${DIR}/result.json`, JSON.stringify({ pages: 2 }));
        f.set(`${DIR}/exit`, "0");
      },
    });
    s.d.deliver.mockRejectedValueOnce(new Error("no_store"));
    await s.run();
    expect(s.settled()).toMatchObject({ status: "completed", set: { result: { pages: 2 }, delivered: [] } });
    expect(String((s.settled()!.set as { detail: string }).detail)).toContain("fotos.pdf");
    expect(s.driver.paused("fake-1")).toBe(true);
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
