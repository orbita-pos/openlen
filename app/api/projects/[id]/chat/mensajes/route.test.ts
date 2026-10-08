import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quienEnElProyecto: vi.fn(),
  escribirMensajeDelEquipo: vi.fn(async () => ({ id: "m1", mencionados: ["u-eli"] })),
  mencionesDelChatSinVer: vi.fn(async () => 2),
  firmaDelChat: vi.fn(async () => "3:abc:0:0"),
  personasDelProyecto: vi.fn(async () => [
    { userId: "u-dana", nombre: "Dana Dueña", email: "d@x", rol: "dueno" },
    { userId: "u-eli", nombre: "Eli Editor", email: "e@x", rol: "editor" },
  ]),
  scheduleNotification: vi.fn(async () => {}),
  hayInvitacionesPendientes: vi.fn(async () => false),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("../../hilos/_comun", async (original) => ({
  ...(await original<typeof import("../../hilos/_comun")>()),
  quienEnElProyecto: mocks.quienEnElProyecto,
}));
vi.mock("@/lib/projects/chat-equipo", () => ({
  escribirMensajeDelEquipo: mocks.escribirMensajeDelEquipo,
  mencionesDelChatSinVer: mocks.mencionesDelChatSinVer,
  firmaDelChat: mocks.firmaDelChat,
}));
vi.mock("@/lib/projects/hilos", async (original) => ({
  ...(await original<typeof import("@/lib/projects/hilos")>()),
  personasDelProyecto: mocks.personasDelProyecto,
}));
vi.mock("@/lib/projects/miembros", async (original) => ({
  ...(await original<typeof import("@/lib/projects/miembros")>()),
  hayInvitacionesPendientes: mocks.hayInvitacionesPendientes,
}));
vi.mock("@/lib/notifications/dispatch", () => ({ scheduleNotification: mocks.scheduleNotification }));
vi.mock("@/lib/agent/turnos-desde-el-servidor", () => ({ retomarPedidosDelHilo: vi.fn(async () => {}), lanzarTurnoDelHilo: vi.fn() }));

import { GET, POST } from "./route";

const enviar = async (cuerpo: unknown) => {
  const res = await POST(
    new Request("http://localhost/api/projects/p1/chat/mensajes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }),
    { params: Promise.resolve({ id: "p1" }) },
  );
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
};

describe("POST /api/projects/[id]/chat/mensajes — escribir a una persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quienEnElProyecto.mockResolvedValue({ ok: true, userId: "u-leo", nombre: "Leo Lector", acceso: { rol: "lector", duenoId: "u-dana" } });
  });

  it("🔴 un lector puede escribir a una persona, y la persona recibe el aviso del chat", async () => {
    const { status, cuerpo } = await enviar({ texto: "@Eli Editor mira el pie", menciones: ["u-eli"], idioma: "es" });
    expect(status).toBe(200);
    expect(cuerpo).toEqual({ id: "m1", mencionados: ["u-eli"] });
    expect(mocks.escribirMensajeDelEquipo).toHaveBeenCalledWith({ projectId: "p1", autorId: "u-leo", texto: "@Eli Editor mira el pie", menciones: ["u-eli"], fotos: [] });
    expect(mocks.scheduleNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "mencion", donde: "chat", recipientUserId: "u-eli", quien: "Leo Lector", projectId: "p1", idioma: "es" }),
      // Como Slack: espera un minuto y las seguidas se juntan en un aviso.
      "mencion-chat:p1:u-eli",
      { retrasoMs: 60_000 },
    );
  });

  it("🔴 con @Len no es un mensaje: es un turno (400 lleva_len), y no se escribe nada", async () => {
    const { status, cuerpo } = await enviar({ texto: "@Len y @Eli Editor", menciones: ["u-eli"] });
    expect(status).toBe(400);
    expect(cuerpo.error).toBe("lleva_len");
    expect(mocks.escribirMensajeDelEquipo).not.toHaveBeenCalled();
  });

  it("sin nadie del proyecto mencionado → 400 sin_mencion", async () => {
    const { status, cuerpo } = await enviar({ texto: "hola a todos", menciones: ["u-extrano"] });
    expect(status).toBe(400);
    expect(cuerpo.error).toBe("sin_mencion");
    expect(mocks.escribirMensajeDelEquipo).not.toHaveBeenCalled();
  });

  it("un texto vacío o de más de 4.000 → 400 invalid_body", async () => {
    expect((await enviar({ texto: "   ", menciones: ["u-eli"] })).status).toBe(400);
    expect((await enviar({ texto: "x".repeat(4001), menciones: ["u-eli"] })).status).toBe(400);
  });

  it("GET ?solo=sinVer devuelve las menciones sin ver de quien pide", async () => {
    const res = await GET(new Request("http://localhost/api/projects/p1/chat/mensajes?solo=sinVer"), { params: Promise.resolve({ id: "p1" }) });
    // Y si el proyecto es compartido: sin miembros, el carril deja de preguntar.
    expect(await res.json()).toEqual({ sinVer: 2, compartido: true });
    expect(mocks.mencionesDelChatSinVer).toHaveBeenCalledWith("p1", "u-leo");
  });

  it("🔴 GET ?solo=sinVer sin miembros pero con una invitación pendiente: esperando, para que el carril siga preguntando", async () => {
    mocks.personasDelProyecto.mockResolvedValueOnce([{ userId: "u-dana", nombre: "Dana Dueña", email: "d@x", rol: "dueno" }]);
    mocks.hayInvitacionesPendientes.mockResolvedValueOnce(true);
    const res = await GET(new Request("http://localhost/api/projects/p1/chat/mensajes?solo=sinVer"), { params: Promise.resolve({ id: "p1" }) });
    expect(await res.json()).toEqual({ sinVer: 2, compartido: false, esperando: true });
  });

  it("GET ?solo=firma devuelve la firma de la conversación, para releerla sólo si cambió", async () => {
    const res = await GET(new Request("http://localhost/api/projects/p1/chat/mensajes?solo=firma"), { params: Promise.resolve({ id: "p1" }) });
    expect(await res.json()).toEqual({ firma: "3:abc:0:0" });
    expect(mocks.firmaDelChat).toHaveBeenCalledWith("p1");
  });

  it("🔴 las fotos adjuntas viajan con el mensaje; una dirección que no es http(s) → 400", async () => {
    const ok = await enviar({ texto: "@Eli Editor mira", menciones: ["u-eli"], fotos: [{ url: "https://x.test/a.jpg", alt: "pie" }] });
    expect(ok.status).toBe(200);
    expect(mocks.escribirMensajeDelEquipo).toHaveBeenLastCalledWith(expect.objectContaining({ fotos: [{ url: "https://x.test/a.jpg", alt: "pie" }] }));
    expect((await enviar({ texto: "@Eli Editor mira", menciones: ["u-eli"], fotos: [{ url: "javascript:alert(1)" }] })).status).toBe(400);
  });
});
