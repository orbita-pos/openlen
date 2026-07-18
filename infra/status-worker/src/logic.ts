// Lógica pura del monitor — sin fetch, sin D1, sin tipos de Workers.
// Todo lo testeable vive aquí; index.ts solo orquesta.

export type Target = "app" | "pages" | "api";
export const TARGETS: readonly Target[] = ["app", "pages", "api"] as const;
export const RUN_MS = 5 * 60_000;

export interface CheckResult {
  target: Target;
  ok: boolean;
  status: number | null;
  latencyMs: number;
}

export interface TargetState {
  status: "up" | "down";
  since: number;
  fails: number;
}

export interface StepResult {
  state: TargetState;
  transition: "went_down" | "recovered" | null;
}

const FAILS_TO_DOWN = 2;

export function nextState(prev: TargetState | null, ok: boolean, now: number): StepResult {
  const p: TargetState = prev ?? { status: "up", since: now, fails: 0 };
  if (ok) {
    if (p.status === "down") {
      return { state: { status: "up", since: now, fails: 0 }, transition: "recovered" };
    }
    return { state: { ...p, fails: 0 }, transition: null };
  }
  const fails = p.fails + 1;
  if (p.status === "up" && fails >= FAILS_TO_DOWN) {
    return { state: { status: "down", since: now, fails }, transition: "went_down" };
  }
  return { state: { ...p, fails }, transition: null };
}

export type DayState = "ok" | "degraded" | "outage" | "empty";
export interface DayCell {
  day: string; // YYYY-MM-DD (UTC)
  state: DayState;
}

// Cada run cubre ~5 min; failed runs × 5 aproxima minutos caídos del día.
export function dayCells(
  rows: Array<{ day: string; total: number; failed: number }>,
  days: number,
  now: number,
): DayCell[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: DayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    if (!r || r.total === 0) {
      out.push({ day, state: "empty" });
      continue;
    }
    const downMin = r.failed * 5;
    out.push({ day, state: downMin >= 60 ? "outage" : r.failed > 0 ? "degraded" : "ok" });
  }
  return out;
}

export function uptimePct(total: number, okCount: number): number | null {
  if (total === 0) return null;
  // Floor, no round: un solo check fallido en 90 días es 99.9961% y con
  // round se mostraba "100%" — el claim conservador exige truncar. La
  // sección de confianza del home hereda este número tal cual.
  return Math.floor((okCount / total) * 10000) / 100;
}

export interface Incident {
  target: Target;
  start: number;
  end: number;
  durationMin: number;
}

// Deriva ventanas de caída de los runs FALLIDOS (pocas filas): fallos con gap
// ≤ 1.5 runs son la misma ventana; una ventana necesita ≥2 runs para contar
// como incidente (espejo del umbral de nextState).
export function incidentsFromFailures(
  failures: Array<{ ts: number; target: Target }>,
): Incident[] {
  const byTarget = new Map<Target, number[]>();
  for (const f of failures) {
    const list = byTarget.get(f.target) ?? [];
    list.push(f.ts);
    byTarget.set(f.target, list);
  }
  const out: Incident[] = [];
  for (const [target, tss] of byTarget) {
    tss.sort((a, b) => a - b);
    let start = -1;
    let prev = -1;
    let count = 0;
    const flush = () => {
      if (count >= 2) {
        out.push({ target, start, end: prev + RUN_MS, durationMin: count * 5 });
      }
      start = -1;
      count = 0;
    };
    for (const ts of tss) {
      if (start === -1) {
        start = ts;
        prev = ts;
        count = 1;
        continue;
      }
      if (ts - prev <= RUN_MS * 1.5) {
        prev = ts;
        count++;
      } else {
        flush();
        start = ts;
        prev = ts;
        count = 1;
      }
    }
    flush();
  }
  return out.sort((a, b) => b.start - a.start);
}
