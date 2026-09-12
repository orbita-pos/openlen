import { describe, expect, it, vi, beforeEach } from "vitest";

// 🔴 LO QUE SUJETA ESTA PRUEBA: que un fallo de base NO le devuelva al navegador
// la consulta con sus `params`.
//
// MEDIDO el 2026-09-12 con un error real en produccion-local. La ruta hacia
// `return json({ error: \`Server error: ${err.message}\` })`, y el mensaje de
// `pg` trae el SQL entero; el usuario vio en pantalla su propio
// `insert into "users" (…)` y, entre los parametros, **su hash de bcrypt**.
//
// Las tres rutas de credenciales tenian la misma linea. `forgot` es la peor: el
// parametro que saldria ahi es el TOKEN de recuperacion — toma de cuenta
// directa. Y su codigo lleva escrito «Always succeed — don't leak whether the
// email exists» tres lineas mas arriba: guardaba la puerta de delante y dejaba
// la de atras abierta.

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  checkAndConsume: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ eq: (l: unknown, r: unknown) => ({ l, r }) }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "$2b$10$HASH_SECRETO_QUE_NO_DEBE_SALIR" } }));
vi.mock("@/lib/limits", () => ({
  IP_LIMITS: { register: { limit: 5, windowMs: 1000 } },
  checkAndConsume: mocks.checkAndConsume,
  getClientIp: () => "1.2.3.4",
  ipLimitKey: () => "k",
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
  schema: { users: { id: "id", email: "email" } },
}));

import { POST } from "./route";

const HASH = "$2b$10$HASH_SECRETO_QUE_NO_DEBE_SALIR";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAndConsume.mockResolvedValue({ ok: true });
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }));
});

const pide = () =>
  new Request("http://x/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: "a@b.com", password: "unaclavelarga", name: "JESUSB" }),
  });

describe("POST /api/auth/register — un fallo de base no filtra nada", () => {
  it("no devuelve el hash ni el SQL cuando el insert revienta", async () => {
    // El mensaje REAL de `pg`, con su cola de params — es lo que se veia.
    mocks.insert.mockImplementation(() => {
      throw new Error(
        'Failed query: insert into "users" ("id", "name", "email", "agentEffort", "passwordHash") '
        + 'values ($1, $2, $3, default, $4) params: 690c8659,JESUSB,a@b.com,' + HASH,
      );
    });

    const res = await POST(pide());
    const cuerpo = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(cuerpo).not.toContain(HASH);
    expect(cuerpo).not.toContain("params:");
    expect(cuerpo).not.toContain("insert into");
    expect(cuerpo).not.toContain("passwordHash");
  });

  // BRAZO DE CONTROL: que no filtre no puede ser porque no conteste. El cliente
  // sigue recibiendo un 500 con un `error` legible.
  it("BRAZO DE CONTROL: sigue contestando un error utilizable", async () => {
    mocks.insert.mockImplementation(() => { throw new Error("boom con $2b$10$OTRO"); });
    const res = await POST(pide());
    const j = (await res.json()) as { error?: string };
    expect(res.status).toBe(500);
    expect(typeof j.error).toBe("string");
    expect(j.error!.length).toBeGreaterThan(0);
    expect(j.error).not.toContain("$2b$10$");
  });
});
