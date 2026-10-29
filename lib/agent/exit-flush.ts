// What a live turn writes before the process exits. A deploy stops the app with a SIGTERM; Next answers it by
// closing the server (it waits for the requests still open) and then `process.exit(0)`, and a turn still
// working at that moment — one whose browser went away, or a turn started by the server — died with what it
// had saved up to then. Claude Code drains its transcript queue on the way out (its graceful shutdown, with a
// time limit), and so does this: once a SIGTERM or SIGINT arrived, the exit waits until every live turn wrote
// what it has — its row, what the model saw, its layer-0 rows — or `timeoutMs` passed. What the process could
// not write, the next boot closes (close-dead-turns.ts).
type Flush = () => Promise<void>;

// On `globalThis`, like the open turns of direcciones.ts: instrumentation.ts arms the exit and the agent route
// registers its turns, and they are different bundles (and, in development, each route compiles on its own).
const KEY = Symbol.for("openlen.agent.exitFlush");
type Global = typeof globalThis & { [KEY]?: Set<Flush> };
const live: Set<Flush> = (globalThis as Global)[KEY] ?? ((globalThis as Global)[KEY] = new Set());

/** A live turn's last write; returns what to call when the turn ends on its own. */
export function flushOnExit(flush: Flush): () => void {
  live.add(flush);
  return () => {
    live.delete(flush);
  };
}

/** Every live turn writes now; resolves when all did (`true`), or after `timeoutMs` (`false`). Never rejects. */
export async function flushLiveTurns(timeoutMs: number): Promise<boolean> {
  if (live.size === 0) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const all = Promise.all(
    [...live].map(async (flush) => {
      try {
        await flush();
      } catch {}
    }),
  ).then(() => true as const);
  try {
    return await Promise.race([all, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** Enough for a row, the layer-0 rows and a box's pause; systemd waits 90 s before its SIGKILL. */
export const EXIT_FLUSH_TIMEOUT_MS = 5_000;

const INSTALLED = Symbol.for("openlen.agent.exitFlushInstalled");
type InstalledGlobal = typeof globalThis & { [INSTALLED]?: WeakSet<object> };
const installedOn: WeakSet<object> = (globalThis as InstalledGlobal)[INSTALLED] ?? ((globalThis as InstalledGlobal)[INSTALLED] = new WeakSet());

interface ExitingProcess {
  exit: (code?: number | string | null) => never;
  once(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** From the first SIGTERM or SIGINT on, `exit` waits for `flushLiveTurns` first. Only for the exit that follows a
 *  signal: until one arrives nothing changes. With `NEXT_MANUAL_SIG_HANDLE` someone else handles the signals, and
 *  this stays out. */
export function installExitFlush(o: { proc?: ExitingProcess; timeoutMs?: number; log?: (line: string) => void } = {}): void {
  const proc = o.proc ?? (process as unknown as ExitingProcess);
  if (proc.env.NEXT_MANUAL_SIG_HANDLE) return;
  // Once per process: in development `register()` can run again.
  if (installedOn.has(proc)) return;
  installedOn.add(proc);
  const timeoutMs = o.timeoutMs ?? EXIT_FLUSH_TIMEOUT_MS;
  const log = o.log ?? ((line: string) => console.log(line));
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    const exit = proc.exit.bind(proc);
    let exiting: Promise<void> | null = null;
    proc.exit = ((code?: number | string | null) => {
      // Nothing to write: the exit is the one it always was.
      if (live.size === 0 && exiting === null) return exit(code);
      if (exiting === null) {
        const turns = live.size;
        const from = Date.now();
        // What the deploy's log has to say: whether the turns finished writing, or the limit cut them.
        exiting = flushLiveTurns(timeoutMs)
          .then((all) =>
            log(
              all
                ? `[exit] ${turns} live turn(s) wrote what they had before the exit (${Date.now() - from} ms)`
                : `[exit] ${turns} live turn(s) were still writing after ${timeoutMs} ms: exiting anyway; the next boot closes what they left`,
            ),
          )
          .finally(() => exit(code));
      }
      return undefined as never;
    }) as ExitingProcess["exit"];
  };
  proc.once("SIGTERM", arm);
  proc.once("SIGINT", arm);
}
