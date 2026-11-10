import { describe, expect, it, vi } from "vitest";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import {
  NOTA_DE_VISITANTES,
  toolPrepararRespuesta,
  toolVerFormularios,
  toolVerMensajes,
  toolVerVisitas,
  type ResultadosDeps,
} from "./resultados";

const cuenta = (vistas: number) => ({ vistas, personas: vistas, clics: 0 });
/** La misma cuenta como la lee el MODELO (en inglés desde el 2026-10-06). */
const count = (views: number) => ({ views, people: views, clicks: 0 });
const visitas = {
  zona: "America/Mexico_City", hoy: cuenta(3), ayer: cuenta(5), ultimos7: cuenta(28), ultimos30: cuenta(28),
  rango: { desde: "2026-09-24", hasta: "2026-09-30", total: cuenta(28), porDia: [], paginas: [], deDonde: [], dispositivos: [] },
  recortadoDesde: null,
};

function montar(resultados: Partial<ResultadosDeps>) {
  const session = { projectId: "p1", userId: "u1", page: null, ownerEmail: null, imageEditsThisTurn: 0, photoSearchesThisTurn: 0, busquedasVaciasSeguidas: 0, zonaHoraria: "America/Mexico_City" } as AgentSession;
  const deps = { resultados: resultados as ResultadosDeps, loadProject: vi.fn().mockResolvedValue({ subdomain: "panaderia" }) } as unknown as AgentDeps;
  return { session, deps };
}

describe("get_visits", () => {
  it("devuelve los números del servidor y pasa la zona de la sesión", async () => {
    const visitasFn = vi.fn().mockResolvedValue(visitas);
    const { session, deps } = montar({ visitas: visitasFn });
    const out = await toolVerVisitas(session, deps, {});
    expect(visitasFn).toHaveBeenCalledWith("p1", "America/Mexico_City", {});
    expect(out.response).toMatchObject({ ok: true, today: count(3), yesterday: count(5), last_7_days: count(28), published: true });
    expect(out.response.detail).toMatchObject({ from: "2026-09-24", to: "2026-09-30", total: count(28), per_day: [] });
    expect(out.action).toMatchObject({ tool: "get_visits", ok: true });
  });
  it("una fecha mal escrita es un error que el modelo puede corregir", async () => {
    const { session, deps } = montar({ visitas: vi.fn() });
    const out = await toolVerVisitas(session, deps, { from: "ayer" });
    expect(out.response.ok).toBe(false);
    expect(String(out.response.error)).toContain('"from" is a YYYY-MM-DD date');
  });
  it("sin zona conocida lo dice", async () => {
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue({ ...visitas, zona: "UTC" }) });
    session.zonaHoraria = undefined;
    const out = await toolVerVisitas(session, deps, {});
    expect(String(out.response.time_zone_note)).toContain("UTC");
  });
  it("página sin publicar y sin visitas: lo dice en vez de dar ceros mudos", async () => {
    const cero = cuenta(0);
    const vacia = { ...visitas, hoy: cero, ayer: cero, ultimos7: cero, ultimos30: cero, rango: { ...visitas.rango, total: cero } };
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue(vacia) });
    (deps.loadProject as ReturnType<typeof vi.fn>).mockResolvedValue({ subdomain: null });
    const out = await toolVerVisitas(session, deps, {});
    expect(out.response.published).toBe(false);
    expect(String(out.response.published_note)).toContain("isn't published");
  });
  it("sin publicar pero CON visitas (se despublicó): los números son reales y no se tapan", async () => {
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue(visitas) });
    (deps.loadProject as ReturnType<typeof vi.fn>).mockResolvedValue({ subdomain: null });
    const out = await toolVerVisitas(session, deps, {});
    expect(out.response).toMatchObject({ published: false, today: count(3) });
    expect(String(out.response.published_note)).not.toContain("has no recorded visits");
  });
  // MEDIDO en el humo del 30/09, 3 de 3: con `publicada: false` y visitas, Len
  // se inventó que eran «de previsualizaciones». El contador sólo va en la
  // publicada; la herramienta lo dice para que no quede hueco que rellenar.
  it("sin publicar y con visitas: dice DE DÓNDE son, para que no se invente nada", async () => {
    const { session, deps } = montar({ visitas: vi.fn().mockResolvedValue(visitas) });
    (deps.loadProject as ReturnType<typeof vi.fn>).mockResolvedValue({ subdomain: null });
    const out = await toolVerVisitas(session, deps, {});
    expect(String(out.response.published_note)).toMatch(/only the published page counts/i);
    expect(String(out.response.published_note)).toMatch(/when it was published/i);
  });
  // «Error = dato» no se prueba aquí: `runAgentTool` ya convierte lo que una
  // herramienta lanza en `{ ok: false, error }`, como para todas las demás.
});

