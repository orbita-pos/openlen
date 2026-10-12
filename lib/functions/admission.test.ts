// @vitest-environment node
import { describe, expect, it } from "vitest";

import { admit } from "./admission";
import { ConcurrencyLimiter } from "./concurrency";
import { FUNCTION_LIMITS } from "./limits";
import { costNanoUsd, worstCaseNanoUsd } from "./meter";
import { memoryUsageStore } from "./usage";

const AHORA = new Date("2026-10-11T12:00:00Z");
const MUCHO = { free: 1e15, paid: 1e15 };
const base = () => ({ projectId: "p1", plan: "free" as const, now: AHORA, usage: memoryUsageStore(), limiter: new ConcurrencyLimiter(), caps: MUCHO });

describe("admit", () => {
  it("admite, y al soltar libera la plaza y liquida lo real (recortado al peor caso)", async () => {
    const o = base();
    const a = await admit(o);
    expect(a.ok).toBe(true);
    expect(o.limiter.inFlight("p1")).toBe(1);
    if (!a.ok) return;
    await a.release(500);
    await a.release(500); // dos veces no cuenta dos
    expect(o.limiter.inFlight("p1")).toBe(0);
    expect(o.usage.pools.get("2026-10|free")).toEqual({ reserved: 0, spent: costNanoUsd(500) });
    expect(o.usage.projectNanoUsd.get("p1|2026-10")).toBe(costNanoUsd(500));
    const b = await admit(o);
    if (b.ok) await b.release(10_000_000);
    expect(o.usage.pools.get("2026-10|free")!.spent).toBe(costNanoUsd(500) + worstCaseNanoUsd(FUNCTION_LIMITS.free.timeoutSec));
  });

  it("llamadas a la vez: la tercera de Gratis espera fuera", async () => {
    const o = base();
    expect((await admit(o)).ok).toBe(true);
    expect((await admit(o)).ok).toBe(true);
    expect(await admit(o)).toEqual({ ok: false, reason: "concurrency" });
  });

  it("cuota del mes agotada", async () => {
    const o = base();
    o.usage.calls.set("p1|2026-10", FUNCTION_LIMITS.free.callsPerMonth);
    expect(await admit(o)).toEqual({ ok: false, reason: "quota" });
    expect(o.limiter.inFlight("p1")).toBe(0);
  });

  it("🔴 la bolsa: reserva el PEOR caso; sin hueco no se llama y la llamada se devuelve", async () => {
    const peor = worstCaseNanoUsd(FUNCTION_LIMITS.free.timeoutSec);
    // Hueco para dos peores casos y lo que gasta de verdad la primera (100 ms).
    const o = { ...base(), caps: { free: peor * 2 + costNanoUsd(100), paid: 1e15 } };
    const a = await admit(o);
    const b = await admit({ ...o, projectId: "p2" });
    expect(a.ok && b.ok).toBe(true);
    expect(await admit({ ...o, projectId: "p3" })).toEqual({ ok: false, reason: "cap" });
    expect(o.usage.calls.get("p3|2026-10") ?? 0).toBe(0);
    if (a.ok) await a.release(100);
    expect((await admit({ ...o, projectId: "p3" })).ok).toBe(true);
  });

  it("los planes de pago van a su bolsa: Gratis llena no los toca", async () => {
    const o = { ...base(), caps: { free: 0, paid: 1e15 } };
    expect(await admit(o)).toEqual({ ok: false, reason: "cap" });
    expect((await admit({ ...o, plan: "pro" })).ok).toBe(true);
  });
});
