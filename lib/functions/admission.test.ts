// @vitest-environment node
import { describe, expect, it } from "vitest";

import { admit } from "./admission";
import { ConcurrencyLimiter } from "./concurrency";
import { FUNCTION_LIMITS } from "./limits";
import { callCostNanoUsd } from "./meter";
import { memoryUsageStore } from "./usage";

const AHORA = new Date("2026-10-11T12:00:00Z");
const MUCHO = { free: 1e15, paid: 1e15 };
const base = () => ({ projectId: "p1", plan: "free" as const, now: AHORA, usage: memoryUsageStore(), limiter: new ConcurrencyLimiter(), caps: MUCHO });

describe("admit", () => {
  it("admite, y al soltar libera la plaza y liquida el PEOR caso (Cloudflare no da la CPU real)", async () => {
    const o = base();
    const peor = callCostNanoUsd(FUNCTION_LIMITS.free.cpuMs);
    const a = await admit(o);
    expect(a.ok).toBe(true);
    expect(o.limiter.inFlight("p1")).toBe(1);
    if (!a.ok) return;
    expect(a.limits).toMatchObject({ cpuMs: 50, subRequests: 50 });
    await a.release();
    await a.release(); // dos veces no cuenta dos
    expect(o.limiter.inFlight("p1")).toBe(0);
    expect(o.usage.pools.get("2026-10|free")).toEqual({ reserved: 0, spent: peor });
    expect(o.usage.projectNanoUsd.get("p1|2026-10")).toBe(peor);
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

  it("🔴 la bolsa: reserva y liquida el PEOR caso; sin hueco no se llama y la llamada se devuelve", async () => {
    const peor = callCostNanoUsd(FUNCTION_LIMITS.free.cpuMs);
    const o = { ...base(), caps: { free: peor * 2, paid: 1e15 } };
    const a = await admit(o);
    const b = await admit({ ...o, projectId: "p2" });
    expect(a.ok && b.ok).toBe(true);
    expect(await admit({ ...o, projectId: "p3" })).toEqual({ ok: false, reason: "cap" });
    expect(o.usage.calls.get("p3|2026-10") ?? 0).toBe(0);
    // Soltar no deja hueco: lo liquidado es lo que se reservó.
    if (a.ok) await a.release();
    expect(await admit({ ...o, projectId: "p3" })).toEqual({ ok: false, reason: "cap" });
  });

  it("los planes de pago van a su bolsa: Gratis llena no los toca", async () => {
    const o = { ...base(), caps: { free: 0, paid: 1e15 } };
    expect(await admit(o)).toEqual({ ok: false, reason: "cap" });
    expect((await admit({ ...o, plan: "pro" })).ok).toBe(true);
  });
});

describe("los avisos (fase 3)", () => {
  it("🔴 la cuota: avisa UNA vez al llegar al 80 % y otra al 100 %; la que ya no entra, no", async () => {
    const avisos: unknown[] = [];
    const o = { ...base(), alerts: { quota: (a: unknown) => void avisos.push(a) } };
    const q = FUNCTION_LIMITS.free.callsPerMonth;
    const ochenta = Math.ceil(q * 0.8);
    o.usage.calls.set("p1|2026-10", ochenta - 2);
    for (let i = 0; i < 3; i++) {
      const a = await admit(o);
      if (a.ok) await a.release();
    }
    expect(avisos).toEqual([{ projectId: "p1", percent: 80, calls: ochenta, quota: q }]);
    o.usage.calls.set("p1|2026-10", q - 1);
    const ultima = await admit(o);
    if (ultima.ok) await ultima.release();
    expect(await admit(o)).toEqual({ ok: false, reason: "quota" });
    expect(avisos).toEqual([
      { projectId: "p1", percent: 80, calls: ochenta, quota: q },
      { projectId: "p1", percent: 100, calls: q, quota: q },
    ]);
  });

  it("una llamada que la bolsa rechaza se devuelve y no avisa: avisa la que entre", async () => {
    const avisos: unknown[] = [];
    const q = FUNCTION_LIMITS.free.callsPerMonth;
    const o = { ...base(), caps: { free: 0, paid: 1e15 }, alerts: { quota: (a: unknown) => void avisos.push(a) } };
    o.usage.calls.set("p1|2026-10", Math.ceil(q * 0.8) - 1);
    expect(await admit(o)).toEqual({ ok: false, reason: "cap" });
    expect(avisos).toEqual([]);
    const a = await admit({ ...o, caps: MUCHO });
    if (a.ok) await a.release();
    expect(avisos).toEqual([{ projectId: "p1", percent: 80, calls: Math.ceil(q * 0.8), quota: q }]);
  });

  it("🔴 la que llega justo al 80 % la rechaza la bolsa mientras otra ya pasó: avisa esa otra, y una sola vez", async () => {
    const avisos: unknown[] = [];
    const q = FUNCTION_LIMITS.free.callsPerMonth;
    const ochenta = Math.ceil(q * 0.8);
    const usage = memoryUsageStore();
    let primera = true;
    const o = {
      ...base(),
      usage: { ...usage, reserve: async (...a: Parameters<typeof usage.reserve>) => (primera ? ((primera = false), false) : usage.reserve(...a)) },
      alerts: { quota: (a: unknown) => void avisos.push(a) },
    };
    usage.calls.set("p1|2026-10", ochenta - 1);
    const [a, b] = await Promise.all([admit(o), admit(o)]);
    expect(a).toEqual({ ok: false, reason: "cap" });
    expect(b.ok).toBe(true);
    if (b.ok) await b.release();
    const c = await admit(o);
    if (c.ok) await c.release();
    expect(avisos).toEqual([{ projectId: "p1", percent: 80, calls: ochenta + 1, quota: q }]);
  });

  it("🔴 la bolsa: UN aviso al mes cuando lo gastado pasa del 80 % del tope", async () => {
    const avisos: unknown[] = [];
    const peor = callCostNanoUsd(FUNCTION_LIMITS.free.cpuMs);
    const cap = peor * 10;
    const o = { ...base(), caps: { free: cap, paid: 1e15 }, alerts: { pool: (a: unknown) => void avisos.push(a) } };
    const antes = Math.floor(cap * 0.8) - 10;
    o.usage.pools.set("2026-10|free", { reserved: 0, spent: antes });
    const a = await admit(o);
    if (a.ok) await a.release();
    const b = await admit({ ...o, projectId: "p2" });
    if (b.ok) await b.release();
    expect(avisos).toEqual([{ pool: "free", month: "2026-10", spentNanoUsd: antes + peor, capNanoUsd: cap }]);
  });
});
