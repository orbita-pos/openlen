// What a job runs in the box (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): its version's files under its
// own folder in /tmp — never a path the project syncs —, the installs its package asks for, then its script, with the
// folder, the input, the output folder and the progress file in the environment.
import { describe, expect, it } from "vitest";

import { JOB_ROOT, jobDir, jobLaunchScript, jobShellScript } from "./command";

describe("the job's shell script", () => {
  const dir = jobDir("job-0123456789abcdef");

  it("lives under /tmp/openlen-jobs, outside every synced path", () => {
    expect(JOB_ROOT).toBe("/tmp/openlen-jobs");
    expect(dir).toBe("/tmp/openlen-jobs/job-0123456789abcdef");
  });

  it("a Python job: its environment, the app folder, then python3 on its script", () => {
    const s = jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/pdf.py", install: null });
    expect(s).toContain(`export OPENLEN_JOB_DIR='${dir}'`);
    expect(s).toContain(`export OPENLEN_JOB_INPUT='${dir}/input.json'`);
    expect(s).toContain(`export OPENLEN_JOB_OUT='${dir}/out'`);
    expect(s).toContain(`export OPENLEN_JOB_PROGRESS='${dir}/progress'`);
    expect(s).toContain(`export OPENLEN_JOB_FILES='${dir}/files'`);
    expect(s).toContain(`cd '${dir}/app'`);
    expect(s.trim().split("\n").at(-1)).toBe("exec python3 'jobs/pdf.py'");
    expect(s).not.toMatch(/pip install|npm ci/);
  });

  it("a Node job with its package's dependencies installs them first, and stops if that fails", () => {
    const s = jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/zip.mjs", install: "npm" });
    expect(s).toMatch(/npm ci --omit=dev --no-audit --no-fund[^\n]*\|\| exit 97/);
    expect(s.trim().split("\n").at(-1)).toBe("exec node 'jobs/zip.mjs'");
  });

  it("a Python job with requirements.txt pip-installs them first", () => {
    expect(jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/pdf.py", install: "pip" })).toMatch(/pip install --quiet -r requirements\.txt[^\n]*\|\| exit 97/);
  });

  it("the launcher starts it in its own session, records its group and its exit, and comes back at once", () => {
    const l = jobLaunchScript("job-0123456789abcdef");
    expect(l).toContain(`cd '${dir}'`);
    expect(l).toMatch(/setsid bash run\.sh > stdout 2> stderr < \/dev\/null/);
    expect(l).toContain("echo $? > exit");
    expect(l.trim().endsWith("&")).toBe(true);
  });
});
