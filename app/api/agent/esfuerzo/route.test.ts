import { describe, expect, it, vi, beforeEach } from "vitest";

// LA RUTA QUE LE FALTABA A LA COLUMNA. `users.agentEffort` nació con lector
// (`esfuerzo-guardado.ts`) y sin ESCRITOR — la forma exacta de
// [[la-palanca-que-no-vuelve-a-ningun-sitio]]. Lo que estas pruebas sujetan es
// lo que hace que la columna signifique algo: que valide contra el MISMO
// vocabulario que lee el turno, y que `auto` se guarde como NULL en vez de
// como la cadena "auto" (dos valores para un solo estado).

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  guardado: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("drizzle-orm", () => ({ eq: (l: unknown, r: unknown) => ({ op: "eq", l, r }) }));
vi.mock("@/lib/agent/esfuerzo-guardado", () => ({ getEsfuerzoGuardado: mocks.guardado }));
vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: mocks.set }) },
  schema: { users: { id: "users.id", agentEffort: "users.agentEffort" } },
}));

import { GET, PUT } from "./route";
import { NIVEL_POR_DEFECTO } from "@/lib/agent/esfuerzo";

const pide = (body: unknown) =>
  new Request("http://x/api/agent/esfuerzo", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.set.mockImplementation(() => ({ where: mocks.where }));
  mocks.where.mockResolvedValue(undefined);
  mocks.guardado.mockResolvedValue(null);
});

describe("PUT /api/agent/esfuerzo", () => {
  it("guarda un nivel del vocabulario", async () => {
    const res = await PUT(pide({ esfuerzo: "xhigh" }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ agentEffort: "xhigh" });
  });

  // `auto` es «no eligió», que es lo que NULL ya significa en esa columna.
  // Guardar la cadena obligaría al lector a tratar dos valores como un estado.
  it("`auto` se guarda como NULL, no como la cadena", async () => {
    await PUT(pide({ esfuerzo: "auto" }));
    expect(mocks.set).toHaveBeenCalledWith({ agentEffort: null });
  });

  it("un valor fuera del vocabulario se RECHAZA y no escribe", async () => {
    const res = await PUT(pide({ esfuerzo: "none" }));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  // BRAZO DE CONTROL del de arriba: que rechace `none` no puede ser porque
  // rechace todo. `max` es el nivel NUEVO de la escalera y tiene que entrar.
  it("BRAZO DE CONTROL: `max` sí entra", async () => {
    const res = await PUT(pide({ esfuerzo: "max" }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ agentEffort: "max" });
  });

  it("sin sesión no escribe nada", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await PUT(pide({ esfuerzo: "low" }));
    expect(res.status).toBe(401);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON da 400 en vez de reventar", async () => {
    const res = await PUT(
      new Request("http://x/api/agent/esfuerzo", { method: "PUT", body: "{no" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/agent/esfuerzo", () => {
  it("sin preferencia contesta `auto` y dice a qué resuelve", async () => {
    const res = await GET();
    expect(await res.json()).toMatchObject({ esfuerzo: "auto", resuelveA: NIVEL_POR_DEFECTO });
  });

  it("con preferencia guardada, la devuelve", async () => {
    mocks.guardado.mockResolvedValue("low");
    expect(await (await GET()).json()).toMatchObject({ esfuerzo: "low" });
  });
});
