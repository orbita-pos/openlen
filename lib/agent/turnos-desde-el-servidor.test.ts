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

import {
  launchAssistantRequestTurn,
  launchEmailTurn,
  launchLenMessageTurn,
  launchLenWatchTurn,
  launchScheduledTurn,
  launchSubagentNoticeTurn,
  lanzarTurnoDelHilo,
  registrarCorredorDeTurnos,
  retomarPedidosDelHilo,
  type EmailRequest,
  type ScheduledRequest,
} from "./turnos-desde-el-servidor";

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

describe("a scheduled task's turn, on the server (spec local 2026-10-29-tareas-programadas, §7.5)", () => {
  const origin = { kind: "scheduled" as const, taskId: "schedule-1", title: "PDF de resultados", occurrenceAt: "2026-11-02T15:03:00.000Z" };
  const launch = (o: { reply?: (t: string, c: unknown) => Promise<void>; fail?: (f: unknown, cut: boolean) => Promise<void>; onStart?: () => Promise<void> } = {}) =>
    launchScheduledTurn({
      userId: "ana",
      projectId: "p-prog",
      texto: "Make the PDF",
      framing: "[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user",
      origin,
      timeZone: "America/Mexico_City",
      locale: "es",
      filaId: "run-1",
      reply: o.reply ?? (async () => {}),
      fail: o.fail ?? (async () => {}),
      onStart: o.onStart ?? (async () => {}),
    });

  it("runs as whoever asked, in the task's zone and language, with the framing for the model", async () => {
    const started: string[] = [];
    const corredor = vi.fn(async (_u: string, _b: Record<string, unknown>, _r: unknown, opts: { scheduled?: ScheduledRequest }) => {
      await opts.scheduled!.onReply("Listo, aquí está el PDF.", []);
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    const replies: string[] = [];
    launch({ reply: async (t) => void replies.push(t), onStart: async () => void started.push("start") });
    await hasta(() => replies.length > 0);
    expect(started).toEqual(["start"]);
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      { projectId: "p-prog", prompt: "Make the PDF", turnId: "run-1", answersQuestions: false, zonaHoraria: "America/Mexico_City", idioma: "es" },
      expect.anything(),
      { scheduled: expect.objectContaining({ framing: "[SCHEDULE REMINDER BATCH]\nThis is a scheduled message from the user", origin }) },
    );
    expect(replies).toEqual(["Listo, aquí está el PDF."]);
  });

  it("waits while Len is working in the project, then runs (nothing is dropped)", async () => {
    mocks.vivo = true;
    const corredor = vi.fn(async (_u: string, _b: Record<string, unknown>, _r: unknown, opts: { scheduled?: ScheduledRequest }) => {
      await opts.scheduled!.onReply("ok", []);
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    const replies: string[] = [];
    launch({ reply: async (t) => void replies.push(t) });
    await new Promise((r) => setTimeout(r, 50));
    expect(corredor).not.toHaveBeenCalled();
    mocks.vivo = false;
    // The queue looks again every 2 s (`esperarALen`).
    for (let i = 0; i < 100 && replies.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(replies).toEqual(["ok"]);
  }, 10_000);

  it("without a reply (no credits), fails with the reason and never replies", async () => {
    registrarCorredorDeTurnos(async () => sse([["error", { message: "sin créditos", code: "no_credits" }]]));
    const fails: unknown[] = [];
    const replies: string[] = [];
    launch({ reply: async (t) => void replies.push(t), fail: async (f, cut) => void fails.push({ f, cut }) });
    await hasta(() => fails.length > 0);
    expect(fails).toEqual([{ f: { motivo: "sin créditos", code: "no_credits" }, cut: false }]);
    expect(replies).toEqual([]);
  });
});

describe("the turn that wakes Len with its subagents' notices (spec local 2026-11-01-subagentes-de-len, §4.6)", () => {
  const launch = (takeNotices: () => { id: string; text: string }[], fail: (f: unknown) => Promise<void> = async () => {}) =>
    launchSubagentNoticeTurn({ userId: "ana", projectId: "p-sub", filaId: "row-n", timeZone: "Europe/Madrid", locale: "es", takeNotices, onStart: async () => {}, fail });

  it("carries every notice waiting when it starts, as the framing, with the subagents' origin", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    launch(() => [
      { id: "r1", text: "Background subagent r1 finished." },
      { id: "r2", text: "Background subagent r2 failed before it finished." },
    ]);
    await hasta(() => corredor.mock.calls.length > 0);
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      expect.objectContaining({ projectId: "p-sub", prompt: "", turnId: "row-n", zonaHoraria: "Europe/Madrid", idioma: "es" }),
      expect.anything(),
      {
        scheduled: expect.objectContaining({
          framing: "Background subagent r1 finished.\n\nBackground subagent r2 failed before it finished.",
          origin: { kind: "subagents", ids: ["r1", "r2"] },
        }),
      },
    );
  });

  it("keeps the effort and the mode of the turn that launched the children", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    launchSubagentNoticeTurn({
      userId: "ana", projectId: "p-sub", filaId: "row-e", timeZone: "Europe/Madrid", locale: "es",
      effort: "low", mode: "dynamis",
      takeNotices: () => [{ id: "r1", text: "Background subagent r1 finished." }], onStart: async () => {}, fail: async () => {},
    });
    await hasta(() => corredor.mock.calls.length > 0);
    expect(corredor).toHaveBeenCalledWith("ana", expect.objectContaining({ esfuerzo: "low", mode: "dynamis" }), expect.anything(), expect.anything());
  });

  it("does not run when another turn already took the notices", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    const fails: unknown[] = [];
    let checked = false;
    launch(() => {
      checked = true;
      return [];
    }, async (f) => void fails.push(f));
    await hasta(() => checked);
    await new Promise((r) => setTimeout(r, 15));
    expect(corredor).not.toHaveBeenCalled();
    expect(fails).toEqual([]);
  });
});

