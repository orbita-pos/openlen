// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { configuracionFcm, crearTransporteFcm, mensajeFcm } from "./channels/fcm-transporte";
import { enviarAvisosNativos } from "./channels/fcm-envio";

const evento = { type: "len_turno", projectId: "proyecto-1", recipientUserId: "ana", preview: "Listo", pregunta: true } as const;
const cuenta = { project_id: "prueba-local", client_email: "prueba@example.invalid", private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

describe("FCM sin servicios externos", () => {
  it("sin credenciales o con clave inválida queda deshabilitado", () => {
    expect(configuracionFcm(undefined)).toBeNull();
    expect(configuracionFcm("{}" )).toBeNull();
    expect(configuracionFcm(JSON.stringify({ ...cuenta, private_key: "incorrecta" }))).toBeNull();
  });
  it("incluye proyecto y destinatario para abrir sólo la cuenta correcta", () => {
    expect(mensajeFcm(evento, "token")).toMatchObject({ message: { token: "token", notification: { title: "Len", body: "❓ Listo" }, data: { projectId: "proyecto-1", recipientUserId: "ana", type: "len_turno" } } });
  });
  it("los avisos del correo del proyecto también llegan con texto", () => {
    const base = { projectId: "proyecto-1", recipientUserId: "ana" };
    expect(mensajeFcm({ ...base, type: "email_domain", domain: "pan.mx", status: "ready" }, "t").message.notification.body).toContain("pan.mx");
    expect(mensajeFcm({ ...base, type: "email_quota", percent: 80, sent: 800, included: 1000, noCredits: false }, "t").message.notification.body).toBe("80% · 800 / 1000");
  });
  it("el token no registrado se borra y no se reintenta", async () => {
    const borrados: string[] = [];
    const r = await enviarAvisosNativos(evento, { tokens: async () => ["caducado"], enviar: async () => "invalid", borrar: async (token) => { borrados.push(token); } });
    expect(r).toBe("skipped");
    expect(borrados).toEqual(["caducado"]);
  });
  it("errores transitorios llegan a la cola para reintentar", async () => {
    await expect(enviarAvisosNativos(evento, { tokens: async () => ["actual"], enviar: async () => { throw new Error("503"); }, borrar: async () => {} })).rejects.toThrow();
  });
  it("un éxito evita repetir avisos si otro teléfono falló", async () => {
    expect(await enviarAvisosNativos(evento, { tokens: async () => ["uno", "dos"], enviar: async (token) => { if (token === "dos") throw Error("503"); return "sent"; }, borrar: async () => {} })).toBe("sent");
  });
  it("firma OAuth y reconoce UNREGISTERED sin imprimir credenciales", async () => {
    const solicitudes: { url: string; body: string }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      solicitudes.push({ url: String(url), body: String(init?.body) });
      return solicitudes.length === 1 ? Response.json({ access_token: "acceso", expires_in: 3600 }) : Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
    });
    const enviar = crearTransporteFcm(configuracionFcm(JSON.stringify(cuenta))!, fetcher);
    expect(await enviar("token", evento)).toBe("invalid");
    expect(solicitudes[0].url).toBe("https://oauth2.googleapis.com/token");
    const assertion = new URLSearchParams(solicitudes[0].body).get("assertion")!;
    expect(JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString())).toMatchObject({ iss: cuenta.client_email, aud: "https://oauth2.googleapis.com/token" });
    expect(solicitudes[1].url).toBe("https://fcm.googleapis.com/v1/projects/prueba-local/messages:send");
  });
  it("INVALID_ARGUMENT no elimina tokens: puede ser un error del mensaje", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "acceso", expires_in: 3600 })).mockResolvedValueOnce(Response.json({ error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } }, { status: 400 }));
    await expect(crearTransporteFcm(configuracionFcm(JSON.stringify(cuenta))!, fetcher)("token", evento)).rejects.toThrow("FCM 400");
  });
});
