// What Len reads about commands that run in the box's background (spec local
// 2026-10-21-real-terminal-e2b, §6). The behavior is Claude Code's Bash in a session that is not
// woken up later: a command over its time keeps running in the background, `run_in_background`
// starts one at once, Len hears when one finishes while it is still working, and whatever still
// runs is stopped when it gives its final answer. The words are OpenLen's; the finished notice
// follows DeepSeek's harness (MIT, packages/jobs/tool-jobs), with the output read by `cat`
// because Len has no job_output tool.

export const BACKGROUND_STOPS_AT_THE_END =
  "If it finishes while you are still working you will be told; it is stopped when you give your final answer, so if you need its result, wait for it before answering.";

export function backgroundStarted(id: string, outputPath: string): string {
  return `Started in the background as job ${id}; its output is being written to ${outputPath}. ${BACKGROUND_STOPS_AT_THE_END}`;
}

export function movedToBackground(timeoutMs: number, id: string, outputPath: string): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `The command did not finish within ${seconds}s and keeps running in the background as job ${id}; its output is being written to ${outputPath}. ${BACKGROUND_STOPS_AT_THE_END}`;
}

const MAX_LABEL = 80;

export function backgroundFinished(job: { readonly id: string; readonly command: string; readonly exitCode: number | null; readonly outputPath: string }): string {
  const oneLine = job.command.replace(/\s+/g, " ").trim();
  const label = oneLine.length > MAX_LABEL ? `${oneLine.slice(0, MAX_LABEL - 1)}…` : oneLine;
  const status = job.exitCode === null ? "completed" : job.exitCode === 0 ? "completed, exit code 0" : `failed, exit code ${job.exitCode}`;
  return `background job ${job.id} (bash: ${label}) finished [status: ${status}]. Read its output with cat ${job.outputPath}.`;
}
