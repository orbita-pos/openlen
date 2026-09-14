import { describe, expect, it, vi, beforeEach } from "vitest";

// LA FRONTERA DEL SELECTOR DE CREAR. Lo que estas pruebas sujetan es lo que
// hace que la columna signifique algo, y es lo mismo que sujeta su gemela de
// `/api/agent/esfuerzo`: que se valide contra el MISMO vocabulario que usa el
// turno, y que «Automático» se guarde como NULL en vez de como una cadena (dos
// valores para un solo estado).
//
// 🔴 Y una que allí no hace falta: aquí lo que llega del navegador podría ser un
// ID DE MODELO. No puede pasar. El selector elige PAPELES precisamente para que
// el modelo y su tarifa sigan viajando juntos en `MODEL_POLICY`; un id colado
// por el cuerpo sería un modelo elegido por el cliente y cobrado a la tarifa de
// otro.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  guardado: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("drizzle-orm", () => ({ eq: (l: unknown, r: unknown) => ({ op: "eq", l, r }) }));
vi.mock("@/lib/ai/escritor-guardado", () => ({ getEscritorGuardado: mocks.guardado }));
vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: mocks.set }) },
  schema: { users: { id: "users.id", crearWriter: "users.crearWriter" } },
}));

import { GET, PUT } from "./route";

const pide = (body: unknown) =>
  new Request("http://x/api/crear/escritor", { method: "PUT", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.set.mockImplementation(() => ({ where: mocks.where }));
  mocks.where.mockResolvedValue(undefined);
  mocks.guardado.mockResolvedValue(null);
});

describe("PUT /api/crear/escritor", () => {
  it("guarda un papel del vocabulario", async () => {
    const res = await PUT(pide({ escritor: "visual_critic" }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ crearWriter: "visual_critic" });
  });

  // «Automático» es «no eligió», que es lo que NULL ya significa en la columna.
  it("«Automático» se guarda como NULL", async () => {
    const res = await PUT(pide({ escritor: null }));
    expect(res.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ crearWriter: null });
  });

  // 🔴 LA QUE IMPORTA: un id de modelo por el cuerpo no entra. Ni el de un
  // modelo que existe de verdad y corre en este mismo repo.
  it("rechaza un id de modelo, aunque sea uno real", async () => {
    const res = await PUT(pide({ escritor: "accounts/fireworks/models/deepseek-v4p1-flash" }));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rechaza un papel que existe en la política pero no se puede fijar", async () => {
    // `agent` es un papel de `MODEL_POLICY`, pero no escribe páginas de Crear.
    const res = await PUT(pide({ escritor: "agent" }));
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es JSON no revienta la ruta", async () => {
    const res = await PUT(
      new Request("http://x/api/crear/escritor", { method: "PUT", body: "{ no json" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("sin sesión no escribe nada", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await PUT(pide({ escritor: "reasoner" }));
    expect(res.status).toBe(401);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("GET /api/crear/escritor", () => {
  it("devuelve lo guardado", async () => {
    mocks.guardado.mockResolvedValue("reasoner");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ escritor: "reasoner" });
  });

  // El lector degrada a `null` cuando la base tarda, falla, o la columna aún no
  // está migrada. La ruta tiene que devolver eso tal cual: `null` es
  // «Automático», que es lo que Crear ha hecho siempre.
  it("sin preferencia devuelve null, que es «Automático»", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ escritor: null });
  });

  it("sin sesión no contesta la preferencia de nadie", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.guardado).not.toHaveBeenCalled();
  });
});
