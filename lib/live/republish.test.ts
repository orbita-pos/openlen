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
});
