import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureIdleSummaryJob, idleSummaryCaptureFile } from "./idle-summary-capture";
import type { IdleSummaryJobInput } from "./idle-summary-job";

const INPUT: IdleSummaryJobInput = {
  key: "p1:assistant:a1",
  messages: [
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "hola" },
    { role: "assistant", content: "listo" },
  ],
  transcriptLength: 1,
  minTokens: 1,
  projectId: "p1",
  conversation: "assistant:a1",
  rowId: "row-1",
  ownerId: "u1",
  memberId: null,
  rate: "agent" as IdleSummaryJobInput["rate"],
  planActive: false,
  provider: "deepinfra",
  model: "some-model",
  brain: { tools: [{ name: "Read" }], requestId: "p1", esfuerzoDelTurno: null, esfuerzoDelUsuario: null },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "idle-capture-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the idle summary's job, written to a file for the return bench", () => {
  it("without the folder it does nothing, and the route arms the timer as always", () => {
    expect(captureIdleSummaryJob(INPUT, {})).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("with the folder, the job's plain values are in a file named after its conversation, and it says it took it", () => {
    expect(captureIdleSummaryJob(INPUT, { OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: dir })).toBe(true);
    const file = idleSummaryCaptureFile(dir, INPUT.key);
    expect(path.basename(file)).toBe("p1_assistant_a1.json");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(INPUT)));
  });

  it("the next turn of the conversation replaces it: the last one is what a return finds", () => {
    captureIdleSummaryJob(INPUT, { OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: dir });
    captureIdleSummaryJob({ ...INPUT, rowId: "row-2" }, { OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: dir });
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(idleSummaryCaptureFile(dir, INPUT.key), "utf8")).rowId).toBe("row-2");
  });

  it("🔴 never in production: the folder is ignored, said once, and the timer is armed as always", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: dir, NODE_ENV: "production" };
    expect(captureIdleSummaryJob(INPUT, env)).toBe(false);
    expect(captureIdleSummaryJob(INPUT, env)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("OPENLEN_IDLE_SUMMARY_CAPTURE_DIR"))).toHaveLength(1);
  });

  it("a folder that cannot be written still means «do not arm»: whoever set it wants no timers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const file = path.join(dir, "not-a-folder");
    fs.writeFileSync(file, "x");
    expect(captureIdleSummaryJob(INPUT, { OPENLEN_IDLE_SUMMARY_CAPTURE_DIR: file })).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
