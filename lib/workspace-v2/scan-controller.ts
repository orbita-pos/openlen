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

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    start() {
      if (killed()) return;
      if (state.phase !== "idle") return;
      emit({ phase: "scanning", busy: true, ring: false });
    },

    applyDuring(fn) {
      if (killed() || state.phase !== "scanning") { fn(); return; }
      if (immediate()) { fn(); return; }
      if (pending) runPending();
      pending = { fn, final: false, ran: false };
      armWatchdog(pending);
    },

    finish(fn) {
      const f = fn ?? (() => {});
      if (killed()) { f(); return; }
      if (state.phase === "idle") { this.pulse(f); return; }
      if (state.phase !== "scanning") { f(); return; }
      if (immediate()) {
        f();
        clearAll();
        emit({ phase: "finalizing", busy: false, ring: true });
        later(toIdle, IMMEDIATE_FINAL_MS);
        return;
      }
      if (pending) runPending();
      pending = { fn: f, final: true, ran: false };
      armWatchdog(pending);
    },

    pulse(fn) {
      if (killed()) { fn(); return; }
      if (state.phase === "scanning") { this.applyDuring(fn); return; }
      if (state.phase !== "idle") { fn(); return; }
      if (immediate()) {
        fn();
        emit({ phase: "finalizing", busy: false, ring: true });
        later(toIdle, IMMEDIATE_FINAL_MS);
        return;
      }
      emit({ busy: true });
      finalPass({ fn, final: true, ran: false });
    },

    cancel() {
      if (state.phase === "scanning" || state.phase === "finalizing") dissolve();
    },

    onIteration() {
      if (state.phase !== "scanning" || !pending || immediate()) return;
      const p = pending;
      if (p.final) { clearAll(); pending = p; finalPass(p); }
      else {
        later(() => {
          if (!p.ran) { p.ran = true; p.fn(); }
          if (pending === p) pending = null;
        }, SWEEP_MS * APPLY_AT);
      }
    },
  };
}

export const scanController: ScanController = createScanController();
