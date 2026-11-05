// What a job runs in the box (spec local 2026-11-04-herramientas-hechas-por-len, §4.6): its version's files under its
// own folder in /tmp — never a path the project syncs —, run as its own unprivileged user, the installs /jobs asks for,
// then its script, with the folder, the input, the output folder and the progress file in the environment.
import { describe, expect, it } from "vitest";

import {
  JOB_PREPARE_COMMAND,
  JOB_ROOT,
  JOB_USER,
  jobCleanupCommand,
  jobDir,
  jobKillCommand,
  jobLaunchScript,
  jobOpenUpCommand,
  jobPollCommand,
  jobShellScript,
  parsePoll,
  POLL_MARK,
} from "./command";

describe("the job's shell script", () => {
  const dir = jobDir("job-0123456789abcdef");

  it("lives under /tmp/openlen-jobs, outside every synced path", () => {
    expect(JOB_ROOT).toBe("/tmp/openlen-jobs");
    expect(dir).toBe("/tmp/openlen-jobs/job-0123456789abcdef");
  });

  it("a Python job: its environment, its own home, the app folder, then python3 on its script", () => {
    const s = jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/pdf.py", install: null });
    expect(s).toContain(`export HOME='${dir}/home'`);
    expect(s).toContain(`export OPENLEN_JOB_DIR='${dir}'`);
    expect(s).toContain(`export OPENLEN_JOB_INPUT='${dir}/input.json'`);
    expect(s).toContain(`export OPENLEN_JOB_OUT='${dir}/out'`);
    expect(s).toContain(`export OPENLEN_JOB_PROGRESS='${dir}/progress'`);
    expect(s).toContain(`export OPENLEN_JOB_FILES='${dir}/files'`);
    expect(s).toContain(`cd '${dir}/app'`);
    expect(s.trim().split("\n").at(-1)).toBe("exec python3 'jobs/pdf.py'");
    expect(s).not.toMatch(/pip install|npm /);
  });

  it("a Node job installs /jobs's own dependencies — never the app's /package.json — and stops if that fails", () => {
    const ci = jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/zip.mjs", install: { npm: "ci" } });
    expect(ci).toMatch(/\(cd jobs && npm ci --omit=dev --no-audit --no-fund\)[^\n]*\|\| exit 97/);
    expect(ci.trim().split("\n").at(-1)).toBe("exec node 'jobs/zip.mjs'");
    expect(jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/zip.mjs", install: { npm: "install" } })).toMatch(/\(cd jobs && npm install --omit=dev/);
  });

  it("a Python job pip-installs its requirements for its own user, first", () => {
    expect(jobShellScript({ id: "job-0123456789abcdef", script: "/jobs/pdf.py", install: { pip: "/jobs/requirements.txt" } })).toMatch(
      /pip install --user --quiet -r 'jobs\/requirements\.txt'[^\n]*\|\| exit 97/,
    );
  });

  it("the launcher starts it as the job's own user, in its own session, records its exit and comes back at once", () => {
    const l = jobLaunchScript("job-0123456789abcdef");
    expect(l).toContain(`cd '${dir}'`);
    expect(l).toContain(`setsid sudo -n -u ${JOB_USER} bash run.sh > stdout 2> stderr < /dev/null`);
    expect(l).toContain("echo $? > exit");
    expect(l.trim().endsWith("&")).toBe(true);
  });
});

describe("the box around a job", () => {
  it("before it: its user, nothing left of an earlier job, and the box user's own folders closed to it", () => {
    expect(JOB_PREPARE_COMMAND).toContain(`useradd --system --no-create-home --shell /usr/sbin/nologin ${JOB_USER}`);
    expect(JOB_PREPARE_COMMAND).toContain(`pkill -KILL -u ${JOB_USER}`);
    expect(JOB_PREPARE_COMMAND).toContain(`rm -rf ${JOB_ROOT}`);
    expect(JOB_PREPARE_COMMAND).toMatch(/chmod 700 \/home\/user \/run\/openlen/);
    expect(JOB_PREPARE_COMMAND.endsWith(`id -u ${JOB_USER} >/dev/null`)).toBe(true);
    expect(jobOpenUpCommand("job-1")).toBe(`chmod -R a+rwX '${JOB_ROOT}/job-1'`);
  });

  it("stopping it stops every process of its user; after it, its folder goes", () => {
    expect(jobKillCommand()).toMatch(new RegExp(`pkill -TERM -u ${JOB_USER}.*sleep 2.*pkill -KILL -u ${JOB_USER}`));
    expect(jobCleanupCommand("job-1")).toMatch(new RegExp(`pkill -KILL -u ${JOB_USER}.*sudo -n rm -rf '${JOB_ROOT}/job-1'`));
  });

  it("a poll reads only the progress file's last line and the exit code", () => {
    const cmd = jobPollCommand("job-1");
    expect(cmd).toMatch(/^tail -n 1 '\/tmp\/openlen-jobs\/job-1\/progress'/);
    expect(cmd).toContain(POLL_MARK);
    expect(parsePoll(`40%\n${POLL_MARK}\n`)).toEqual({ progress: "40%", exit: null });
    expect(parsePoll(`done\n${POLL_MARK}\n0\n`)).toEqual({ progress: "done", exit: 0 });
    expect(parsePoll(`\n${POLL_MARK}\n143\n`)).toEqual({ progress: "", exit: 143 });
    expect(parsePoll("garbage")).toEqual({ progress: "", exit: null });
  });
});