describe("a Len Watch turn, on the server (spec local 2026-10-30-len-watch, §5.4)", () => {
  const origin = { kind: "len_watch" as const, incidentId: "inc-1" };
  const launch = (o: { reply?: (t: string, c: unknown) => Promise<void>; fail?: (f: unknown, cut: boolean) => Promise<void> } = {}) =>
    launchLenWatchTurn({
      userId: "owner",
      projectId: "p-watch",
      texto: "Tu sitio publicado no carga. Arréglalo.",
      framing: "[LEN WATCH] The published site at https://holi.openlen.app does not load",
      origin,
      timeZone: "America/Mexico_City",
      locale: "es",
      filaId: "row-1",
      reply: o.reply ?? (async () => {}),
      fail: o.fail ?? (async () => {}),
      onStart: async () => {},
    });

  it("runs as the owner with the Len Watch framing and origin", async () => {
    const corredor = vi.fn(async (_u: string, _b: Record<string, unknown>, _r: unknown, opts: { scheduled?: ScheduledRequest }) => {
      await opts.scheduled!.onReply("Arreglado: main.jsx leía un campo vacío.", []);
      return sse([["done", {}]]);
    });
    registrarCorredorDeTurnos(corredor);
    const replies: string[] = [];
    launch({ reply: async (t) => void replies.push(t) });
    await hasta(() => replies.length > 0);
    expect(corredor).toHaveBeenCalledWith(
      "owner",
      { projectId: "p-watch", prompt: "Tu sitio publicado no carga. Arréglalo.", turnId: "row-1", answersQuestions: false, zonaHoraria: "America/Mexico_City", idioma: "es" },
      expect.anything(),
      { scheduled: expect.objectContaining({ framing: "[LEN WATCH] The published site at https://holi.openlen.app does not load", origin }) },
    );
    expect(replies).toEqual(["Arreglado: main.jsx leía un campo vacío."]);
  });

  it("without a reply, fails with the reason", async () => {
    registrarCorredorDeTurnos(async () => sse([["error", { message: "sin créditos", code: "no_credits" }]]));
    const fails: unknown[] = [];
    launch({ fail: async (f, cut) => void fails.push({ f, cut }) });
    await hasta(() => fails.length > 0);
    expect(fails).toEqual([{ f: { motivo: "sin créditos", code: "no_credits" }, cut: false }]);
  });
});

