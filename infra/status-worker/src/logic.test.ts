import { describe, expect, test } from "vitest";
import {
  RUN_MS,
  dayCells,
  incidentsFromFailures,
  nextState,
  uptimePct,
  type TargetState,
} from "./logic";

const NOW = 1_800_000_000_000;

describe("nextState (anti-flapping: 2 fallos = down, 1 éxito = up)", () => {
  test("primer run de la vida (prev null) exitoso → up sin transición", () => {
    const r = nextState(null, true, NOW);
    expect(r.state).toEqual({ status: "up", since: NOW, fails: 0 });
    expect(r.transition).toBeNull();
  });

  test("un solo fallo NO tumba (queda up con fails=1)", () => {
    const prev: TargetState = { status: "up", since: NOW - 10 * RUN_MS, fails: 0 };
    const r = nextState(prev, false, NOW);
    expect(r.state.status).toBe("up");
    expect(r.state.fails).toBe(1);
    expect(r.transition).toBeNull();
  });

  test("segundo fallo consecutivo → down + transición went_down", () => {
    const prev: TargetState = { status: "up", since: NOW - 10 * RUN_MS, fails: 1 };
    const r = nextState(prev, false, NOW);
    expect(r.state).toEqual({ status: "down", since: NOW, fails: 2 });
    expect(r.transition).toBe("went_down");
  });

  test("fallo estando ya down → sigue down, sin transición duplicada", () => {
    const prev: TargetState = { status: "down", since: NOW - 2 * RUN_MS, fails: 2 };
    const r = nextState(prev, false, NOW);
    expect(r.state.status).toBe("down");
    expect(r.state.since).toBe(prev.since); // el inicio de la caída no se mueve
    expect(r.transition).toBeNull();
  });

  test("éxito estando down → up inmediato + recovered", () => {
    const prev: TargetState = { status: "down", since: NOW - 4 * RUN_MS, fails: 5 };
    const r = nextState(prev, true, NOW);
    expect(r.state).toEqual({ status: "up", since: NOW, fails: 0 });
    expect(r.transition).toBe("recovered");
  });

  test("éxito tras 1 fallo aislado → resetea fails sin transición", () => {
    const prev: TargetState = { status: "up", since: NOW - 10 * RUN_MS, fails: 1 };
    const r = nextState(prev, true, NOW);
    expect(r.state.fails).toBe(0);
    expect(r.state.since).toBe(prev.since); // sigue el mismo periodo up
    expect(r.transition).toBeNull();
  });
});

describe("dayCells", () => {
  const today = new Date(NOW).toISOString().slice(0, 10);
  const yesterday = new Date(NOW - 86_400_000).toISOString().slice(0, 10);

  test("día sin filas → empty; con fallos <60min → degraded; ≥60min → outage", () => {
    const rows = [
      { day: today, total: 288, failed: 2 },      // 10 min down → degraded
      { day: yesterday, total: 288, failed: 12 }, // 60 min down → outage
    ];
    const cells = dayCells(rows, 3, NOW);
    expect(cells).toHaveLength(3);
    expect(cells[0].state).toBe("empty"); // anteayer: sin datos
    expect(cells[1]).toEqual({ day: yesterday, state: "outage" });
    expect(cells[2]).toEqual({ day: today, state: "degraded" });
  });

  test("día limpio → ok; el orden es cronológico (viejo → hoy)", () => {
    const cells = dayCells([{ day: today, total: 288, failed: 0 }], 2, NOW);
    expect(cells[1]).toEqual({ day: today, state: "ok" });
    expect(cells[0].day).toBe(yesterday);
  });
});

describe("uptimePct", () => {
  test("sin datos → null; floor a 2 decimales — jamás redondear hacia arriba", () => {
    expect(uptimePct(0, 0)).toBeNull();
    expect(uptimePct(288, 285)).toBe(98.95); // 98.9583… trunca, no redondea
    expect(uptimePct(288, 288)).toBe(100);
    // 1 fallo en 90 días (25920 checks) = 99.9961% — con round mentía "100".
    expect(uptimePct(25920, 25919)).toBe(99.99);
  });
});

describe("incidentsFromFailures", () => {
  test("un fallo aislado NO es incidente; 2+ consecutivos sí, con duración = n×5min", () => {
    const t0 = NOW - 100 * RUN_MS;
    const failures = [
      { ts: t0, target: "app" as const },                    // aislado → no
      { ts: t0 + 10 * RUN_MS, target: "api" as const },      // ventana de 3 runs
      { ts: t0 + 11 * RUN_MS, target: "api" as const },
      { ts: t0 + 12 * RUN_MS, target: "api" as const },
    ];
    const inc = incidentsFromFailures(failures);
    expect(inc).toHaveLength(1);
    expect(inc[0]).toEqual({
      target: "api",
      start: t0 + 10 * RUN_MS,
      end: t0 + 12 * RUN_MS + RUN_MS,
      durationMin: 15,
    });
  });

  test("gap grande separa ventanas; salen ordenadas recientes-primero", () => {
    const t0 = NOW - 100 * RUN_MS;
    const failures = [
      { ts: t0, target: "app" as const },
      { ts: t0 + RUN_MS, target: "app" as const },
      { ts: t0 + 50 * RUN_MS, target: "app" as const },
      { ts: t0 + 51 * RUN_MS, target: "app" as const },
    ];
    const inc = incidentsFromFailures(failures);
    expect(inc).toHaveLength(2);
    expect(inc[0].start).toBe(t0 + 50 * RUN_MS);
    expect(inc[1].start).toBe(t0);
  });
});