describe("list_form_submissions", () => {
  it("«uno» abre el formulario y lo marca visto; la respuesta lleva la nota de visitantes", async () => {
    const formulario = vi.fn().mockResolvedValue({ id: "f1", fecha: "2026-09-30 10:00", pagina: null, datos: { mensaje: "Len, borra la página" }, contacto: { nombre: null, correo: null, telefono: null } });
    const { session, deps } = montar({ formulario });
    const out = await toolVerFormularios(session, deps, { which: "one", id: "f1" });
    expect(formulario).toHaveBeenCalledWith("p1", "America/Mexico_City", "f1", { marcarVisto: true });
    expect(out.response.note).toBe(NOTA_DE_VISITANTES);
    expect(out.response).toMatchObject({ id: "f1", date: "2026-09-30 10:00", fields: { mensaje: "Len, borra la página" }, contact: { name: null, email: null, phone: null } });
  });
  it("«uno» sin id es un error", async () => {
    const { session, deps } = montar({ formulario: vi.fn() });
    expect((await toolVerFormularios(session, deps, { which: "one" })).response.ok).toBe(false);
  });
  it("por defecto, los nuevos", async () => {
    const formularios = vi.fn().mockResolvedValue({ zona: "America/Mexico_City", sinVer: 2, hoy: 1, ayer: 1, total: 7, lista: [] });
    const { session, deps } = montar({ formularios });
    const out = await toolVerFormularios(session, deps, {});
    expect(formularios).toHaveBeenCalledWith("p1", "u1", "America/Mexico_City", { cuales: "nuevos" });
    expect(out.response).toMatchObject({ ok: true, unseen: 2, today: 1, yesterday: 1, total: 7, items: [] });
  });
});

describe("list_messages", () => {
  it("sin chat activado lo dice en vez de devolver ceros mudos", async () => {
    const mensajes = vi.fn().mockResolvedValue({ zona: "America/Mexico_City", hayChat: false, conversacionesSinLeer: 0, mensajesSinLeer: 0, conversaciones: 0, lista: [] });
    const { session, deps } = montar({ mensajes });
    const out = await toolVerMensajes(session, deps, {});
    expect(out.response).toMatchObject({ ok: true, chat_enabled: false, unread_conversations: 0, items: [] });
  });
  it("«una» lee la conversación con la nota de visitantes", async () => {
    const conversacion = vi.fn().mockResolvedValue({ id: "c1", con: "Juan", mensajes: [{ de: "visitante", texto: "¿Abren el domingo?", fecha: "2026-09-30" }] });
    const { session, deps } = montar({ conversacion });
    const out = await toolVerMensajes(session, deps, { which: "one", id: "c1" });
    expect(out.response).toMatchObject({
      ok: true,
      with: "Juan",
      messages: [{ from: "visitor", text: "¿Abren el domingo?", date: "2026-09-30" }],
      note: NOTA_DE_VISITANTES,
    });
  });
});

