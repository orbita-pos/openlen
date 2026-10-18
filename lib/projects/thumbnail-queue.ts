/** A false result means an agent still owns the project: retry after the turn.
 * Errors cool down for a minute, leaving the last good image in place. */
export function createThumbnailQueue(run: (projectId: string) => Promise<boolean>, delayMs = 3_000) {
  type Job = { timer?: ReturnType<typeof setTimeout>; running: boolean; dirty: boolean; cooling: boolean };
  const jobs = new Map<string, Job>();
  function arm(id: string, job: Job) {
    job.timer = setTimeout(() => { void execute(id, job); }, delayMs);
    job.timer.unref?.();
  }
  async function execute(id: string, job: Job) {
    job.timer = undefined;
    job.running = true;
    job.dirty = false;
    try {
      const finished = await run(id);
      job.running = false;
      if (!finished || job.dirty) arm(id, job);
      else jobs.delete(id);
    } catch {
      job.running = false;
      job.cooling = true;
      job.timer = setTimeout(() => jobs.delete(id), 60_000);
      job.timer.unref?.();
    }
  }
  return {
    schedule(id: string): void {
      const existing = jobs.get(id);
      if (existing) {
        if (existing.running) existing.dirty = true;
        return;
      }
      // listProjects is capped at 200; bound the registry even across users.
      if (jobs.size >= 200) return;
      const job: Job = { running: false, dirty: false, cooling: false };
      jobs.set(id, job);
      arm(id, job);
    },
    pending(id: string): boolean { const job = jobs.get(id); return !!job && !job.cooling; },
  };
}
