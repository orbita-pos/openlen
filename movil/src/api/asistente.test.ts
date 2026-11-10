// THE PHONE'S CALLS FOR THE PERSON'S OWN ASSISTANT (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5): her list,
// her chat with her owner, her visitors' conversations, her requests and the press on one — the routes that take the
// phone's key (app/api/assistants/**).
import { describe, expect, it, vi } from "vitest";

import { clienteDeMuestra } from "../muestra";
import { leerSuChat, leerSusPedidos, leerSusVisitas, listarAsistentes, marcarSusVisitasLeidas, tocarPedido } from "./asistente";
import { mandarALen } from "./chat";

const LUCIA = { id: "a1", name: "Lucía", slug: "lucia", shape: "blob", color: "#F4A48B", tone: "friendly", projectId: "p1", projectIds: ["p1"] };
const cliente = (respuesta: (ruta: string, init?: RequestInit) => Response) => {
  const pedir = vi.fn(async (ruta: string, init?: RequestInit) => respuesta(ruta, init));
  return { pedir, avisarAlCerrar: vi.fn() };
};

describe("her calls", () => {
  it("lists her assistants; none (or assistants off) is an empty list", async () => {
    expect(await listarAsistentes(cliente(() => Response.json({ assistants: [LUCIA] })))).toEqual([LUCIA]);
    expect(await listarAsistentes(cliente(() => Response.json({ assistants: [] })))).toEqual([]);
    await expect(listarAsistentes(cliente(() => new Response("x", { status: 500 })))).rejects.toThrow();
  });

  it("reads her chat, visits and requests, and presses a request", async () => {
    const c = cliente((ruta) =>
      ruta.endsWith("/chat") ? Response.json({ chatHistory: [{ id: "t1" }] }) : ruta.endsWith("/visits") ? Response.json({ visits: [{ id: "v1" }] }) : ruta.endsWith("/requests") ? Response.json({ cards: [{ id: "c1" }] }) : Response.json({ status: "dismissed" }),
    );
    expect(await leerSuChat(c, "a1")).toEqual([{ id: "t1" }]);
    expect(await leerSusVisitas(c, "a1")).toEqual([{ id: "v1" }]);
    expect(await leerSusPedidos(c, "a1")).toEqual([{ id: "c1" }]);
    expect(await tocarPedido(c, "a1", "c1", "dismiss")).toEqual({ ok: true });
    const [ruta, init] = c.pedir.mock.calls.at(-1)!;
    expect(ruta).toBe("/api/assistants/a1/requests/c1");
    expect(JSON.parse(String(init!.body))).toMatchObject({ action: "dismiss" });
  });

  // Phase 4E: «Conversaciones» on screen marks what it shows as read, as on the web.
  it("marcarSusVisitasLeidas posts the ids with the key", async () => {
    const c = cliente(() => Response.json({ marked: 2 }));
    expect(await marcarSusVisitasLeidas(c, "a1", [{ id: "v1", lastAt: "2026-11-09T18:34:10.000Z" }, { id: "v2", lastAt: "2026-11-09T18:34:10.000Z" }])).toBe(true);
    const [ruta, init] = c.pedir.mock.calls.at(-1)!;
    expect(ruta).toBe("/api/assistants/a1/visits/read");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual({ seen: [{ id: "v1", lastAt: "2026-11-09T18:34:10.000Z" }, { id: "v2", lastAt: "2026-11-09T18:34:10.000Z" }] });
    expect(await marcarSusVisitasLeidas(cliente(() => Response.json({ error: "not_found" }, { status: 404 })), "a1", [{ id: "v1", lastAt: "2026-11-09T18:34:10.000Z" }])).toBe(false);
  });

  it("a press the server refuses says why", async () => {
    expect(await tocarPedido(cliente(() => Response.json({ error: "already_decided" }, { status: 409 })), "a1", "c1", "accept")).toEqual({ ok: false, error: "already_decided" });
  });

  it("🔴 a message to her carries her id; one to Len doesn't", async () => {
    const c = cliente(() => new Response("event: done\ndata: {}\n\n"));
    await mandarALen(c, { projectId: "p1", prompt: "Hola", assistantId: "a1" }, () => {});
    expect(JSON.parse(String(c.pedir.mock.calls[0]![1]!.body))).toMatchObject({ projectId: "p1", prompt: "Hola", assistantId: "a1" });
    await mandarALen(c, { projectId: "p1", prompt: "Hola" }, () => {});
    expect(JSON.parse(String(c.pedir.mock.calls[1]![1]!.body))).not.toHaveProperty("assistantId");
  });

  it("the sample answers her routes", async () => {
    const [a] = await listarAsistentes(clienteDeMuestra);
    expect(a?.name).toBeTruthy();
    expect(Array.isArray(await leerSuChat(clienteDeMuestra, a!.id))).toBe(true);
    expect(Array.isArray(await leerSusVisitas(clienteDeMuestra, a!.id))).toBe(true);
    expect(Array.isArray(await leerSusPedidos(clienteDeMuestra, a!.id))).toBe(true);
  });
});
