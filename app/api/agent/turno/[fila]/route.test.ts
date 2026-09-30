import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  turnoDeLaFila: vi.fn(),
  leerTurnoDelUsuario: vi.fn(),
  marcarCortadaSiSigueEnCurso: vi.fn(async () => {}),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agent/direcciones", () => ({ turnoDeLaFila: mocks.turnoDeLaFila }));
vi.mock("@/lib/projects/chat", () => ({
  leerTurnoDelUsuario: mocks.leerTurnoDelUsuario,
  marcarCortadaSiSigueEnCurso: mocks.marcarCortadaSiSigueEnCurso,
}));

import { GET } from "./route";

const pedir = async (fila = "fila-1") => {
  const res = await GET(new Request(`http://localhost/api/agent/turno/${fila}`), {
    params: Promise.resolve({ fila }),
  });
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
};

const enCurso = {
  id: "fila-1",
  userText: "hazme la tienda",
  assistantReasoning: "Empiezo por el catálogo…",
  status: "applied",
  enCurso: true,
};

describe("GET /api/agent/turno/[fila] — volver a mirar un turno que sigue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("un turno vivo vuelve con su texto y su `turnoId` (para dirigir o parar)", async () => {
    mocks.leerTurnoDelUsuario.mockResolvedValue(enCurso);
    mocks.turnoDeLaFila.mockReturnValue("t-123");
    const { status, cuerpo } = await pedir();
    expect(status).toBe(200);
    expect(cuerpo).toEqual({ turno: enCurso, turnoId: "t-123" });
    expect(mocks.leerTurnoDelUsuario).toHaveBeenCalledWith("fila-1", "u1");
    expect(mocks.turnoDeLaFila).toHaveBeenCalledWith("fila-1", "u1");
    expect(mocks.marcarCortadaSiSigueEnCurso).not.toHaveBeenCalled();
  });

  it("🔴 una fila en curso que nadie corre (reinicio a mitad) se cierra como cortada", async () => {
    mocks.leerTurnoDelUsuario.mockResolvedValue(enCurso);
    mocks.turnoDeLaFila.mockReturnValue(null);
    const { cuerpo } = await pedir();
    expect(mocks.marcarCortadaSiSigueEnCurso).toHaveBeenCalledWith("fila-1");
    const turno = cuerpo.turno as Record<string, unknown>;
    expect(turno.cortado).toBe(true);
    expect(turno.enCurso).toBeUndefined();
    expect(cuerpo.turnoId).toBeUndefined();
  });

  it("un turno ya cerrado vuelve tal cual, sin mirar el almacén", async () => {
    const { enCurso: _x, ...cerrado } = enCurso;
    mocks.leerTurnoDelUsuario.mockResolvedValue(cerrado);
    const { cuerpo } = await pedir();
    expect(cuerpo).toEqual({ turno: cerrado });
    expect(mocks.turnoDeLaFila).not.toHaveBeenCalled();
  });

  it("🔴 la fila de otro, o una que no existe, es un 404 sin distinguir", async () => {
    mocks.leerTurnoDelUsuario.mockResolvedValue(null);
    expect((await pedir()).status).toBe(404);
  });

  it("sin sesión, 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await pedir()).status).toBe(401);
    expect(mocks.leerTurnoDelUsuario).not.toHaveBeenCalled();
  });
});
