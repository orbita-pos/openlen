import { describe, expect, test, vi } from "vitest";
import { formatPct, getUptimeBadge, pickWindow } from "./uptime";

const U = (d1: number | null, d7: number | null, d90: number | null) => ({ d1, d7, d90 });
const targets = (a: ReturnType<typeof U>, p: ReturnType<typeof U>, i: ReturnType<typeof U>) => ({
  app: { status: "up" as const, uptime: a },
  pages: { status: "up" as const, uptime: p },
  api: { status: "up" as const, uptime: i },
});

describe("formatPct (floor a 2 decimales — jamás inflar)", () => {
  test("casos del spec", () => {
    expect(formatPct(100)).toBe("100%");
    expect(formatPct(99.95)).toBe("99.95%");
    expect(formatPct(99.996)).toBe("99.99%"); // nunca "100%"
    expect(formatPct(99.9)).toBe("99.9%");
  });
});

describe("pickWindow (ventana más larga con los 3 targets completos)", () => {
  test("d90 completo gana y toma el mínimo", () => {
    const r = pickWindow(targets(U(100, 100, 99.98), U(100, 99.95, 99.9), U(100, 100, 100)));
    expect(r).toEqual({ window: "d90", min: 99.9 });
  });

  test("d90 con un null cae a d7", () => {
    const r = pickWindow(targets(U(100, 99.9, null), U(100, 100, 100), U(100, 100, 100)));
    expect(r).toEqual({ window: "d7", min: 99.9 });
  });

  test("solo d1 completo", () => {
    const r = pickWindow(targets(U(100, null, null), U(99.65, null, null), U(100, null, null)));
    expect(r).toEqual({ window: "d1", min: 99.65 });
  });

  test("nada completo → null", () => {
    expect(pickWindow(targets(U(null, null, null), U(100, 100, 100), U(100, 100, 100)))).toBeNull();
  });
});

describe("getUptimeBadge", () => {
  const summary = (overall: "up" | "degraded") => ({
    overall,
    targets: targets(U(100, 100, 100), U(100, 100, 99.95), U(100, 100, 100)),
    generatedAt: 0,
  });

  test("summary sano → badge con mínimo d90", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(summary("up")), { status: 200 }));
    const b = await getUptimeBadge(fetcher as typeof fetch);
    expect(b).toEqual({ pct: "99.95%", window: "d90", up: true });
  });

  test("degraded → up:false (el número se muestra igual)", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(summary("degraded")), { status: 200 }));
    const b = await getUptimeBadge(fetcher as typeof fetch);
    expect(b?.up).toBe(false);
    expect(b?.pct).toBe("99.95%");
  });

  test("HTTP no-200 → null; excepción de red → null; JSON inválido → null", async () => {
    expect(await getUptimeBadge((async () => new Response("x", { status: 503 })) as typeof fetch)).toBeNull();
    expect(await getUptimeBadge((async () => { throw new Error("net"); }) as unknown as typeof fetch)).toBeNull();
    expect(await getUptimeBadge((async () => new Response("<html>", { status: 200 })) as typeof fetch)).toBeNull();
  });
});
