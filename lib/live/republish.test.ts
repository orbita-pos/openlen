import { describe, it, expect, vi, afterEach } from "vitest";
import { runLiveRepublish, type RepublishDeps, type RepublishTarget } from "./republish";
import type { SheetData } from "./sheet-source";

const sheet = (rows: Record<string, string>[]): SheetData => ({ values: new Map(), rows });

const target = (over: Partial<RepublishTarget> = {}): RepublishTarget => ({
  projectId: "p1",
  userId: "u1",
  subdomain: "s1",
  valueSheetUrl: null,
  collections: [],
  ...over,
});

function deps(over: Partial<RepublishDeps> = {}): RepublishDeps {
  return {
    listTargets: vi.fn(async () => [target()]),
    fetchSheet: vi.fn(async () => sheet([{ nombre: "Taco", precio: "45" }])),
    syncCollection: vi.fn(async () => ({})),
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

  it("sincroniza las colecciones sheet-backed y republica cada proyecto", async () => {
    const d = deps({
      listTargets: vi.fn(async () => [
        target({ projectId: "p1", collections: [{ collectionId: "c1", sheetUrl: "https://s/1" }] }),
      ]),
    });
    const r = await runLiveRepublish(d);
    expect(d.fetchSheet).toHaveBeenCalledWith("https://s/1");
    expect(d.syncCollection).toHaveBeenCalledWith("p1", "c1", [{ nombre: "Taco", precio: "45" }]);
    expect(d.republish).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ processed: 1, synced: 1, failures: 0 });
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

  it("Sheet de colección roto → avisa al dueño y republica IGUAL (no cuenta como failure del proyecto)", async () => {
    const notifyBroken = vi.fn(async () => {});
    const d = deps({
      listTargets: vi.fn(async () => [
        target({ projectId: "p1", collections: [{ collectionId: "c1", sheetUrl: "https://roto" }] }),
      ]),
      fetchSheet: vi.fn(async () => {
        throw new Error("timeout");
      }),
      notifyBroken,
    });
    const r = await runLiveRepublish(d);
    expect(notifyBroken).toHaveBeenCalledTimes(1);
    expect((notifyBroken.mock.calls[0] as unknown as [unknown, string, string])[1]).toBe("https://roto");
    expect(d.republish).toHaveBeenCalledTimes(1); // republica igual
    expect(r.processed).toBe(1);
    expect(r.synced).toBe(0);
    expect(r.failures).toBe(0); // el Sheet roto NO es un failure del proyecto
  });

  it("dedup: dos proyectos que comparten la MISMA URL de Sheet la fetchean una vez", async () => {
    const d = deps({
      listTargets: vi.fn(async () => [
        target({ projectId: "p1", collections: [{ collectionId: "c1", sheetUrl: "https://shared" }] }),
        target({ projectId: "p2", collections: [{ collectionId: "c2", sheetUrl: "https://shared" }] }),
      ]),
    });
    await runLiveRepublish(d);
    expect(d.fetchSheet).toHaveBeenCalledTimes(1);
    // pero AMBAS colecciones se sincronizan (con los mismos rows cacheados)
    expect(d.syncCollection).toHaveBeenCalledTimes(2);
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

  it("una colección y el value-binding con la MISMA URL comparten el fetch (no doble red)", async () => {
    const d = deps({
      listTargets: vi.fn(async () => [
        target({
          projectId: "p1",
          valueSheetUrl: "https://shared-both",
          collections: [{ collectionId: "c1", sheetUrl: "https://shared-both" }],
        }),
      ]),
    });
    await runLiveRepublish(d);
    expect(d.fetchSheet).toHaveBeenCalledTimes(1);
    // El fetch compartido no debe COSTAR funcionalidad: la colección se
    // sincroniza igual y el proyecto se republica.
    expect(d.syncCollection).toHaveBeenCalledWith("p1", "c1", expect.any(Array));
    expect(d.republish).toHaveBeenCalledTimes(1);
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
});
