import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  turnoDeLaFila: vi.fn(),
  filaEnMarcha: vi.fn((): boolean => false),
  preguntaPendiente: vi.fn((): unknown => null),
  siguienteDeLaFila: vi.fn((): string | null => null),
  leerTurnoDelUsuario: vi.fn(),
  marcarCortadaSiSigueEnCurso: vi.fn(async () => {}),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agent/direcciones", () => ({
  turnoDeLaFila: mocks.turnoDeLaFila,
  filaEnMarcha: mocks.filaEnMarcha,
  siguienteDeLaFila: mocks.siguienteDeLaFila,
  preguntaPendiente: mocks.preguntaPendiente,
}));
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

  // Como DeepSeek: quien se reengancha con una pregunta en el aire la recibe
  // otra vez, y la puede contestar (ensayo de caja de crear-es-len, 06/10).
  it("🔴 un turno vivo que espera la respuesta a una pregunta la devuelve", async () => {
    const preguntas = [{ id: "plazo", question: "¿En cuánto tiempo?" }];
    mocks.leerTurnoDelUsuario.mockResolvedValue(enCurso);
    mocks.turnoDeLaFila.mockReturnValue("t-123");
    mocks.preguntaPendiente.mockReturnValue(preguntas);
    const { cuerpo } = await pedir();
    expect(cuerpo).toEqual({ turno: enCurso, turnoId: "t-123", preguntas });
    expect(mocks.preguntaPendiente).toHaveBeenCalledWith("t-123", "u1");
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

  // Visto en el ensayo de caja (08/10): Eli miraba el proyecto mientras corría el
  // turno de Dana; su panel lo siguió por aquí, «nadie» lo corría para Eli, y el
  // turno de Dana se guardó como cortado.
  it("🔴 un miembro que mira el turno de OTRO lo sigue en curso, sin `turnoId` y sin cortarlo", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u-eli" } });
    mocks.leerTurnoDelUsuario.mockResolvedValue(enCurso);
    mocks.turnoDeLaFila.mockReturnValue(null);
    mocks.filaEnMarcha.mockReturnValue(true);
    const { cuerpo } = await pedir();
    expect(cuerpo).toEqual({ turno: enCurso });
    expect(mocks.marcarCortadaSiSigueEnCurso).not.toHaveBeenCalled();
    expect(mocks.filaEnMarcha).toHaveBeenCalledWith("fila-1");
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

  // PIEZA 8: la ronda siguiente de un encargo arranca antes de abrir su fila
  // (la abre pasada la puerta de créditos), y el chat la empieza a sondear en
  // cuanto el `done` la anuncia. Ese hueco no es «Error de red».
  it("🔴 pieza 8: una fila que aún no existe pero cuyo turno está vivo es un turno en marcha, vacío", async () => {
    mocks.leerTurnoDelUsuario.mockResolvedValue(null);
    mocks.turnoDeLaFila.mockReturnValue("t-9");
    const { status, cuerpo } = await pedir("fila-2");
    expect(status).toBe(200);
    expect(cuerpo.turnoId).toBe("t-9");
    expect(cuerpo.turno).toMatchObject({ id: "fila-2", userText: "", assistantReasoning: "", status: "applied", enCurso: true });
    expect(mocks.turnoDeLaFila).toHaveBeenCalledWith("fila-2", "u1");
  });

  it("pieza 8: una fila cerrada que dio paso a otra ronda la dice", async () => {
    const { enCurso: _x, ...cerrado } = enCurso;
    mocks.leerTurnoDelUsuario.mockResolvedValue(cerrado);
    mocks.siguienteDeLaFila.mockReturnValue("fila-2");
    const { cuerpo } = await pedir();
    expect(cuerpo).toEqual({ turno: cerrado, siguiente: "fila-2" });
  });

  it("sin sesión, 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await pedir()).status).toBe(401);
    expect(mocks.leerTurnoDelUsuario).not.toHaveBeenCalled();
  });
});
