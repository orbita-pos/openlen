/**
 * A run that can spend money stops when whoever launched it is gone. On 21/10 a worker started in the background
 * outlived the session that started it: Windows does not end a dead process's children, so a paid trial could go on
 * with nobody watching. Both the trial and its worker poll their parent and stop when it has ended.
 */
export function parentIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it is just not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Calls `onGone` once if the process that launched this one ends; returns the way to stop watching. */
export function stopWhenParentGone(onGone: () => void, everyMs = 5_000): () => void {
  const parent = process.ppid;
  const timer = setInterval(() => {
    if (parentIsAlive(parent)) return;
    clearInterval(timer);
    onGone();
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
