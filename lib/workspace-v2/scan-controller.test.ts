import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLY_AT, DISSOLVE_MS, RING_AT, RING_HOLD_MS, SWEEP_MS, WATCHDOG_MS,
  createScanController,
} from "./scan-controller";

function make(over: { kill?: boolean; imm?: boolean } = {}) {
  return createScanController({
    killSwitch: () => over.kill ?? false,
    immediate: () => over.imm ?? false,
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scan-controller — fases", () => {
  it("start desde idle entra a scanning con busy", () => {
    const c = make();
    c.start();
    expect(c.getState()).toEqual({ phase: "scanning", busy: true, ring: false });
  });

  it("start es idempotente durante scanning", () => {
    const c = make();
    c.start(); c.start();
    expect(c.getState().phase).toBe("scanning");
  });

  it("applyDuring ejecuta el fn al 45% de la vuelta SIGUIENTE a la iteración", () => {
    const c = make(); const fn = vi.fn();
    c.start();
    c.applyDuring(fn);
    expect(fn).not.toHaveBeenCalled();
    c.onIteration();
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT - 1);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getState().phase).toBe("scanning");
  });

  it("finish: pasada final con fn@45%, ring@97%, idle tras RING_HOLD", () => {
    const c = make(); const fn = vi.fn();
    c.start(); c.finish(fn);
    c.onIteration();
    expect(c.getState().phase).toBe("finalizing");
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getState().busy).toBe(false);
    vi.advanceTimersByTime(SWEEP_MS * (RING_AT - APPLY_AT) + 1);
    expect(c.getState().ring).toBe(true);
    vi.advanceTimersByTime(SWEEP_MS * (1 - RING_AT) + RING_HOLD_MS + 1);
    expect(c.getState()).toEqual({ phase: "idle", busy: false, ring: false });
  });

  it("watchdog: sin iteraciones, el fn de finish corre a los 2500ms y disuelve", () => {
    const c = make(); const fn = vi.fn();
    c.start(); c.finish(fn);
    vi.advanceTimersByTime(WATCHDOG_MS + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getState().phase).toBe("dissolving");
    vi.advanceTimersByTime(DISSOLVE_MS + 1);
    expect(c.getState().phase).toBe("idle");
  });

  it("cancel con fn pendiente lo ejecuta inmediato (jamás se pierde un update)", () => {
    const c = make(); const fn = vi.fn();
    c.start(); c.applyDuring(fn);
    c.cancel();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getState().busy).toBe(false);
  });

  it("pulse desde idle corre una pasada; durante scanning delega a applyDuring", () => {
    const c = make(); const p1 = vi.fn(); const p2 = vi.fn();
    c.pulse(p1);
    expect(c.getState().phase).toBe("finalizing");
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT + 1);
    expect(p1).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SWEEP_MS + RING_HOLD_MS);
    c.start(); c.pulse(p2);
    c.onIteration();
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT + 1);
    expect(p2).toHaveBeenCalledTimes(1);
    expect(c.getState().phase).toBe("scanning");
  });

  it("doble finish: el fn anterior corre inmediato, el nuevo queda pendiente, cada uno UNA vez", () => {
    const c = make(); const a = vi.fn(); const b = vi.fn();
    c.start(); c.finish(a); c.finish(b);
    expect(a).toHaveBeenCalledTimes(1);
    c.onIteration();
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT + 1);
    expect(b).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SWEEP_MS * 2 + RING_HOLD_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("killSwitch: todo pasa directo, estado siempre idle", () => {
    const c = make({ kill: true }); const fn = vi.fn();
    c.start();
    expect(c.getState().phase).toBe("idle");
    c.applyDuring(fn); c.finish(fn); c.pulse(fn);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(c.getState().phase).toBe("idle");
  });

  it("immediate (reduced-motion): fns al instante, finalizing corto sin iteración", () => {
    const c = make({ imm: true }); const fn = vi.fn();
    c.start(); c.finish(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.getState().phase).toBe("finalizing");
    vi.advanceTimersByTime(601);
    expect(c.getState().phase).toBe("idle");
  });

  it("subscribe notifica cambios y el unsubscribe corta", () => {
    const c = make(); const seen: string[] = [];
    const un = c.subscribe((s) => seen.push(s.phase));
    c.start();
    expect(seen).toContain("scanning");
    un();
    c.cancel();
    expect(seen.filter((p) => p === "dissolving")).toHaveLength(0);
  });

  it("cancel durante un pulse en vuelo ejecuta el fn (jamás se pierde)", () => {
    const c = make(); const fn = vi.fn();
    c.pulse(fn);
    vi.advanceTimersByTime(600); // antes del 45% (720ms)
    c.cancel();
    vi.advanceTimersByTime(10000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("finish inmediato drena un applyDuring pendiente (fnA jamás se pierde)", () => {
    let imm = false;
    const c = createScanController({ killSwitch: () => false, immediate: () => imm });
    const fnA = vi.fn(); const fnB = vi.fn();
    c.start(); c.applyDuring(fnA);
    imm = true;
    c.finish(fnB);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("los métodos sobreviven el destructuring (sin this)", () => {
    const c = make(); const fn = vi.fn();
    const { start, finish } = c;
    start(); finish(fn);
    c.onIteration();
    vi.advanceTimersByTime(SWEEP_MS * APPLY_AT + 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
