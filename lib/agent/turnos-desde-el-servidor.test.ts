// @vitest-environment node
// `@Len` DESDE UN HILO, COMO CLAUDE TAG: el turno arranca en el servidor, uno
// a la vez por proyecto, y nunca deja el hilo en «trabajando».
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  vivo: false,
  respuestas: [] as { hiloId: string; texto: string; filaId: string | null }[],
  contestoLen: false,
  pendientes: [] as unknown[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/api/agent/route", () => ({}));
vi.mock("@/lib/agent/direcciones", () => ({ hayTurnoVivoEnElProyecto: () => mocks.vivo }));
vi.mock("@/lib/projects/hilos", () => ({
  pedidosALenSinContestar: async () => mocks.pendientes,
  listarHilos: async () => [{ id: "h-nuevo", ruta: "/src/App.jsx", linea: 7, codigo: "x", mensajes: [] }],
  contextoParaLen: (h: { id: string }, mensajeId: string) => `CTX ${h.id} antes de ${mensajeId}`,
  hiloTieneRespuestaDe: async () => mocks.contestoLen,
  respuestaDeLen: async (p: { hiloId: string; texto: string; filaId: string | null }) => {
    mocks.respuestas.push(p);
    return true;
  },
}));

import { launchEmailTurn, lanzarTurnoDelHilo, registrarCorredorDeTurnos, retomarPedidosDelHilo, type EmailRequest } from "./turnos-desde-el-servidor";

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
  mocks.pendientes = [];
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

describe("tras un reinicio del servidor", () => {
  it("🔴 retoma los pedidos sin contestar: relanza el que no empezó con su misma fila; el cortado a medias y el viejo, Len lo dice en el hilo", async () => {
    const pedido = { idioma: "es", url: "http://x/api/projects/p1/hilos" };
    const hace = (ms: number) => new Date(Date.now() - ms);
    mocks.pendientes = [
      { projectId: "p1", hiloId: "h-nuevo", mensajeId: "m1", autorId: "ana", texto: "@Len hazlo", filaId: "f-nuevo", pedido, createdAt: hace(60_000), empezado: false },
      { projectId: "p1", hiloId: "h-cortado", mensajeId: "m2", autorId: "ana", texto: "@Len eso", filaId: "f-cortado", pedido, createdAt: hace(60_000), empezado: true },
      { projectId: "p1", hiloId: "h-viejo", mensajeId: "m3", autorId: "ana", texto: "@Len lo otro", filaId: "f-viejo", pedido: { ...pedido, idioma: "en" }, createdAt: hace(3 * 86_400_000), empezado: false },
    ];
    const corredor = vi.fn(async () => {
      mocks.contestoLen = true;
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    expect(await retomarPedidosDelHilo()).toBe(3);
    await hasta(() => corredor.mock.calls.length > 0);
    expect(corredor).toHaveBeenCalledTimes(1);
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      { projectId: "p1", prompt: "@Len hazlo", turnId: "f-nuevo", answersQuestions: false },
      expect.objectContaining({ url: pedido.url }),
      { hilo: { hiloId: "h-nuevo", ruta: "/src/App.jsx", linea: 7, contexto: "CTX h-nuevo antes de m1" } },
    );
    expect(mocks.respuestas.map((r) => [r.hiloId, r.filaId])).toEqual([
      ["h-cortado", "f-cortado"],
      ["h-viejo", "f-viejo"],
    ]);
    expect(mocks.respuestas[0]!.texto).toMatch(/Se reinició el servidor/);
    expect(mocks.respuestas[1]!.texto).toBe("I couldn’t get to it. Ask me again from the thread.");
    // Una vez por proceso: la segunda llamada no vuelve a lanzar nada.
    await retomarPedidosDelHilo();
    expect(corredor).toHaveBeenCalledTimes(1);
  });
});

describe("un pedido por correo (Len por correo)", () => {
  const lanzarCorreo = (reply: (t: string) => Promise<void>) =>
    launchEmailTurn({
      userId: "ana",
      projectId: "p-correo",
      texto: "cambia el precio a 499",
      context: "[Sent by email]",
      origen: "http://x/api/agent",
      reply,
      fraseDeFallo: (f) => (f ? `No pude: ${f.code ?? f.motivo}` : "No llegué"),
    });

  it("🔴 el turno lleva el contexto del correo, y lo que Len dijo al cerrar se manda por correo UNA vez", async () => {
    const enviados: string[] = [];
    const corredor = vi.fn(async (_u: string, _b: Record<string, unknown>, _r: unknown, opts: { email?: EmailRequest }) => {
      await opts.email!.onReply("Listo: el precio ya dice $499.");
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    const { filaId } = await lanzarCorreo(async (t) => void enviados.push(t));
    await hasta(() => corredor.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      { projectId: "p-correo", prompt: "cambia el precio a 499", turnId: filaId, answersQuestions: false },
      expect.objectContaining({ url: "http://x/api/agent" }),
      { email: expect.objectContaining({ context: "[Sent by email]" }) },
    );
    expect(enviados).toEqual(["Listo: el precio ya dice $499."]);
  });

  it("🔴 si el turno no contesta (sin créditos), quien escribió recibe el motivo por correo", async () => {
    const enviados: string[] = [];
    registrarCorredorDeTurnos(async () => sse([["error", { message: "sin créditos", code: "no_credits" }]]));
    await lanzarCorreo(async (t) => void enviados.push(t));
    await hasta(() => enviados.length > 0);
    expect(enviados).toEqual(["No pude: no_credits"]);
  });
});
