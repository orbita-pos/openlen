import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), acceso: vi.fn(), personas: vi.fn(), mensajes: vi.fn(), hilos: vi.fn(), hilo: vi.fn(), escribir: vi.fn(), responder: vi.fn(), estado: vi.fn(), vistas: vi.fn(), chatVisto: vi.fn(), aviso: vi.fn(), avisosHilo: vi.fn(), len: vi.fn() }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.user }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: m.acceso, puede: (rol: string) => rol !== "lector" }));
vi.mock("@/lib/projects/chat", () => ({ getChatMessages: m.mensajes }));
vi.mock("@/lib/projects/chat-equipo", () => ({ escribirMensajeDelEquipo: m.escribir, marcarChatVisto: m.chatVisto }));
vi.mock("@/lib/projects/hilos", () => ({ MAX_TEXTO_DEL_HILO: 4000, personasDelProyecto: m.personas, listarHilos: m.hilos, hiloDelProyecto: m.hilo, responderHilo: m.responder, cambiarEstado: m.estado, marcarVistas: m.vistas,
  mencionesValidas: (ids: string[], gente: { userId: string }[], yo: string) => [...new Set(ids)].filter(id => id !== yo && gente.some(p => p.userId === id)),
}));
vi.mock("@/lib/notifications/dispatch", () => ({ scheduleNotification: m.aviso }));
vi.mock("@/app/api/projects/[id]/hilos/_comun", () => ({ avisarMenciones: m.avisosHilo, pedirleALen: m.len }));
import { GET, POST, OPTIONS } from "./route";

