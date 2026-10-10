// @vitest-environment node
// La cola de un hilo (plan 02, tarea 1): lo que aprendió el comprobador (plan 03),
// en un sitio para el comprobador y el empaquetador.
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerQueue } from "./worker-queue";

const RUTA = path.join(process.cwd(), "lib", "apps", "worker-queue.fixture.mjs");
type Eco = { value: unknown; threadId: number };
let colas: WorkerQueue<Eco>[] = [];
const nueva = () => {
  const c = new WorkerQueue<Eco>({ workerPath: RUTA });
  colas.push(c);
  return c;
};
afterEach(() => {
  for (const c of colas) c.stop();
  colas = [];
});

describe("WorkerQueue (plan 02, tarea 1)", () => {
  it("contesta cada petición con lo suyo, en orden", async () => {
    const c = nueva();
    const r = await Promise.all([1, 2, 3].map((v) => c.run({ ms: 5, value: v }, { timeoutMs: 5_000 })));
    expect(r.map((x) => x?.value)).toEqual([1, 2, 3]);
  });

  it("🔴 el tope cuenta desde que la petición ENTRA al hilo: una cola más larga que el tope no caduca", async () => {
    const c = nueva();
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => c.run({ ms: 100, value: i }, { timeoutMs: 400 })));
    expect(r.every((x) => x !== null)).toBe(true);
  });

  it("🔴 una petición nueva con el mismo `supersedes` sustituye a la que espera; la de otro, no", async () => {
    const c = nueva();
    const yo = {};
    const otro = {};
    const enCurso = c.run({ ms: 50, value: "a" }, { timeoutMs: 5_000 });
    const vieja = c.run({ value: "b" }, { timeoutMs: 5_000, supersedes: yo });
    const deOtro = c.run({ value: "c" }, { timeoutMs: 5_000, supersedes: otro });
    const nuevaP = c.run({ value: "d" }, { timeoutMs: 5_000, supersedes: yo });
    expect(await vieja).toBeNull();
    expect((await nuevaP)?.value).toBe("d");
    expect((await deOtro)?.value).toBe("c");
    expect((await enCurso)?.value).toBe("a");
  });

  it("🔴 una que no acaba a tiempo da null, el hilo se termina y la siguiente va a uno nuevo", async () => {
    const c = nueva();
    const primero = await c.run({ value: 0 }, { timeoutMs: 5_000 });
    expect(await c.run({ ms: 10_000, value: 1 }, { timeoutMs: 50 })).toBeNull();
    const despues = await c.run({ value: 2 }, { timeoutMs: 5_000 });
    expect(despues?.value).toBe(2);
    expect(despues?.threadId).not.toBe(primero?.threadId);
  });

  it("🔴 si el hilo avisa de que se recicla, la siguiente va a un hilo nuevo y no se pierde", async () => {
    const c = nueva();
    const [a, b] = await Promise.all([c.run({ value: 1, recycle: true }, { timeoutMs: 5_000 }), c.run({ value: 2 }, { timeoutMs: 5_000 })]);
    expect(b?.value).toBe(2);
    expect(b?.threadId).not.toBe(a?.threadId);
  });

  it("stop() suelta lo pendiente a null", async () => {
    const c = nueva();
    const p = c.run({ ms: 10_000, value: 1 }, { timeoutMs: 60_000 });
    c.stop();
    expect(await p).toBeNull();
  });
});
