import { describe, it, expect, vi, beforeEach } from "vitest";

// Lo que esta prueba sujeta es el ESQUEMA: qué campos de la tarjeta sobreviven
// la validación y llegan a `appendChatMessage`. La base, la sesión y la
// comprobación de propiedad se simulan; el guardado se espía.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "p1" }] }) }) }),
  },
  schema: { projects: { id: "id", userId: "userId" } },
}));
vi.mock("@/lib/projects/chat", () => ({
  appendChatMessage: vi.fn(),
  updateChatMessageStatus: vi.fn(),
}));

import { POST } from "./route";
import { appendChatMessage } from "@/lib/projects/chat";
import { auth } from "@/auth";

const turno = (actions: unknown[]) => ({
  id: "t1",
  userText: "cambia el titular",
  assistantReasoning: "Hecho.",
  status: "applied",
  actions,
});

const guardar = (body: unknown) =>
  POST(
    new Request("http://x/api/projects/p1/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );

/** La primera tarjeta tal y como se le pasó a `appendChatMessage`. */
const guardada = () => vi.mocked(appendChatMessage).mock.calls[0]![1].actions![0]!;

describe("POST /api/projects/[id]/chat — lo que la tarjeta conserva al guardarse", () => {
  beforeEach(() => {
    vi.mocked(appendChatMessage).mockReset();
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
  });

  it("🔴 la observación y el recuento de páginas LLEGAN a guardarse", async () => {
    const res = await guardar(
      turno([
        {
          tool: "verificar_diseno",
          status: "done",
          summary: "ok",
          observacion: "Inicio: el formulario sólo muestra placeholders.",
          paginasMiradas: 1,
          paginasTocadas: 2,
        },
      ]),
    );
    expect(res.status).toBe(200);
    expect(guardada()).toMatchObject({
      observacion: "Inicio: el formulario sólo muestra placeholders.",
      paginasMiradas: 1,
      paginasTocadas: 2,
    });
  });

  it("🔴 pieza 3: las preguntas con sus opciones y la respuesta del dueño LLEGAN a guardarse, recortadas", async () => {
    const preguntas = [{ id: "plazo", question: "¿Cuánto tarda?", options: [{ label: "48 horas (Recommended)", description: "Lo de tu ficha." }], multiSelect: false }];
    const res = await guardar(
      turno([{ tool: "ask_user_question", status: "done", summary: "", pregunta: "¿Cuánto tarda?", preguntas, respuesta: "x".repeat(500) }]),
    );
    expect(res.status).toBe(200);
    expect(guardada()).toMatchObject({ preguntas });
    expect(guardada().respuesta).toHaveLength(200);
  });

  it("ALINEAR · la marca de «cancelada» llega a guardarse", async () => {
    const res = await guardar(turno([{ tool: "exit_plan_mode", status: "done", summary: "", preguntas: [{ id: "plan-review", question: "?" }], dismissed: true }]));
    expect(res.status).toBe(200);
    expect(guardada()).toMatchObject({ dismissed: true });
  });

  it("🔴 pieza 7: la intención de la pregunta (la revisión del plan) llega a guardarse; una que no vale se cae", async () => {
    const revision = { id: "plan-review", question: "Approve this plan and leave plan mode?", intent: { kind: "plan-review", plan: "# Reseñas" } };
    const res = await guardar(
      turno([
        { tool: "exit_plan_mode", status: "done", summary: "", preguntas: [revision], respuesta: "Approve" },
        { tool: "enter_plan_mode", status: "done", summary: "", preguntas: [{ id: "plan-mode", question: "¿Planear?", intent: { kind: "otra" } }] },
      ]),
    );
    expect(res.status).toBe(200);
    const acciones = vi.mocked(appendChatMessage).mock.calls[0]![1].actions!;
    expect(acciones[0]!.preguntas![0]).toMatchObject({ intent: { kind: "plan-review", plan: "# Reseñas" } });
    // `undefined`: el JSON de la fila no la lleva.
    expect(acciones[1]!.preguntas![0]!.intent).toBeUndefined();
  });

  it("una observación larga se RECORTA y el turno se guarda igual", async () => {
    const res = await guardar(
      turno([{ tool: "verificar_diseno", status: "done", summary: "ok", observacion: "x".repeat(5000) }]),
    );
    expect(res.status).toBe(200);
    expect(guardada().observacion).toHaveLength(1000);
  });

  it("un recuento suelto se descarta, sin tirar el turno", async () => {
    const res = await guardar(
      turno([{ tool: "verificar_diseno", status: "done", summary: "ok", paginasMiradas: 1 }]),
    );
    expect(res.status).toBe(200);
    expect(guardada()).not.toHaveProperty("paginasMiradas");
    expect(guardada()).not.toHaveProperty("paginasTocadas");
  });

  // 🔴 El turno de la comprobación en el navegador (2026-09-22) tuvo 14
  // tarjetas y este guardado respondió 400 «Array must contain at most 12
  // element(s)»: el navegador no guardó nada. En producción, 2 de los 22 turnos
  // con tarjetas de los 14 días anteriores pasaban de 12.
  const tarjetas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ tool: "editar_texto", status: "done", summary: `paso ${i + 1}` }));

  it("🔴 un turno de 14 tarjetas se guarda entero", async () => {
    const res = await guardar(turno(tarjetas(14)));
    expect(res.status).toBe(200);
    expect(vi.mocked(appendChatMessage).mock.calls[0]![1].actions).toHaveLength(14);
  });

  // 🔴 El turno de producción del 2026-09-28 (Len 2.0, sin tope de pasos) hizo
  // 93 llamadas; se guardaron 40 y, al recargar, la lista acababa en la tarjeta
  // roja de la llamada 40 aunque el turno terminó bien.
  it("🔴 un turno de 93 tarjetas se guarda entero, la última incluida", async () => {
    const res = await guardar(turno(tarjetas(93)));
    expect(res.status).toBe(200);
    const guardadas = vi.mocked(appendChatMessage).mock.calls[0]![1].actions!;
    expect(guardadas).toHaveLength(93);
    expect(guardadas.at(-1)!.summary).toBe("paso 93");
  });

  it("uno de más de 200 tarjetas ya no tira el turno con un 400", async () => {
    const res = await guardar(turno(tarjetas(250)));
    expect(res.status).toBe(200);
    expect(vi.mocked(appendChatMessage).mock.calls[0]![1].actions).toHaveLength(250);
  });

  it("uno desmesurado se RECORTA a 1000 en vez de tirar el turno", async () => {
    const res = await guardar(turno(tarjetas(1005)));
    expect(res.status).toBe(200);
    const guardadas = vi.mocked(appendChatMessage).mock.calls[0]![1].actions!;
    expect(guardadas).toHaveLength(1000);
    expect(guardadas[0]!.summary).toBe("paso 1");
  });

  // N41: la roja guarda el motivo del DUEÑO (código + datos), o al recargar
  // volvería a decir «falló» a secas.
  it("🔴 el motivo del dueño de una roja LLEGA a guardarse", async () => {
    const res = await guardar(
      turno([{ tool: "publish", status: "error", summary: "x", ownerReason: { code: "address_invalid", address: "mi negocio" } }]),
    );
    expect(res.status).toBe(200);
    expect(guardada().ownerReason).toEqual({ code: "address_invalid", address: "mi negocio" });
  });

  it("un motivo del dueño con un código desconocido se QUITA, sin tirar el turno", async () => {
    const res = await guardar(turno([{ tool: "publish", status: "error", summary: "x", ownerReason: { code: "inventado" } }]));
    expect(res.status).toBe(200);
    expect(guardada().ownerReason).toBeUndefined();
  });

  it("BRAZO DE CONTROL: una tarjeta sin los campos nuevos se guarda como antes, sin claves añadidas", async () => {
    const res = await guardar(turno([{ tool: "editar_pagina", status: "done", summary: "titular", edits: 1 }]));
    expect(res.status).toBe(200);
    expect(guardada()).toEqual({ tool: "editar_pagina", status: "done", summary: "titular", edits: 1 });
  });
});
