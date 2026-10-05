// POST /api/agent/responder (pieza 3 de Len 2.5): la respuesta del dueño a una
// pregunta de Len, mientras el turno espera. Mismo control que /dirigir: sesión
// y dueño del turno, y «no es tuyo» se responde igual que «no existe».
import { beforeEach, describe, expect, it, vi } from "vitest";

const quien = vi.hoisted(() => ({ userId: "u1" as string | null }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: async () => quien.userId }));

import { POST } from "./route";
import { _vaciarTodo, abrirTurno, esperarRespuesta } from "@/lib/agent/direcciones";
import { QUESTION_DISMISSED } from "@/lib/agent/ask-user-question";

const pedir = (cuerpo: unknown) =>
  POST(new Request("http://localhost/api/agent/responder", { method: "POST", body: JSON.stringify(cuerpo), headers: { "content-type": "application/json" } }));
const respuesta = [{ id: "plazo", selected: ["48 horas"] }];

beforeEach(() => {
  _vaciarTodo();
  quien.userId = "u1";
});

describe("POST /api/agent/responder", () => {
  it("401 sin sesión", async () => {
    quien.userId = null;
    expect((await pedir({ turnoId: "t1", answers: respuesta })).status).toBe(401);
  });

  it("400 sin turno", async () => {
    expect((await pedir({ answers: respuesta })).status).toBe(400);
  });

  it("200 y la respuesta llega a quien espera", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    const r = await pedir({ turnoId: "t1", answers: respuesta });
    expect(r.status).toBe(200);
    expect(await espera).toEqual(respuesta);
  });

  it("🔴 404 igual para el turno de otro y para uno que no existe", async () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    quien.userId = "otro";
    const ajeno = await pedir({ turnoId: "t1", answers: respuesta });
    const nadie = await pedir({ turnoId: "nadie", answers: respuesta });
    expect([ajeno.status, nadie.status]).toEqual([404, 404]);
    expect(await ajeno.json()).toEqual(await nadie.json());
  });

  it("409 con su código: sin pregunta (cae a mensaje normal) o ya respondida (no hace nada)", async () => {
    abrirTurno("t1", "u1");
    const sin = await pedir({ turnoId: "t1", answers: respuesta });
    expect(sin.status).toBe(409);
    expect(await sin.json()).toEqual({ error: "sin_pregunta" });
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    await pedir({ turnoId: "t1", answers: respuesta });
    const otra = await pedir({ turnoId: "t1", answers: respuesta });
    expect(otra.status).toBe(409);
    expect(await otra.json()).toEqual({ error: "ya_respondida" });
  });

  it("LOTE 7-8 · dismiss: 200 y quien espera recibe el descarte", async () => {
    abrirTurno("t1", "u1");
    const espera = esperarRespuesta("t1", { timeoutMs: 60_000 });
    const r = await pedir({ turnoId: "t1", dismiss: true });
    expect(r.status).toBe(200);
    expect(await espera).toBe(QUESTION_DISMISSED);
  });

  it("dismiss sin nadie esperando: 409 sin_pregunta; de otro: 404", async () => {
    abrirTurno("t1", "u1");
    const sin = await pedir({ turnoId: "t1", dismiss: true });
    expect([sin.status, await sin.json()]).toEqual([409, { error: "sin_pregunta" }]);
    quien.userId = "otro";
    expect((await pedir({ turnoId: "t1", dismiss: true })).status).toBe(404);
  });

  it("400 con una respuesta mal formada", async () => {
    abrirTurno("t1", "u1");
    void esperarRespuesta("t1", { timeoutMs: 60_000 });
    expect((await pedir({ turnoId: "t1", answers: "48 horas" })).status).toBe(400);
  });
});
