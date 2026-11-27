// HOW THE WINDOW OF AN APP ON THE DESKTOP ASKS ITS QUESTION (spec local 2026-11-26-apps-en-el-escritorio, §4.4), as Claude's
// own app window asks whether its artifact is still there: every question has a deadline (8 s), callers that arrive while one
// is out share it, and a check that only came from the window being looked at again goes out at most once a minute. The one
// that opens the window always runs. Pure: the request is the caller's.

/** How long a question has to answer before it is given up (Claude's probe: 8 s). */
export const PROBE_TIMEOUT_MS = 8000;
/** Between two checks that only came from the window being looked at again. */
export const FOCUS_PROBE_GAP_MS = 60_000;

export interface StateProbe<T> {
  /** A question that must go out (the one on opening): a question already out is shared, never doubled. */
  ask(): Promise<T>;
  /** One that only came from the window being looked at again: null while the last went out less than a minute ago. */
  askOnFocus(): Promise<T> | null;
}

export function createStateProbe<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { readonly timeoutMs?: number; readonly focusGapMs?: number } = {},
): StateProbe<T> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const focusGapMs = options.focusGapMs ?? FOCUS_PROBE_GAP_MS;
  let inflight: Promise<T> | null = null;
  /** When the last question went out (not when it ended: a timeout must not make the window wait longer). */
  let lastAt: number | null = null;

  function ask(): Promise<T> {
    if (inflight) return inflight;
    lastAt = Date.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The deadline is a race, not only an abort: a request that never hears it was told to stop still frees the place.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException("The check took too long", "TimeoutError"));
      }, timeoutMs);
    });
    let attempt: Promise<T>;
    try {
      attempt = run(controller.signal);
    } catch (error) {
      attempt = Promise.reject(error);
    }
    const question = Promise.race([attempt, deadline]).finally(() => {
      clearTimeout(timer);
      if (inflight === question) inflight = null;
    });
    inflight = question;
    return question;
  }

  return {
    ask,
    askOnFocus() {
      if (inflight) return inflight;
      if (lastAt !== null && Date.now() - lastAt < focusGapMs) return null;
      return ask();
    },
  };
}