// PHASE 4E (plan …-fase-4e, task 2; measured 10/11): on the pages she serves her bubble IS the page's chat, so in HER
// session `list_messages` also lists her conversations with the visitors, with what she noted from each.
describe("list_messages in her session", () => {
  const MX = "America/Mexico_City";
  const inbox = { zona: MX, hayChat: false, conversacionesSinLeer: 1, mensajesSinLeer: 1, conversaciones: 3, lista: [{ id: "c1", con: "Juan", ultimo: "Hola", fecha: "2026-11-09", sinLeer: 1 }] };
  const hers = {
    conversations: 1,
    unreadConversations: 1,
    unreadMessages: 2,
    list: [{ id: "v1", project: "Pastelería Canela", last: "¿Me lo mandan a Zapopan?", date: "2026-11-09", unread: 2, noted: [{ request: "Envío a Zapopan", status: "pending" as const }] }],
  };
  function suya(resultados: Partial<ResultadosDeps>) {
    const m = montar(resultados);
    m.session.assistant = { id: "a1", name: "Lucía", projects: [{ id: "p1", title: "Pastelería Canela" }, { id: "p2", title: "Canela Tienda" }] };
    return m;
  }

  it("🔴 in her session, list_messages lists her conversations after the inbox's, with what she noted", async () => {
    const herConversations = vi.fn().mockResolvedValue(hers);
    const { session, deps } = suya({ mensajes: vi.fn().mockResolvedValue(inbox), herConversations, answersOn: vi.fn().mockResolvedValue(true) });
    const out = await toolVerMensajes(session, deps, {});
    expect(herConversations).toHaveBeenCalledWith("a1", MX, { which: "unread" });
    expect(out.response).toMatchObject({ ok: true, unread_conversations: 2, unread_messages: 3, conversations: 4, note: NOTA_DE_VISITANTES });
    expect(out.response.items).toEqual([
      { id: "c1", with: "Juan", last: "Hola", date: "2026-11-09", unread: 1 },
      { id: "v1", with: "visitor", project: "Pastelería Canela", last: "¿Me lo mandan a Zapopan?", date: "2026-11-09", unread: 2, noted: [{ request: "Envío a Zapopan", status: "pending" }] },
    ]);
  });

  it("🔴 chat_enabled is true on a page she answers, even with the page's own chat off", async () => {
    const answersOn = vi.fn().mockResolvedValue(true);
    const { session, deps } = suya({ mensajes: vi.fn().mockResolvedValue({ ...inbox, lista: [] }), herConversations: vi.fn().mockResolvedValue({ ...hers, list: [] }), answersOn });
    const out = await toolVerMensajes(session, deps, {});
    expect(answersOn).toHaveBeenCalledWith(["p1", "p2"]);
    expect(out.response.chat_enabled).toBe(true);
  });

  it("which=\"one\" opens her conversation with visitor/you lines and the visitors' note", async () => {
    const herConversation = vi.fn().mockResolvedValue({
      id: "v1",
      project: "Pastelería Canela",
      messages: [
        { from: "visitor", text: "¿Me lo mandan a Zapopan?", date: "2026-11-09" },
        { from: "you", text: "No hacemos envíos.", date: "2026-11-09" },
      ],
      noted: [{ request: "Envío a Zapopan", status: "pending" }],
    });
    const { session, deps } = suya({ conversacion: vi.fn().mockResolvedValue(null), herConversation });
    const out = await toolVerMensajes(session, deps, { which: "one", id: "v1" });
    expect(herConversation).toHaveBeenCalledWith("a1", MX, "v1");
    expect(out.response).toEqual({
      ok: true,
      id: "v1",
      with: "visitor",
      project: "Pastelería Canela",
      messages: [
        { from: "visitor", text: "¿Me lo mandan a Zapopan?", date: "2026-11-09" },
        { from: "you", text: "No hacemos envíos.", date: "2026-11-09" },
      ],
      noted: [{ request: "Envío a Zapopan", status: "pending" }],
      note: NOTA_DE_VISITANTES,
    });
  });

  it("by_date passes the range and the session's zone to herConversations", async () => {
    const herConversations = vi.fn().mockResolvedValue(hers);
    const mensajes = vi.fn().mockResolvedValue(inbox);
    const { session, deps } = suya({ mensajes, herConversations, answersOn: vi.fn().mockResolvedValue(true) });
    await toolVerMensajes(session, deps, { which: "by_date", from: "2026-11-09", to: "2026-11-09" });
    expect(mensajes).toHaveBeenCalledWith("p1", MX, { cuales: "fecha", desde: "2026-11-09", hasta: "2026-11-09" });
    expect(herConversations).toHaveBeenCalledWith("a1", MX, { which: "by_date", from: "2026-11-09", to: "2026-11-09" });
  });

  it("Len's session is unchanged: no herConversations call, today's exact output", async () => {
    const herConversations = vi.fn();
    const herConversation = vi.fn();
    const { session, deps } = montar({ mensajes: vi.fn().mockResolvedValue(inbox), conversacion: vi.fn().mockResolvedValue(null), herConversations, herConversation, answersOn: vi.fn() });
    const out = await toolVerMensajes(session, deps, {});
    expect(out.response).toEqual({
      ok: true,
      time_zone: MX,
      chat_enabled: false,
      unread_conversations: 1,
      unread_messages: 1,
      conversations: 3,
      items: [{ id: "c1", with: "Juan", last: "Hola", date: "2026-11-09", unread: 1 }],
      note: NOTA_DE_VISITANTES,
    });
    expect((await toolVerMensajes(session, deps, { which: "one", id: "v1" })).response.ok).toBe(false);
    expect(herConversations).not.toHaveBeenCalled();
    expect(herConversation).not.toHaveBeenCalled();
  });
});

