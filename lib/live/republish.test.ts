import { describe, it, expect, vi, afterEach } from "vitest";
import { runLiveRepublish, type RepublishDeps, type RepublishTarget } from "./republish";
import type { SheetData } from "./sheet-source";

const sheet = (rows: Record<string, string>[]): SheetData => ({ values: new Map(), rows });

const target = (over: Partial<RepublishTarget> = {}): RepublishTarget => ({
  projectId: "p1",
  userId: "u1",
  subdomain: "s1",
  valueSheetUrl: null,
  ...over,
});

function deps(over: Partial<RepublishDeps> = {}): RepublishDeps {
  return {
    listTargets: vi.fn(async () => [target()]),
    fetchSheet: vi.fn(async () => sheet([{ nombre: "Taco", precio: "45" }])),
    republish: vi.fn(async () => ({})),
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runLiveRepublish", () => {
  it("kill-switch apagado → no-op total, ni siquiera lista los targets", async () => {
    vi.stubEnv("OPENLEN_LIVE_DATA", "0");
    const d = deps();
    const r = await runLiveRepublish(d);
    expect(r).toEqual({ processed: 0, synced: 0, failures: 0 });
    expect(d.listTargets).not.toHaveBeenCalled();
  });


  it("un proyecto que falla NO detiene a los demás", async () => {
    const republish = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({});
    const d = deps({
      listTargets: vi.fn(async () => [target({ projectId: "malo" }), target({ projectId: "bueno" })]),
      republish,
    });
    const r = await runLiveRepublish(d);
    expect(republish).toHaveBeenCalledTimes(2);
    expect(r.processed).toBe(1);
    expect(r.failures).toBe(1);
  });

  it("respeta el TOPE por corrida", async () => {
    const many = Array.from({ length: 300 }, (_, i) => target({ projectId: `p${i}` }));
    const d = deps({ listTargets: vi.fn(async () => many), maxPerRun: 2 });
    const r = await runLiveRepublish(d);
    expect(r.processed).toBe(2);
    expect(d.republish).toHaveBeenCalledTimes(2);
  });



  // Finding #2 del review final — el value-binding (t.valueSheetUrl) vivía SIN
  // ningún path a notifyBroken: applyLiveData es never-throw y solo hace
  // console.warn, así que una página con SOLO intent="valores" nunca avisaba
  // al dueño cuando su Sheet se rompía. El probe de abajo cierra ese hueco.
  it("Sheet de value-binding roto → avisa al dueño y republica IGUAL (never-worse-than-today)", async () => {
    const notifyBroken = vi.fn(async () => {});
    const d = deps({
      listTargets: vi.fn(async () => [target({ projectId: "p1", valueSheetUrl: "https://roto-valores" })]),
      fetchSheet: vi.fn(async () => {
        throw new Error("timeout");
      }),
      notifyBroken,
    });
    const r = await runLiveRepublish(d);
    expect(notifyBroken).toHaveBeenCalledTimes(1);
    expect((notifyBroken.mock.calls[0] as unknown as [unknown, string, string])[1]).toBe(
      "https://roto-valores",
    );
    expect(d.republish).toHaveBeenCalledTimes(1); // republica igual — la página conserva su último valor
    expect(r.processed).toBe(1);
    expect(r.failures).toBe(0); // el Sheet roto NO es un failure del proyecto
  });

  it("Sheet de value-binding sano → sin aviso, republica normal", async () => {
    const notifyBroken = vi.fn(async () => {});
    const d = deps({
      listTargets: vi.fn(async () => [target({ projectId: "p1", valueSheetUrl: "https://sano-valores" })]),
      notifyBroken,
    });
    const r = await runLiveRepublish(d);
    expect(notifyBroken).not.toHaveBeenCalled();
    expect(d.fetchSheet).toHaveBeenCalledWith("https://sano-valores");
    expect(d.republish).toHaveBeenCalledTimes(1);
    expect(r.processed).toBe(1);
    // El probe de valores no escribe nada en una tabla — no se cuenta como
    // "synced" (ese contador sigue siendo solo colecciones).
    expect(r.synced).toBe(0);
  });

  it("value-binding sano calienta warmCache para que el republish que sigue no repita la red", async () => {
    const warmCache = vi.fn(async (_url: string, _data: SheetData) => {});
    const d = deps({
      listTargets: vi.fn(async () => [target({ projectId: "p1", valueSheetUrl: "https://sano-valores" })]),
      warmCache,
    });
    await runLiveRepublish(d);
    expect(warmCache).toHaveBeenCalledTimes(1);
    expect(warmCache.mock.calls[0][0]).toBe("https://sano-valores");
  });


  it("falta notifyBroken en deps → el probe roto solo loguea, sigue republicando", async () => {
    const d = deps({
      listTargets: vi.fn(async () => [target({ projectId: "p1", valueSheetUrl: "https://roto-sin-notify" })]),
      fetchSheet: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await runLiveRepublish(d);
    expect(d.republish).toHaveBeenCalledTimes(1);
    expect(r.failures).toBe(0);
  });

  // ⚰️ Aquí había pruebas de la sincronización de COLECCIONES desde su Sheet:
  // que se sincronizara antes de republicar, que el fallo de un Sheet no
  // abortara el proyecto, y que un Sheet compartido por dos proyectos se
  // descargara una sola vez. Se van el 2026-08-29 con las colecciones; lo que
  // queda —los data-ol-live— nunca dependíó de ellas.
});
