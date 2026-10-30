// El sondeo de un proyecto (poller.ts) con una fuente doble: su cadencia, y que
// una apertura o una lectura que falla (la conexión del slot se cayó, y el slot
// temporal con ella) se reintenta con el backoff de su ReplicationPoller
// (`retry_or_stop`) en vez de fallar para siempre.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPoller, type ChangeRow, type ChangeSource, type Listed } from "./poller";

const fila = (n: number): ChangeRow => ({
  type: "INSERT",
  schema: "public",
  table: "t",
  columns: "[]",
  record: JSON.stringify({ n }),
  old_record: "{}",
  commit_timestamp: null,
  subscription_ids: ["s"],
  errors: null,
});

const TIMING = { pollIntervalMs: 5, maxChanges: 100, maxRecordBytes: 1000 };
const EMPTY: Listed = { rows: [], slotChangesCount: 0 };

describe("ProjectPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("una lectura que falla cierra la fuente, la vuelve a abrir tras su backoff y sigue entregando", async () => {
    const pasos: string[] = [];
    const respuestas: (Listed | Error)[] = [new Error("se cayó la conexión"), { rows: [fila(1)], slotChangesCount: 1 }];
    const fuente: ChangeSource = {
      open: async () => {
        pasos.push("open");
      },
      close: async () => {
        pasos.push("close");
      },
      listChanges: async () => {
        const r = respuestas.shift() ?? EMPTY;
        pasos.push("list");
        if (r instanceof Error) throw r;
        return r;
      },
    };
    const vistas: ChangeRow[] = [];
    const p = new ProjectPoller(fuente, (r) => vistas.push(r), TIMING, () => {});
    p.start();
    await vi.advanceTimersByTimeAsync(1000);
    await p.stop();
    expect(pasos.slice(0, 5)).toEqual(["open", "list", "close", "open", "list"]);
    expect(vistas.map((r) => JSON.parse(r.record))).toEqual([{ n: 1 }]);
  });

  it("🔴 una apertura que falla se cierra y se reintenta; al abrir, sondea y entrega", async () => {
    const steps: string[] = [];
    let failures = 2;
    const answers: Listed[] = [{ rows: [fila(1)], slotChangesCount: 1 }];
    const source: ChangeSource = {
      open: async () => {
        steps.push("open");
        if (failures-- > 0) throw new Error("no se pudo crear el slot");
      },
      close: async () => {
        steps.push("close");
      },
      listChanges: async () => {
        steps.push("list");
        return answers.shift() ?? EMPTY;
      },
    };
    const seen: ChangeRow[] = [];
    const p = new ProjectPoller(source, (r) => seen.push(r), TIMING, () => {});
    p.start();
    await vi.advanceTimersByTimeAsync(2000);
    await p.stop();
    expect(steps.slice(0, 6)).toEqual(["open", "close", "open", "close", "open", "list"]);
    expect(seen.map((r) => JSON.parse(r.record))).toEqual([{ n: 1 }]);
  });

  it("🔴 los reintentos llevan su backoff (`rand_exp` de DBConnection, 100 ms–5 s) y tras 6 se rinde", async () => {
    // El azar en su máximo: cada espera es el techo de su intervalo.
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const opens: number[] = [];
    const source: ChangeSource = {
      open: async () => {
        opens.push(Date.now());
        throw new Error("no se pudo crear el slot");
      },
      close: async () => {},
      listChanges: async () => EMPTY,
    };
    let gaveUp = 0;
    const p = new ProjectPoller(source, () => {}, TIMING, () => {}, { onGaveUp: () => gaveUp++ });
    const t0 = Date.now();
    p.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opens.map((t, i) => t - (i === 0 ? t0 : opens[i - 1]!))).toEqual([0, 300, 900, 2700, 5000, 5000, 5000]);
    expect(gaveUp).toBe(1);
    await p.stop();
  });

  // Su `prepare_replication` bueno deja `retry_count: 0`: tras él, una lectura
  // que falla gasta un reintento y quedan 5 aperturas que pueden fallar.
  it("🔴 una apertura buena reinicia la cuenta de reintentos", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const plan: ("fail" | "open")[] = [...Array<"fail">(6).fill("fail"), "open", ...Array<"fail">(5).fill("fail"), "open"];
    const answers: (Listed | Error)[] = [new Error("se cayó la conexión")];
    const steps: string[] = [];
    const source: ChangeSource = {
      open: async () => {
        const step = plan.shift() ?? "open";
        steps.push(step);
        if (step === "fail") throw new Error("no se pudo crear el slot");
      },
      close: async () => {},
      listChanges: async () => {
        steps.push("list");
        const r = answers.shift() ?? EMPTY;
        if (r instanceof Error) throw r;
        return r;
      },
    };
    let gaveUp = 0;
    const p = new ProjectPoller(source, () => {}, TIMING, () => {}, { onGaveUp: () => gaveUp++ });
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await p.stop();
    expect(gaveUp).toBe(0);
    expect(steps.filter((x) => x === "open")).toHaveLength(2);
    expect(steps.at(-1)).toBe("list");
  });

  it("🔴 parar no se cuelga en una apertura que no acaba; si acaba luego, suelta lo que abrió", async () => {
    const steps: string[] = [];
    let finishOpen!: () => void;
    const source: ChangeSource = {
      open: () => {
        steps.push("open");
        return new Promise<void>((r) => (finishOpen = r));
      },
      close: async () => {
        steps.push("close");
      },
      listChanges: async () => {
        steps.push("list");
        return EMPTY;
      },
    };
    const p = new ProjectPoller(source, () => {}, TIMING, () => {});
    p.start();
    let stopped = false;
    void p.stop().then(() => (stopped = true));
    // El `shutdown` por defecto de un hijo de OTP: 5 s y fuera.
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopped).toBe(true);
    expect(steps).toEqual(["open", "close"]);
    finishOpen();
    await vi.advanceTimersByTimeAsync(1000);
    expect(steps).toEqual(["open", "close", "close"]);
  });

  it("parado antes de arrancar (esperaba al slot del anterior), no abre la fuente", async () => {
    const pasos: string[] = [];
    const fuente: ChangeSource = {
      open: async () => {
        pasos.push("open");
      },
      close: async () => {
        pasos.push("close");
      },
      listChanges: async () => {
        pasos.push("list");
        return EMPTY;
      },
    };
    const p = new ProjectPoller(fuente, () => {}, TIMING, () => {});
    await p.stop();
    p.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(pasos).not.toContain("open");
    expect(pasos).not.toContain("list");
  });
});