const req = (body?: unknown, bearer = true) => new Request("https://openlen.com/api/movil/equipo?project=p1", {
  method: body === undefined ? "GET" : "POST", headers: { origin: "https://localhost", ...(bearer ? { authorization: `Bearer ${"a".repeat(32)}` } : {}), "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify({ projectId: "p1", ...body as object }) }),
});
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue("u1"); m.acceso.mockResolvedValue({ rol: "editor", duenoId: "owner" });
  m.personas.mockResolvedValue([{ userId: "u1", nombre: "Ana", rol: "editor", email: "privado", avatar: null }, { userId: "u2", nombre: "Luis", rol: "lector", avatar: null }]);
  m.mensajes.mockResolvedValue([{ id: "m1", tipo: "persona", autorId: "u2", autor: "Luis", userText: "@Ana hola", assistantReasoning: "", appliedAt: 12 }, { id: "turno", userText: "crea", assistantReasoning: "secreto de turno" }]);
  m.hilos.mockResolvedValue([]); m.hilo.mockResolvedValue({ id: "h1", creadoPor: "u2", ruta: "/index.html", linea: 4 });
  m.escribir.mockResolvedValue({ id: "nuevo", mencionados: ["u2"] });
  m.aviso.mockResolvedValue(undefined);
  m.responder.mockResolvedValue({ hiloId: "h1", mensajeId: "r1", mencionados: ["u2"] }); m.estado.mockResolvedValue(true); m.len.mockResolvedValue("fila");
});
describe("acceso móvil al equipo", () => {
  it("sin Bearer no acepta la sesión web ni lee participantes", async () => {
    expect((await GET(req(undefined, false))).status).toBe(401);
    expect(m.user).not.toHaveBeenCalled(); expect(m.personas).not.toHaveBeenCalled();
  });
  it("llave inválida no lee ningún dato", async () => {
    m.user.mockResolvedValue(null); expect((await GET(req())).status).toBe(401); expect(m.acceso).not.toHaveBeenCalled();
  });
  it("ajeno al proyecto recibe 404 antes de leer", async () => {
    m.acceso.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(req())).status).toBe(404); expect(m.mensajes).not.toHaveBeenCalled(); expect(m.personas).not.toHaveBeenCalled();
  });
  it("entrega sólo mensajes persona y participantes sin emails adicionales", async () => {
    const r = await GET(req()); const b = await r.json();
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(b.yo).toBe("u1"); expect(b.puedeLen).toBe(true); expect(b.mensajes.map((x: { id: string }) => x.id)).toEqual(["m1"]);
    expect(b.personas[0]).not.toHaveProperty("email"); expect(JSON.stringify(b)).not.toContain("secreto de turno");
  });
  it("CORS no permite orígenes ajenos y ofrece preflight", async () => {
    const p = new Request(req(), { headers: { authorization: "Bearer clave", origin: "https://ajeno.example" } });
    expect((await GET(p)).headers.has("access-control-allow-origin")).toBe(false);
    expect((await OPTIONS(req())).status).toBe(204);
  });
  it("valida el proyecto y cuerpo antes de mutar", async () => {
    expect((await POST(req({ accion: "mensaje", texto: " " }))).status).toBe(400); expect(m.escribir).not.toHaveBeenCalled();
  });
  it("un lector puede escribir a una persona sin arrancar Len", async () => {
    m.acceso.mockResolvedValue({ rol: "lector", duenoId: "owner" });
    const r = await POST(req({ accion: "mensaje", texto: "@Luis revisa esto", menciones: ["u2", "fuera", "u1"] }));
    expect(r.status).toBe(200);
    expect(m.escribir).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", autorId: "u1", menciones: ["u2"] }));
    expect(m.len).not.toHaveBeenCalled(); expect(m.aviso).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: "u2", type: "mencion", donde: "chat" }), "mencion-chat:p1:u2", { retrasoMs: 60000 });
  });
  it.each(["hola", "@Len hola"])("no convierte un mensaje sin destinatario válido en llamada a Len: %s", async texto => {
    expect((await POST(req({ accion: "mensaje", texto, menciones: [] }))).status).toBe(400); expect(m.escribir).not.toHaveBeenCalled();
  });
  it("rechaza un hilo de otro proyecto antes de responder", async () => {
    m.hilo.mockResolvedValue(null);
    expect((await POST(req({ accion: "respuesta", hiloId: "h-ajeno", texto: "hola" }))).status).toBe(404); expect(m.responder).not.toHaveBeenCalled();
  });
  it("un lector no puede pedir a @Len aunque omita el booleano len", async () => {
    m.acceso.mockResolvedValue({ rol: "lector", duenoId: "owner" });
    expect((await POST(req({ accion: "respuesta", hiloId: "h1", texto: "@Len cambia esto" }))).status).toBe(403); expect(m.responder).not.toHaveBeenCalled(); expect(m.len).not.toHaveBeenCalled();
  });
  it("editor responde al hilo y puede pedir trabajo a Len", async () => {
    const r = await POST(req({ accion: "respuesta", hiloId: "h1", texto: "@Len revisa con @Luis", menciones: ["u2"] }));
    expect(r.status).toBe(200); expect(m.len).toHaveBeenCalledWith(expect.objectContaining({ hiloId: "h1", mensajeId: "r1", userId: "u1" }));
  });
  it("lector sólo resuelve hilos propios", async () => {
    m.acceso.mockResolvedValue({ rol: "lector", duenoId: "owner" });
    expect((await POST(req({ accion: "estado", hiloId: "h1", estado: "resuelto" }))).status).toBe(403); expect(m.estado).not.toHaveBeenCalled();
    m.hilo.mockResolvedValue({ id: "h1", creadoPor: "u1" });
    m.hilos.mockResolvedValue([{ id: "h1", creadoPor: "u1" }]);
    expect((await POST(req({ accion: "estado", hiloId: "h1", estado: "resuelto" }))).status).toBe(200);
  });
  it("marca sólo los hilos indicados y conserva el alcance del proyecto", async () => {
    expect((await POST(req({ accion: "vistas", chat: true, hilos: ["h1"] }))).status).toBe(200);
    expect(m.chatVisto).toHaveBeenCalledWith("p1", "u1"); expect(m.vistas).toHaveBeenCalledWith("p1", "u1", ["h1"]);
  });
});
