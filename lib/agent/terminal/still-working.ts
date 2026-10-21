/**
 * A command that is running is work, not silence.
 *
 * The agent route aborts a turn after three minutes with no sign of life (`relojDeSilencio`, there to catch a
 * hang). `bash` takes a `timeout` of up to ten minutes, as Claude Code's Bash does, and the terminal enforces it
 * itself (`TerminalDeLen.ejecutar` cuts the command and answers "Command timed out after …"), so a command that
 * runs long is bounded already. Claude Code shows a running command's progress instead of treating it as a stall;
 * here the same thing is a heartbeat to the watchdog while the command runs, and nothing once it ends.
 */
export const STILL_WORKING_EVERY_MS = 30_000;

export async function whileWorking<T>(work: Promise<T>, alive: (() => void) | undefined): Promise<T> {
  if (!alive) return work;
  alive();
  const beat = setInterval(alive, STILL_WORKING_EVERY_MS);
  (beat as { unref?: () => void }).unref?.();
  try {
    return await work;
  } finally {
    clearInterval(beat);
  }
}
