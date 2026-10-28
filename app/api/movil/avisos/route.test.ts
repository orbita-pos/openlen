// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const dobles = vi.hoisted(() => ({ usuario: vi.fn(), guardar: vi.fn(), borrar: vi.fn(), activa: vi.fn(), configurado: vi.fn() }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: dobles.usuario }));
vi.mock("@/lib/movil/avisos", () => ({ guardarAvisos: dobles.guardar, borrarAvisos: dobles.borrar, avisosActivos: dobles.activa }));
vi.mock("@/lib/notifications/channels/fcm-transporte", () => ({ fcmDisponible: dobles.configurado }));
import { GET, POST, DELETE } from "./route";
const llave = "a".repeat(43);
const req = (method: string, body?: object, bearer = true) => new Request("https://openlen.com/api/movil/avisos", { method, headers: { ...(bearer ? { authorization: `Bearer ${llave}` } : {}), "content-type": "application/json", origin: "https://localhost" }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { vi.resetAllMocks(); dobles.usuario.mockResolvedValue("ana"); dobles.configurado.mockReturnValue(true); dobles.activa.mockResolvedValue(false); });
describe("registro nativo autenticado", () => {
  it("no acepta cookies ni identidad mandada en el cuerpo", async () => {
    expect((await POST(req("POST", { token: "x".repeat(120), userId: "otra" }, false))).status).toBe(401);
    dobles.usuario.mockResolvedValue(null);
    expect((await POST(req("POST", { token: "x".repeat(120) }))).status).toBe(401);
    expect(dobles.guardar).not.toHaveBeenCalled();
  });
  it("liga token y rotación exclusivamente a la llave autenticada", async () => {
    expect((await POST(req("POST", { token: "x".repeat(120), userId: "otra" }))).status).toBe(204);
    expect(dobles.guardar).toHaveBeenCalledWith("ana", llave, "x".repeat(120));
  });
  it("baja sólo el dispositivo de esa sesión", async () => {
    expect((await DELETE(req("DELETE"))).status).toBe(204);
    expect(dobles.borrar).toHaveBeenCalledWith("ana", llave);
  });
  it("configuración ausente es un estado honesto y no registra", async () => {
    dobles.configurado.mockReturnValue(false);
    const estado = await GET(req("GET"));
    expect(await estado.json()).toEqual({ disponible: false, activa: false, recipientUserId: "ana" });
    expect((await POST(req("POST", { token: "x".repeat(120) }))).status).toBe(503);
    expect(dobles.guardar).not.toHaveBeenCalled();
  });
  it("rechaza tokens y cuerpos inválidos sin tocar la base", async () => {
    expect((await POST(req("POST", { token: " " }))).status).toBe(400);
    expect((await POST(req("POST", { token: "a".repeat(4097) }))).status).toBe(400);
    expect(dobles.guardar).not.toHaveBeenCalled();
  });
});
