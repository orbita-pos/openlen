// WHAT A JOB RUNS IN THE BOX (spec local 2026-11-04-herramientas-hechas-por-len, §4.6). Everything lives under its own
// folder in /tmp — a system path the project never syncs (lib/agent/sandbox/paths.ts), so nothing a job writes reaches
// the tool project's files or Len's next turn. The runner (./runner.ts) times it and stops it; this script only sets
// the environment, installs what the version's package asks for, and execs the script. Pure.

export const JOB_ROOT = "/tmp/openlen-jobs";

/** The job's folder in the box. */
export function jobDir(id: string): string {
  return `${JOB_ROOT}/${id}`;
}

/** Single-quoted for bash. */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `run.sh`: the job itself, as the leader of its own process group (`$$` → `pid`, so the runner can stop it all). */
export function jobShellScript(o: { readonly id: string; readonly script: string; readonly install: "npm" | "pip" | null }): string {
  const dir = jobDir(o.id);
  const rel = o.script.replace(/^\/+/, "");
  const lines = [
    "#!/bin/bash",
    `export OPENLEN_JOB_DIR=${q(dir)}`,
    `export OPENLEN_JOB_INPUT=${q(`${dir}/input.json`)}`,
    `export OPENLEN_JOB_OUT=${q(`${dir}/out`)}`,
    `export OPENLEN_JOB_PROGRESS=${q(`${dir}/progress`)}`,
    `export OPENLEN_JOB_FILES=${q(`${dir}/files`)}`,
    `echo $$ > "$OPENLEN_JOB_DIR/pid"`,
    `mkdir -p "$OPENLEN_JOB_OUT" "$OPENLEN_JOB_FILES"`,
    `cd ${q(`${dir}/app`)}`,
  ];
  if (o.install === "npm") lines.push(`npm ci --omit=dev --no-audit --no-fund >> "$OPENLEN_JOB_DIR/install.log" 2>&1 || exit 97`);
  if (o.install === "pip") lines.push(`pip install --quiet -r requirements.txt >> "$OPENLEN_JOB_DIR/install.log" 2>&1 || exit 97`);
  lines.push(rel.endsWith(".py") ? `exec python3 ${q(rel)}` : `exec node ${q(rel)}`);
  return `${lines.join("\n")}\n`;
}

/** `launch.sh`: starts `run.sh` in its own session, keeps its output and its exit code, and comes back at once. */
export function jobLaunchScript(id: string): string {
  return `cd ${q(jobDir(id))}\n(setsid bash run.sh > stdout 2> stderr < /dev/null; echo $? > exit) &\n`;
}

/** Stops the job's whole process group: TERM, a moment, then KILL. */
export function jobKillCommand(id: string): string {
  const pid = `$(cat ${q(`${jobDir(id)}/pid`)} 2>/dev/null)`;
  return `kill -TERM -- -${pid} 2>/dev/null; sleep 2; kill -KILL -- -${pid} 2>/dev/null; true`;
}

/** The exit code a failed install leaves (`|| exit 97`). */
export const INSTALL_FAILED_EXIT = 97;
