// EL PLANIFICADOR DE LAS LLAMADAS DE UNA VUELTA (pieza 4, como DeepSeek): grupos
// y barreras, pool rodante con tope, pre y post en el orden del modelo, ■ y fallos.
import { describe, expect, it } from "vitest";
import { scheduleToolCalls, type Prepared } from "./tool-scheduler";

type Call = { id: string; par: boolean; ms?: number };
const c = (id: string, par: boolean, ms = 5): Call => ({ id, par, ms });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

function montaje(calls: Call[], extra: { maxParallel?: number; signal?: AbortSignal; onStart?: (id: string) => void } = {}) {
  const log: string[] = [];
  let enVuelo = 0;
  let maxEnVuelo = 0;
  const exclusivaSola: boolean[] = [];
  const run = (call: Call) => async () => {
    enVuelo++;
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    if (!call.par) exclusivaSola.push(enVuelo === 1);
    log.push(`empieza ${call.id}`);
    extra.onStart?.(call.id);
    await pausa(call.ms ?? 5);
    enVuelo--;
    log.push(`acaba ${call.id}`);
    return `r-${call.id}`;
  };
  const opts = {
    calls,
    maxParallel: extra.maxParallel ?? 10,
    signal: extra.signal,
    isParallel: (call: Call) => call.par,
    prepare: (call: Call): Prepared<string> => {
      log.push(`pre ${call.id}`);
      return { kind: "dispatch", run: run(call) };
    },
    commit: (call: Call, _i: number, v: string) => {
      log.push(`post ${call.id} ${v}`);
    },
    skip: (call: Call) => {
      log.push(`abortada ${call.id}`);
    },
  };
  return { opts, log, stats: () => ({ maxEnVuelo, exclusivaSola }) };
}