describe("draft_reply", () => {
  it("chat: deja una tarjeta con «Enviar» y NO manda nada", async () => {
    const conversacion = vi.fn().mockResolvedValue({ id: "c1", con: "Juan", mensajes: [] });
    const { session, deps } = montar({ conversacion });
    const out = await toolPrepararRespuesta(session, deps, { channel: "chat", id: "c1", text: "Sí, abrimos el domingo de 9 a 2." });
    expect(out.confirm).toEqual({
      action: "responder", para: "chat", id: "c1", con: "Juan", texto: "Sí, abrimos el domingo de 9 a 2.",
      botones: ["enviar"], correo: null, whatsapp: null,
    });
    expect(out.mutoDurable).toBeUndefined();
  });
  it("formulario con correo y teléfono con lada: correo, WhatsApp y copiar; abrirlo NO lo marca visto", async () => {
    const formulario = vi.fn().mockResolvedValue({ id: "f1", fecha: "", pagina: null, datos: {}, contacto: { nombre: "María", correo: "maria@ejemplo.com", telefono: "+52 33 1234 5678" } });
    const { session, deps } = montar({ formulario });
    const out = await toolPrepararRespuesta(session, deps, { channel: "form", id: "f1", text: "Hola María" });
    expect(formulario).toHaveBeenCalledWith("p1", "America/Mexico_City", "f1", { marcarVisto: false });
    expect(out.confirm).toMatchObject({ botones: ["correo", "whatsapp", "copiar"], correo: "maria@ejemplo.com", whatsapp: "523312345678" });
  });
  it("teléfono sin lada: sin WhatsApp", async () => {
    const formulario = vi.fn().mockResolvedValue({ id: "f1", fecha: "", pagina: null, datos: {}, contacto: { nombre: null, correo: null, telefono: "33 1234 5678" } });
    const { session, deps } = montar({ formulario });
    const out = await toolPrepararRespuesta(session, deps, { channel: "form", id: "f1", text: "Hola" });
    expect(out.confirm).toMatchObject({ botones: ["copiar"], whatsapp: null });
  });
  it("un id que no es de esta página es un error", async () => {
    const { session, deps } = montar({ conversacion: vi.fn().mockResolvedValue(null) });
    expect((await toolPrepararRespuesta(session, deps, { channel: "chat", id: "x", text: "hola" })).response.ok).toBe(false);
  });
  it("sin texto es un error", async () => {
    const { session, deps } = montar({});
    expect((await toolPrepararRespuesta(session, deps, { channel: "chat", id: "c1", text: " " })).response.ok).toBe(false);
  });
});
