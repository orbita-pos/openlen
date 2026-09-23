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

  it("uno desmesurado se RECORTA a 40 en vez de tirar el turno", async () => {
    const res = await guardar(turno(tarjetas(45)));
    expect(res.status).toBe(200);
    const guardadas = vi.mocked(appendChatMessage).mock.calls[0]![1].actions!;
    expect(guardadas).toHaveLength(40);
    expect(guardadas[0]!.summary).toBe("paso 1");
  });

  it("BRAZO DE CONTROL: una tarjeta sin los campos nuevos se guarda como antes, sin claves añadidas", async () => {
    const res = await guardar(turno([{ tool: "editar_pagina", status: "done", summary: "titular", edits: 1 }]));
    expect(res.status).toBe(200);
    expect(guardada()).toEqual({ tool: "editar_pagina", status: "done", summary: "titular", edits: 1 });
  });
});