describe("scheduleToolCalls", () => {
  it("las seguras seguidas a la vez; cada exclusiva es una barrera (el ejemplo de la nota de DeepSeek)", async () => {
    const { opts, log, stats } = montaje([c("readA", true), c("readB", true), c("writeA", false), c("readC", true)]);
    expect(await scheduleToolCalls(opts)).toEqual({ aborted: false, stopped: false });
    expect(log.indexOf("empieza readB")).toBeLessThan(log.indexOf("acaba readA"));
    expect(log.indexOf("empieza writeA")).toBeGreaterThan(log.indexOf("acaba readB"));
    expect(log.indexOf("empieza readC")).toBeGreaterThan(log.indexOf("acaba writeA"));
    expect(stats().maxEnVuelo).toBe(2);
    expect(stats().exclusivaSola).toEqual([true]);
  });

  it("los resultados se confirman en el orden del modelo aunque acaben al revés", async () => {
    const { opts, log } = montaje([c("lenta", true, 40), c("rapida", true, 1)]);
    await scheduleToolCalls(opts);
    expect(log.filter((l) => l.startsWith("post"))).toEqual(["post lenta r-lenta", "post rapida r-rapida"]);
    expect(log.indexOf("acaba rapida")).toBeLessThan(log.indexOf("acaba lenta"));
  });

  it("las guardas (pre) también van en el orden del modelo, y antes de empezar cada una", async () => {
    const { opts, log } = montaje([c("a", true), c("b", true), c("x", false)]);
    await scheduleToolCalls(opts);
    expect(log.filter((l) => l.startsWith("pre"))).toEqual(["pre a", "pre b", "pre x"]);
    expect(log.indexOf("pre b")).toBeLessThan(log.indexOf("empieza b"));
  });

  it("el pool es RODANTE: con tope 2, la tercera empieza en cuanto acaba UNA, sin esperar a la otra", async () => {
    const { opts, log, stats } = montaje([c("larga", true, 60), c("corta", true, 5), c("tercera", true, 5)], { maxParallel: 2 });
    await scheduleToolCalls(opts);
    expect(stats().maxEnVuelo).toBe(2);
    expect(log.indexOf("empieza tercera")).toBeGreaterThan(log.indexOf("acaba corta"));
    expect(log.indexOf("empieza tercera")).toBeLessThan(log.indexOf("acaba larga"));
  });

  it("tope 1 es en serie (brazo de control)", async () => {
    const { opts, stats } = montaje([c("a", true), c("b", true), c("d", true)], { maxParallel: 1 });
    await scheduleToolCalls(opts);
    expect(stats().maxEnVuelo).toBe(1);
  });

  it("se reclasifica la siguiente antes de reponer: si una confirmación la vuelve exclusiva, espera a que se vacíe el pool", async () => {
    // a y b empiezan juntas; al confirmar a, c deja de ser segura. Clasificada
    // una sola vez al principio, c habría empezado al acabar a, con b en vuelo.
    const { opts, log } = montaje([c("a", true, 5), c("b", true, 40), c("c", true, 5)], { maxParallel: 2 });
    let cambio = false;
    const commitBase = opts.commit;
    opts.commit = (call: Call, i: number, v: string) => {
      if (call.id === "a") cambio = true;
      commitBase(call, i, v);
    };
    opts.isParallel = (call: Call) => (call.id === "c" ? !cambio : call.par);
    await scheduleToolCalls(opts);
    expect(log.indexOf("empieza c")).toBeGreaterThan(log.indexOf("acaba b"));
  });

  it("una guarda que contesta sin ejecutar ('result') ocupa su sitio en el orden", async () => {
    const { opts, log } = montaje([c("a", true, 20), c("rechazada", true), c("b", true, 1)]);
    const prepareBase = opts.prepare;
    opts.prepare = (call: Call) => (call.id === "rechazada" ? { kind: "result", value: "no" } : prepareBase(call));
    await scheduleToolCalls(opts);
    expect(log.filter((l) => l.startsWith("post"))).toEqual(["post a r-a", "post rechazada no", "post b r-b"]);
  });

  it("'stop' (el tope): no empieza ésa ni las de detrás, confirma las empezadas y lo dice", async () => {
    const { opts, log } = montaje([c("a", true, 20), c("topa", true), c("detras", true)]);
    const prepareBase = opts.prepare;
    opts.prepare = (call: Call) => (call.id === "topa" ? { kind: "stop" } : prepareBase(call));
    expect(await scheduleToolCalls(opts)).toEqual({ aborted: false, stopped: true });
    expect(log).toContain("post a r-a");
    expect(log.some((l) => l.includes("topa") || l.includes("detras"))).toBe(false);
  });

  it("🔴 con el ■ a mitad de grupo: no empieza ninguna más, se esperan y confirman las empezadas, las demás 'abortadas' en orden", async () => {
    const ac = new AbortController();
    const { opts, log } = montaje([c("a", true, 30), c("b", true, 30), c("cola1", true), c("cola2", false)], {
      maxParallel: 2,
      signal: ac.signal,
      onStart: (id) => {
        if (id === "b") ac.abort();
      },
    });
    expect(await scheduleToolCalls(opts)).toEqual({ aborted: true, stopped: false });
    expect(log.filter((l) => l.startsWith("empieza"))).toEqual(["empieza a", "empieza b"]);
    expect(log.filter((l) => l.startsWith("post") || l.startsWith("abortada"))).toEqual([
      "post a r-a",
      "post b r-b",
      "abortada cola1",
      "abortada cola2",
    ]);
  });

  it("con el ■ ya dado antes de empezar, no empieza ninguna y todas salen abortadas", async () => {
    const ac = new AbortController();
    ac.abort();
    const { opts, log } = montaje([c("a", true), c("x", false)], { signal: ac.signal });
    expect(await scheduleToolCalls(opts)).toEqual({ aborted: true, stopped: false });
    expect(log).toEqual(["abortada a", "abortada x"]);
  });

  it("🔴 una que revienta: no empieza ninguna más, se espera a las empezadas y se relanza el primer error", async () => {
    const terminadas: string[] = [];
    const calls = [c("a", true), c("b", true), c("c", true)];
    let empezadas = 0;
    const p = scheduleToolCalls<Call, string>({
      calls,
      maxParallel: 2,
      isParallel: () => true,
      prepare: (call) => ({
        kind: "dispatch",
        run: async () => {
          empezadas++;
          if (call.id === "a") throw new Error("revienta");
          await pausa(30);
          terminadas.push(call.id);
          return call.id;
        },
      }),
      commit: () => undefined,
      skip: () => undefined,
    });
    await expect(p).rejects.toThrow("revienta");
    expect(terminadas).toEqual(["b"]);
    expect(empezadas).toBe(2);
  });

  it("un run que lanza de forma síncrona cuenta como fallo, no se escapa", async () => {
    const p = scheduleToolCalls<Call, string>({
      calls: [c("a", false)],
      maxParallel: 10,
      isParallel: () => false,
      prepare: () => ({
        kind: "dispatch",
        run: () => {
          throw new Error("síncrono");
        },
      }),
      commit: () => undefined,
      skip: () => undefined,
    });
    await expect(p).rejects.toThrow("síncrono");
  });
});
