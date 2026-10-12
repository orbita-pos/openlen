// @vitest-environment node
//
// EL DESPACHADOR (spec local 2026-10-12, Parte 3), en Node con un namespace
// simulado: miniflare no simula namespaces de Workers for Platforms sin
// conexión remota. Que corre en workerd lo dice el ensayo real.
import { describe, expect, it } from "vitest";

import dispatcher, { type DispatchNamespace } from "./dispatcher.mjs";

const KEY = "clave-de-prueba";
const SCRIPT = "openlen-abcdefghijklmnopqrst-draft";

function namespace(o: { respuesta?: () => Response; falla?: string } = {}) {
  const llamadas: { name: string; limits: unknown; body: string }[] = [];
  const ns: DispatchNamespace = {
    get(name, _args, options) {
      return {
        async fetch(_input, init) {
          llamadas.push({ name, limits: options.limits, body: String(init?.body) });
          if (o.falla) throw new Error(o.falla);
          return o.respuesta ? o.respuesta() : new Response('{"t":"end","ms":1}\n');
        },
      };
    },
  };
  return { ns, llamadas };
}

const cabeceras = (o: Record<string, string> = {}) => ({ "x-openlen-dispatch-key": KEY, "x-openlen-script": SCRIPT, "x-openlen-cpu-ms": "200", "x-openlen-subrequests": "1000", ...o });
const pedir = (h: Record<string, string>, method = "POST") =>
  new Request("https://openlen-dispatch.prueba.workers.dev/", { method, headers: h, ...(method === "POST" ? { body: '{"fn":"hola"}' } : {}) });
const marcos = async (r: Response) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);

describe("el despachador", () => {
  it("🔴 sin la clave, con otra o con GET: 403, y no llama a nada", async () => {
    const { ns, llamadas } = namespace();
    for (const req of [pedir(cabeceras({ "x-openlen-dispatch-key": "" })), pedir(cabeceras({ "x-openlen-dispatch-key": "otra" })), pedir(cabeceras(), "GET")]) {
      expect((await dispatcher.fetch(req, { DISPATCH_KEY: KEY, DISPATCHER: ns })).status).toBe(403);
    }
    expect((await dispatcher.fetch(pedir(cabeceras()), { DISPATCHER: ns })).status).toBe(403);
    expect(llamadas).toEqual([]);
  });

  it("con la clave: llama al script con los límites del plan y el evento, y devuelve su flujo tal cual", async () => {
    const { ns, llamadas } = namespace({ respuesta: () => new Response('{"t":"head","status":200,"headers":[]}\n{"t":"end","ms":2}\n', { headers: { "content-type": "application/x-ndjson" } }) });
    const r = await dispatcher.fetch(pedir(cabeceras()), { DISPATCH_KEY: KEY, DISPATCHER: ns });
    expect(r.status).toBe(200);
    expect(await marcos(r)).toEqual([{ t: "head", status: 200, headers: [] }, { t: "end", ms: 2 }]);
    expect(llamadas).toEqual([{ name: SCRIPT, limits: { cpuMs: 200, subRequests: 1000 }, body: '{"fn":"hola"}' }]);
  });

  it("límites que no son números: los de Gratis", async () => {
    const { ns, llamadas } = namespace();
    await dispatcher.fetch(pedir(cabeceras({ "x-openlen-cpu-ms": "abc", "x-openlen-subrequests": "-3" })), { DISPATCH_KEY: KEY, DISPATCHER: ns });
    expect(llamadas[0]!.limits).toEqual({ cpuMs: 50, subRequests: 50 });
  });

  it("un nombre de script que no es de los nuestros: 400", async () => {
    const { ns, llamadas } = namespace();
    expect((await dispatcher.fetch(pedir(cabeceras({ "x-openlen-script": "otro-script" })), { DISPATCH_KEY: KEY, DISPATCHER: ns })).status).toBe(400);
    expect(llamadas).toEqual([]);
  });

  it("el script no existe: not_found y fin", async () => {
    const { ns } = namespace({ falla: "Worker not found." });
    expect(await marcos(await dispatcher.fetch(pedir(cabeceras()), { DISPATCH_KEY: KEY, DISPATCHER: ns }))).toEqual([{ t: "error", kind: "not_found" }, { t: "end", ms: 0 }]);
  });

  it("se pasa de un límite: cpu, con su mensaje", async () => {
    const { ns } = namespace({ falla: "Worker exceeded CPU time limit." });
    expect(await marcos(await dispatcher.fetch(pedir(cabeceras()), { DISPATCH_KEY: KEY, DISPATCHER: ns }))).toEqual([
      { t: "error", kind: "cpu", message: "Worker exceeded CPU time limit." },
      { t: "end", ms: 0 },
    ]);
  });

  it("otro fallo al llamar: uncaught", async () => {
    const { ns } = namespace({ falla: "boom" });
    expect(await marcos(await dispatcher.fetch(pedir(cabeceras()), { DISPATCH_KEY: KEY, DISPATCHER: ns }))).toEqual([{ t: "error", kind: "uncaught", message: "boom" }, { t: "end", ms: 0 }]);
  });
});
