export type ScanPhase = "idle" | "scanning" | "finalizing" | "dissolving";
export interface ScanState { phase: ScanPhase; busy: boolean; ring: boolean }

export const SWEEP_MS = 1600;
export const APPLY_AT = 0.45;
export const RING_AT = 0.97;
export const WATCHDOG_MS = 2500;
export const RING_HOLD_MS = 1500;
export const DISSOLVE_MS = 400;
const IMMEDIATE_FINAL_MS = 600;

export interface ScanController {
  getState(): ScanState;
  subscribe(fn: (s: ScanState) => void): () => void;
  start(): void;
  applyDuring(fn: () => void): void;
  finish(fn?: () => void): void;
  cancel(): void;
  pulse(fn: () => void): void;
  onIteration(): void;
}

interface Pending { fn: () => void; final: boolean; ran: boolean }

export function createScanController(opts?: {
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  killSwitch?: () => boolean;
  immediate?: () => boolean;
}): ScanController {
  const setT = opts?.setTimeout ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearT = opts?.clearTimeout ?? ((id: ReturnType<typeof globalThis.setTimeout>) => globalThis.clearTimeout(id));
  const killed =
    opts?.killSwitch ??
    (() => {
      try { return globalThis.localStorage?.getItem("ol:scanfx") === "0"; } catch { return false; }
    });
  const immediate =
    opts?.immediate ??
    (() => {
      try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; }
    });

  let state: ScanState = { phase: "idle", busy: false, ring: false };
  const listeners = new Set<(s: ScanState) => void>();
  let pending: Pending | null = null;
  let timers: ReturnType<typeof globalThis.setTimeout>[] = [];

  function emit(next: Partial<ScanState>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l(state));
  }
  function later(fn: () => void, ms: number) { timers.push(setT(fn, ms)); }
  function clearAll() { timers.forEach((t) => clearT(t)); timers = []; }
  function runPending() {
    if (pending && !pending.ran) { pending.ran = true; pending.fn(); }
    pending = null;
  }

  function toIdle() { clearAll(); pending = null; emit({ phase: "idle", busy: false, ring: false }); }

  function dissolve() {
    runPending();
    clearAll();
    emit({ phase: "dissolving", busy: false, ring: false });
    later(toIdle, DISSOLVE_MS);
  }

  function armWatchdog(p: Pending) {
    later(() => {
      if (pending !== p || p.ran) return;
      p.ran = true; p.fn();
      if (p.final) dissolve();
      else pending = null;
    }, WATCHDOG_MS);
  }

  function finalPass(p: Pending | null) {
    emit({ phase: "finalizing" });
    later(() => {
      if (p && !p.ran) { p.ran = true; p.fn(); }
      if (pending === p) pending = null;
      emit({ busy: false });
    }, SWEEP_MS * APPLY_AT);
    later(() => emit({ ring: true }), SWEEP_MS * RING_AT);
    later(toIdle, SWEEP_MS + RING_HOLD_MS);
  }

  function getState() { return state; }
  function subscribe(fn: (s: ScanState) => void) { listeners.add(fn); return () => listeners.delete(fn); }

  function start() {
    if (killed()) return;
    if (state.phase !== "idle") return;
    emit({ phase: "scanning", busy: true, ring: false });
  }

  // M2: runPending() below doesn't clearAll() — a stale watchdog for the
  // drained Pending can stay in `timers` until it fires. It's a harmless
  // no-op when it does: armWatchdog's guard (`pending !== p || p.ran`) is
  // already true by then (runPending sets p.ran = true before clearing
  // `pending`), so the stray timer just returns. Not worth a clearAll()
  // here — that would also wipe the *other* live timers (finalPass's
  // fn/ring/toIdle) that belong to the phase currently in flight.
  function applyDuring(fn: () => void) {
    if (killed() || state.phase !== "scanning") { fn(); return; }
    if (immediate()) { fn(); return; }
    if (pending) runPending();
    pending = { fn, final: false, ran: false };
    armWatchdog(pending);
  }

  function finish(fn?: () => void) {
    const f = fn ?? (() => {});
    if (killed()) { f(); return; }
    if (state.phase === "idle") { pulse(f); return; }
    if (state.phase !== "scanning") { f(); return; }
    if (immediate()) {
      // C2: drain any applyDuring() Pending BEFORE clearAll() wipes its
      // watchdog — otherwise a pending fnA is lost when immediate() flips
      // true mid-scan and finish(fnB) arrives.
      runPending();
      f();
      clearAll();
      emit({ phase: "finalizing", busy: false, ring: true });
      later(toIdle, IMMEDIATE_FINAL_MS);
      return;
    }
    if (pending) runPending();
    pending = { fn: f, final: true, ran: false };
    armWatchdog(pending);
  }

  function pulse(fn: () => void) {
    if (killed()) { fn(); return; }
    if (state.phase === "scanning") { applyDuring(fn); return; }
    if (state.phase !== "idle") { fn(); return; }
    if (immediate()) {
      fn();
      emit({ phase: "finalizing", busy: false, ring: true });
      later(toIdle, IMMEDIATE_FINAL_MS);
      return;
    }
    emit({ busy: true });
    // C1: assign to the module-level `pending` BEFORE finalPass runs — a
    // cancel() that lands mid-finalizing (before the 45% timer) must be
    // able to find this Pending via runPending(), or its fn is lost.
    // finalPass() already does `if (pending === p) pending = null` once
    // it executes the fn, so this is safe to pair with it.
    const p: Pending = { fn, final: true, ran: false };
    pending = p;
    finalPass(p);
  }

  function cancel() {
    // M1: "dissolving" isn't in this guard on purpose — by the time we're
    // in that phase, an earlier dissolve() already ran runPending(), so
    // there's nothing left to drain. Re-entering here is a plain no-op
    // (matches this function's existing behavior for any other phase not
    // listed), not a special case that needs its own branch.
    if (state.phase === "scanning" || state.phase === "finalizing") dissolve();
  }

  function onIteration() {
    if (state.phase !== "scanning" || !pending || immediate()) return;
    const p = pending;
    if (p.final) { clearAll(); pending = p; finalPass(p); }
    else {
      later(() => {
        if (!p.ran) { p.ran = true; p.fn(); }
        if (pending === p) pending = null;
      }, SWEEP_MS * APPLY_AT);
    }
  }

  return { getState, subscribe, start, applyDuring, finish, cancel, pulse, onIteration };
}

export const scanController: ScanController = createScanController();

/** True when the scan effect won't render a visible sweep (kill switch or
 *  reduced motion) — callers can fall back to a plain busy overlay. */
export function scanFxUnavailable(): boolean {
  try {
    if (globalThis.localStorage?.getItem("ol:scanfx") === "0") return true;
  } catch {
    /* SSR / storage blocked — assume available */
  }
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}
