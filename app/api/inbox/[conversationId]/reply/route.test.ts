// Contestar como el negocio deja la conversación LEÍDA (plans/len-resultados/
// diseno.md §6): es el «Enviar» de la tarjeta del borrador de Len.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertMessage: vi.fn(),
  markConversationRead: vi.fn(),
  publish: vi.fn(),
  requireOwnerForConversation: vi.fn(),
}));

vi.mock("@/lib/chat/store", () => ({
  insertMessage: mocks.insertMessage,
  markConversationRead: mocks.markConversationRead,
}));
vi.mock("@/lib/chat/hub", () => ({ hub: { publish: mocks.publish } }));
// Quién contesta lo decide la sesión o la llave del teléfono (lib/movil/quien);
// aquí no se prueba eso, sino lo que pasa después.
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => "u1" }));
vi.mock("../../_shared", () => ({
  requireOwnerForConversation: mocks.requireOwnerForConversation,
  json: (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status }),
}));

import { POST } from "./route";

function contestar(cuerpo: unknown) {
  return POST(new Request("http://localhost/api/inbox/c1/reply", { method: "POST", body: JSON.stringify(cuerpo) }), {
    params: Promise.resolve({ conversationId: "c1" }),
  });
}

describe("POST /api/inbox/[conversationId]/reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerForConversation.mockResolvedValue({ projectId: "p1", ownerChatUserId: "duenio" });
    mocks.insertMessage.mockResolvedValue({ id: "m1", conversationId: "c1", authorId: "duenio", body: "Sí", createdAt: new Date("2026-09-30T20:00:00Z") });
    mocks.markConversationRead.mockResolvedValue(undefined);
  });

  it("manda el mensaje y deja la conversación leída, con el visto en vivo", async () => {
    const res = await contestar({ body: "Sí, abrimos el domingo" });
    expect(res.status).toBe(200);
    expect(mocks.insertMessage).toHaveBeenCalledWith("c1", "duenio", "Sí, abrimos el domingo");
    expect(mocks.markConversationRead).toHaveBeenCalledWith("p1", "c1", "duenio", expect.any(Date));
    expect(mocks.publish).toHaveBeenCalledWith("c1", expect.objectContaining({ type: "read", userId: "duenio" }));
  });

  it("si marcar leído falla, el mensaje ya salió: sigue siendo 200", async () => {
    mocks.markConversationRead.mockRejectedValue(new Error("la base no contesta"));
    const res = await contestar({ body: "Hola" });
    expect(res.status).toBe(200);
    expect(mocks.insertMessage).toHaveBeenCalled();
  });

  it("vacío no manda nada ni marca nada", async () => {
    const res = await contestar({ body: "   " });
    expect(res.status).toBe(400);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
    expect(mocks.markConversationRead).not.toHaveBeenCalled();
  });
});
