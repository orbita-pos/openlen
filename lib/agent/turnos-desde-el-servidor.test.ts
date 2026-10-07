// @vitest-environment node
// `@Len` DESDE UN HILO, COMO CLAUDE TAG: el turno arranca en el servidor, uno
// a la vez por proyecto, y nunca deja el hilo en «trabajando».
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vivo: false,
  respuestas: [] as { hiloId: string; texto: string; filaId: string | null }[],
  contestoLen: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/agent/route", () => ({}));
vi.mock("@/lib/agent/direcciones", () => ({ hayTurnoVivoEnElProyecto: () => mocks.vivo }));
vi.mock("@/lib/projects/hilos", () => ({
  hiloTieneRespuestaDe: async () => mocks.contestoLen,
  respuestaDeLen: async (p: { hiloId: string; texto: string; filaId: string | null }) => {
    mocks.respuestas.push(p);
    return true;
  },
}));

import { lanzarTurnoDelHilo, registrarCorredorDeTurnos } from "./turnos-desde-el-servidor";

const sse = (eventos: [string, unknown][]) =>
  new Response(eventos.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
const hilo = { hiloId: "h1", ruta: "/src/App.jsx", linea: 3, contexto: "CTX" };
const lanzar = (texto = "@Len hazlo") =>
  lanzarTurnoDelHilo({
    userId: "ana",
    projectId: "p1",
    texto,
    hilo,
    origen: "http://x",
    fraseDeFallo: (f) => (f ? `No pude: ${f.code ?? f.motivo}` : "No llegué"),
  });
const hasta = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
};

beforeEach(() => {
  mocks.vivo = false;
  mocks.respuestas = [];
  mocks.contestoLen = false;
});

describe("el turno de un hilo, en el servidor", () => {
  it("🔴 vuelve en el acto con su fila, y el turno corre con lo escrito, el hilo y quien lo pidió", async () => {
    const corredor = vi.fn(async () => {
      mocks.contestoLen = true; // la ruta contestó en el hilo al cerrar
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    const { filaId } = await lanzar();
    expect(filaId).toMatch(/^[0-9a-f-]{36}$/);
    await hasta(() => corredor.mock.calls.length > 0);
    expect(corredor).toHaveBeenCalledWith("ana", { projectId: "p1", prompt: "@Len hazlo", turnId: filaId, answersQuestions: false }, expect.anything(), { hilo });
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.respuestas).toEqual([]);
  });

  it("🔴 si el turno no contesta (sin créditos, un fallo), Len lo dice en el hilo con el motivo", async () => {
    registrarCorredorDeTurnos(async () => sse([["error", { message: "Te quedaste sin créditos.", code: "no_credits" }]]));
    const { filaId } = await lanzar();
    await hasta(() => mocks.respuestas.length > 0);
    expect(mocks.respuestas).toEqual([expect.objectContaining({ hiloId: "h1", texto: "No pude: no_credits", filaId })]);
  });

  it("con Len ya trabajando en el proyecto, espera a que acabe (dos Len a la vez editarían lo mismo)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      mocks.vivo = true;
      const corredor = vi.fn(async () => {
        mocks.contestoLen = true;
        return sse([["done", {}]]);
      });
      registrarCorredorDeTurnos(corredor);
      await lanzar();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(corredor).not.toHaveBeenCalled();
      mocks.vivo = false;
      await vi.advanceTimersByTimeAsync(2_100);
      expect(corredor).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("una petición rechazada antes de empezar (el tope de los miembros) también se dice en el hilo", async () => {
    registrarCorredorDeTurnos(async () => new Response(JSON.stringify({ error: "the project's monthly limit for members is used up", code: "tope_de_miembros" }), { status: 402 }));
    await lanzar();
    await hasta(() => mocks.respuestas.length > 0);
    expect(mocks.respuestas[0]!.texto).toBe("No pude: tope_de_miembros");
  });
});
