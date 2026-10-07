// @vitest-environment node
// POST /turnos/[turnId]/deshacer — cada motivo con su código, y sin sesión nada.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), deshacerTurno: vi.fn() }));
// Compartir el proyecto: aquí quien pide es el dueño (ver acceso-de-prueba.ts).
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/deshacer-turno", () => ({ deshacerTurno: mocks.deshacerTurno }));

import { POST } from "./route";

const pide = (turnId = "t1") =>
  POST(new Request("https://openlen.com/api/projects/p1/turnos/t1/deshacer", { method: "POST" }), {
    params: Promise.resolve({ id: "p1", turnId }),
  });

beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  mocks.deshacerTurno.mockReset();
});

describe("POST /turnos/[turnId]/deshacer", () => {
  it("200 con las páginas y los ficheros que volvieron, para el dueño", async () => {
    mocks.deshacerTurno.mockResolvedValue({ ok: true, paginas: [{ page: null, html: "<p>a</p>" }], ficheros: ["/src/App.jsx"], noSeDeshacen: [], deshacerId: "d1" });
    const res = await pide();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paginas: [{ page: null, html: "<p>a</p>" }], ficheros: ["/src/App.jsx"], noSeDeshacen: [], deshacerId: "d1" });
    expect(mocks.deshacerTurno).toHaveBeenCalledWith({ projectId: "p1", userId: "u1", turnId: "t1" });
  });

  it("🔴 409 se_solapan con las rutas que cambió alguien después", async () => {
    mocks.deshacerTurno.mockResolvedValue({ ok: false, motivo: "se_solapan", rutas: ["/src/App.jsx"] });
    const res = await pide();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "se_solapan", rutas: ["/src/App.jsx"] });
  });

  it("los demás motivos", async () => {
    for (const [r, status, cuerpo] of [
      [{ ok: false, motivo: "sin_registro" }, 404, { error: "sin_registro" }],
      [{ ok: false, motivo: "no_encontrado" }, 404, { error: "not_found" }],
      [{ ok: false, motivo: "ya_deshecho" }, 409, { error: "ya_deshecho" }],
      [{ ok: false, motivo: "sin_cambios", noSeDeshacen: ["/supabase/x.sql"] }, 409, { error: "sin_cambios", noSeDeshacen: ["/supabase/x.sql"] }],
      [{ ok: false, motivo: "conflicto" }, 503, { error: "conflicto" }],
    ] as const) {
      mocks.deshacerTurno.mockResolvedValueOnce(r);
      const res = await pide();
      expect(res.status, JSON.stringify(r)).toBe(status);
      expect(await res.json()).toEqual(cuerpo);
    }
  });

  it("sin sesión, 401 y no se toca nada", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await pide()).status).toBe(401);
    expect(mocks.deshacerTurno).not.toHaveBeenCalled();
  });
});