describe("the turns a message between Len and an agent wakes (spec local 2026-11-21-len-y-el-agente-conversan, §2)", () => {
  const origin = { kind: "len-message" as const, projectId: "p-x", projectTitle: "Presupuesto" };
  type Resolved = { framing: string; origin: typeof origin } | null;
  const launchAgent = (o: { resolve?: () => Resolved | Promise<Resolved>; fail?: (f: unknown, cut: boolean) => Promise<void>; onStart?: () => Promise<void> } = {}) =>
    launchLenMessageTurn({
      userId: "ana",
      projectId: "home-1",
      texto: "What color is the invoice?",
      framing: "",
      origin,
      timeZone: "Europe/Madrid",
      locale: "es",
      filaId: "row-m",
      extraBody: { assistantId: "a1" },
      reply: async () => {},
      fail: o.fail ?? (async () => {}),
      onStart: o.onStart ?? (async () => {}),
      ...(o.resolve ? { resolveAtStart: o.resolve } : {}),
    });

  it("🔴 runs as the agent: its id rides in the body, and the model reads what the claim returned, awaited", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    const order: string[] = [];
    launchAgent({
      onStart: async () => void order.push("start"),
      // The claim is a database call: it may take its time, and the turn waits for it.
      resolve: async () => {
        await new Promise((r) => setTimeout(r, 15));
        order.push("claimed");
        return { framing: "Len sent you a message", origin };
      },
    });
    await hasta(() => corredor.mock.calls.length > 0);
    expect(order).toEqual(["start", "claimed"]);
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      { projectId: "home-1", prompt: "What color is the invoice?", turnId: "row-m", answersQuestions: false, zonaHoraria: "Europe/Madrid", idioma: "es", assistantId: "a1" },
      expect.anything(),
      { scheduled: expect.objectContaining({ framing: "Len sent you a message", origin }) },
    );
  });

  it("does not run when the claim finds nothing (another turn already read the messages)", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    const fails: unknown[] = [];
    let resolved = false;
    launchAgent({
      resolve: async () => {
        resolved = true;
        return null;
      },
      fail: async (f) => void fails.push(f),
    });
    await hasta(() => resolved);
    await new Promise((r) => setTimeout(r, 15));
    expect(corredor).not.toHaveBeenCalled();
    expect(fails).toEqual([]);
  });

  it("🔴 a turn that read its messages and left no reply is not a failure (the agent only answered Len)", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    const fails: unknown[] = [];
    launchAgent({ resolve: async () => ({ framing: "x", origin }), fail: async (f) => void fails.push(f) });
    await hasta(() => corredor.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 15));
    expect(fails).toEqual([]);
  });

  it("a turn that failed without running says why", async () => {
    registrarCorredorDeTurnos(async () => sse([["error", { message: "no credits", code: "no_credits" }]]));
    const fails: unknown[] = [];
    launchAgent({ resolve: async () => ({ framing: "x", origin }), fail: async (f, cut) => void fails.push({ f, cut }) });
    await hasta(() => fails.length > 0);
    expect(fails).toEqual([{ f: { motivo: "no credits", code: "no_credits" }, cut: false }]);
  });

  it("Len's turn for an agent's message may also claim at its start, and stay quiet when it left no reply", async () => {
    const corredor = vi.fn(async () => sse([["done", {}]]));
    registrarCorredorDeTurnos(corredor);
    const fails: unknown[] = [];
    const lenOrigin = { kind: "assistant" as const, assistantId: "a1", assistantName: "Finanzas", message: true as const };
    launchAssistantRequestTurn(
      {
        userId: "ana",
        projectId: "p-x",
        texto: "The invoice goes in blue.",
        framing: "",
        origin: lenOrigin,
        timeZone: "Europe/Madrid",
        locale: "es",
        filaId: "row-l",
        reply: async () => {},
        fail: async (f) => void fails.push(f),
        onStart: async () => {},
        resolveAtStart: async () => ({ framing: "Finanzas sent you a message", origin: lenOrigin }),
      },
      { quietWhenNoReply: true },
    );
    await hasta(() => corredor.mock.calls.length > 0);
    expect(corredor).toHaveBeenCalledWith(
      "ana",
      { projectId: "p-x", prompt: "The invoice goes in blue.", turnId: "row-l", answersQuestions: false, zonaHoraria: "Europe/Madrid", idioma: "es" },
      expect.anything(),
      { scheduled: expect.objectContaining({ framing: "Finanzas sent you a message", origin: lenOrigin }) },
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(fails).toEqual([]);
  });
});
