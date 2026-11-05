// WHAT A JOB RUNS IN THE BOX (spec local 2026-11-04-herramientas-hechas-por-len, §4.6). Everything lives under its own
// folder in /tmp, and the script runs as its OWN unprivileged user (`openlen-job`), not as the box's user: the project
// lives at the box's root and the person's memory in /home/user, both the box user's, so a job can't write into the
// tool's draft, read another person's ~/.len, or talk to OpenLen through the bridge's mailbox. Stopping a job is
// stopping that user's processes — whatever it forked or detached. The runner (./runner.ts) times it and stops it;
// these scripts only prepare the box, set the environment, install what /jobs asks for, and exec the script. Pure.

export const JOB_ROOT = "/tmp/openlen-jobs";
/** The user a job runs as: created once per box, without a home or a login. */
export const JOB_USER = "openlen-job";

/** The job's folder in the box. */
export function jobDir(id: string): string {
  return `${JOB_ROOT}/${id}`;
}

/** Single-quoted for bash. */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Every process of the job's user, at once. */
export const JOB_KILL_NOW = `sudo -n pkill -KILL -u ${JOB_USER} 2>/dev/null; true`;

/** Before a job: its user exists, nothing of an earlier job is left (a crash leaves its processes and its folder), and
 *  what is the box user's alone stays so — the person's home, the bridge's mailbox, Len's command outputs. Its exit
 *  code is the user's existence: without it, the job can't run. */
export const JOB_PREPARE_COMMAND = [
  `id -u ${JOB_USER} >/dev/null 2>&1 || sudo -n useradd --system --no-create-home --shell /usr/sbin/nologin ${JOB_USER} >/dev/null 2>&1`,
  JOB_KILL_NOW,
  `sudo -n rm -rf ${JOB_ROOT}`,
  "chmod 700 /home/user /run/openlen /tmp/bash-tasks /tmp/tool-results 2>/dev/null",
  `id -u ${JOB_USER} >/dev/null`,
].join("; ");

/** After the runner wrote the job's folder (as the box user): the job's user may write in it too. */
export function jobOpenUpCommand(id: string): string {
  return `chmod -R a+rwX ${q(jobDir(id))}`;
}

/** What /jobs asks to install before the script: `npm ci` with /jobs/package-lock.json, `npm install` without it, and
 *  `pip install` of /jobs/requirements.txt (or /requirements.txt). Never the app's own /package.json. */
export interface JobInstall {
  readonly npm?: "ci" | "install";
  readonly pip?: string;
}

/** `run.sh`: the job itself, as its own user, in its folder's copy of the version. */
export function jobShellScript(o: { readonly id: string; readonly script: string; readonly install: JobInstall | null }): string {
  const dir = jobDir(o.id);
  const rel = o.script.replace(/^\/+/, "");
  const lines = [
    "#!/bin/bash",
    "umask 022",
    `export HOME=${q(`${dir}/home`)}`,
    `export OPENLEN_JOB_DIR=${q(dir)}`,
    `export OPENLEN_JOB_INPUT=${q(`${dir}/input.json`)}`,
    `export OPENLEN_JOB_OUT=${q(`${dir}/out`)}`,
    `export OPENLEN_JOB_PROGRESS=${q(`${dir}/progress`)}`,
    `export OPENLEN_JOB_FILES=${q(`${dir}/files`)}`,
    `mkdir -p "$HOME" "$OPENLEN_JOB_OUT" "$OPENLEN_JOB_FILES"`,
    `cd ${q(`${dir}/app`)}`,
  ];
  const log = `>> "$OPENLEN_JOB_DIR/install.log" 2>&1 || exit ${INSTALL_FAILED_EXIT}`;
  if (o.install?.npm) lines.push(`(cd jobs && npm ${o.install.npm} --omit=dev --no-audit --no-fund) ${log}`);
  if (o.install?.pip) lines.push(`pip install --user --quiet -r ${q(o.install.pip.replace(/^\/+/, ""))} ${log}`);
  lines.push(rel.endsWith(".py") ? `exec python3 ${q(rel)}` : `exec node ${q(rel)}`);
  return `${lines.join("\n")}\n`;
}

/** `launch.sh`: starts `run.sh` as the job's user in its own session, keeps its output and its exit code (written by
 *  the box user, outside the job's reach), and comes back at once. */
export function jobLaunchScript(id: string): string {
  return `cd ${q(jobDir(id))}\n(setsid sudo -n -u ${JOB_USER} bash run.sh > stdout 2> stderr < /dev/null; echo $? > exit) &\n`;
}

/** Stops the job: TERM to every process of its user, a moment, then KILL. */
export function jobKillCommand(): string {
  return `sudo -n pkill -TERM -u ${JOB_USER} 2>/dev/null; sleep 2; ${JOB_KILL_NOW}`;
}

/** At boot, in the box of a job that died with the process: every job's processes and folders gone. */
export const JOB_BOX_CLEANUP = `${JOB_KILL_NOW}; sudo -n rm -rf ${JOB_ROOT}; true`;

/** After a job: its processes and its folder gone (its user's files need the box's sudo). */
export function jobCleanupCommand(id: string): string {
  return `${JOB_KILL_NOW}; sudo -n rm -rf ${q(jobDir(id))}; true`;
}

/** The poll's marker between the progress line and the exit code. */
export const POLL_MARK = "--openlen-job-exit--";
/** The longest progress line kept. */
export const PROGRESS_MAX_CHARS = 200;

/** One command per poll — which also keeps E2B from pausing the box: the progress file's LAST line (never the whole
 *  file: a chatty job can make it huge) and the exit code, if the job ended. */
export function jobPollCommand(id: string): string {
  const dir = jobDir(id);
  return `tail -n 1 ${q(`${dir}/progress`)} 2>/dev/null | head -c ${PROGRESS_MAX_CHARS * 4}; printf '\\n${POLL_MARK}\\n'; cat ${q(`${dir}/exit`)} 2>/dev/null; true`;
}

export function parsePoll(stdout: string): { readonly progress: string; readonly exit: number | null } {
  const at = stdout.lastIndexOf(`\n${POLL_MARK}\n`);
  const before = at < 0 ? "" : stdout.slice(0, at);
  const after = at < 0 ? "" : stdout.slice(at + POLL_MARK.length + 2).trim();
  const exit = /^-?\d+$/.test(after) ? Number.parseInt(after, 10) : null;
  return { progress: before.trim().slice(0, PROGRESS_MAX_CHARS), exit };
}

/** The end of a log (stderr, the install's): only its tail is ever read. */
export function jobTailCommand(path: string, bytes: number): string {
  return `tail -c ${bytes} ${q(path)} 2>/dev/null; true`;
}

/** The exit code a failed install leaves (`|| exit 97`). */
export const INSTALL_FAILED_EXIT = 97;
