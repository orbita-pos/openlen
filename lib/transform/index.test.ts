import { describe, it, expect, vi, afterEach } from "vitest";
import { transformIngestedHtml } from "./index";
import type { RunPage } from "./bake";

const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

const PAGE = doc(
  `<div id="grid"></div><script>document.getElementById("grid").innerHTML="x";</script>`,
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("transformIngestedHtml — orquestador never-throw", () => {
  it("kill-switch apagado → html intacto, fallback='disabled', runPage ni se llama", async () => {
    vi.stubEnv("OPENLEN_TRANSFORM", "0");
    const spy = vi.fn<RunPage>(async () => ({ containers: {}, geoms: {} }));
    const out = await transformIngestedHtml(PAGE, { runPage: spy });
    expect(out.html).toBe(PAGE);
    expect(out.report.fallback).toBe("disabled");
    expect(spy).not.toHaveBeenCalled();
  });

  it("flujo feliz: bake + translate componen y el report cuenta", async () => {
    const fake: RunPage = async () => ({ containers: { "0": "<b>vivo</b>" }, geoms: {} });
    const out = await transformIngestedHtml(PAGE, { runPage: fake });
    expect(out.html).toContain("<b>vivo</b>");
    expect(out.report.bakedContainers).toBe(1);
    expect(out.report.fallback).toBeUndefined();
    expect(out.report.ms).toBeGreaterThanOrEqual(0);
  });

  it("runPage LANZA → html ORIGINAL intacto y fallback con el motivo (never-throw)", async () => {
    const fake: RunPage = async () => {
      throw new Error("chrome exploded");
    };
    const out = await transformIngestedHtml(PAGE, { runPage: fake });
    expect(out.html).toBe(PAGE);
    expect(out.report.fallback).toContain("chrome exploded");
  });

  it("presupuesto vencido → fallback por timeout, jamás cuelga la request", async () => {
    const never: RunPage = () => new Promise(() => {});
    const out = await transformIngestedHtml(PAGE, { runPage: never, timeoutMs: 50 });
    expect(out.html).toBe(PAGE);
    expect(out.report.fallback).toMatch(/timeout/i);
  });

  it("telemetría: UNA línea estructurada solo cuando transformó algo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake: RunPage = async () => ({ containers: { "0": "<b>x</b>" }, geoms: {} });
    await transformIngestedHtml(PAGE, { runPage: fake });
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes("[transform]"));
    expect(lines).toHaveLength(1);

    warn.mockClear();
    await transformIngestedHtml(doc("<h1>nada que hacer</h1>"), { runPage: fake });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("[transform]"))).toHaveLength(0);
  });
});
