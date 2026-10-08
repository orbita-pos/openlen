// LA CHARLA AL RECARGAR (piezas 7 y 8): el modo plan y el encargo vuelven con
// ella, sin leer la transcripción de cada fila. `transcript->>'planMode'` obliga
// a Postgres a descomprimir la transcripción ENTERA (hasta `TOPE_TRANSCRIPCION`,
// 400 KB): en las 50 filas del panel eran megas en cada carga de proyecto. Así
// que el panel sigue sin ella y el estado de la charla sale de UNA fila, la que
// pliega el servidor (la última cerrada con transcripción).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Consulta = { columnas: Record<string, unknown>; limite: number | null; join: boolean };
const consultas: Consulta[] = [];
const respuestas: { panel: unknown[]; estado: unknown[] | Error; fila: unknown[]; gente: unknown[] } = { panel: [], estado: [], fila: [], gente: [] };

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const select = (columnas: Record<string, unknown>) => {
    const consulta: Consulta = { columnas, limite: null, join: false };
    consultas.push(consulta);
    const cadena = {
      from: () => cadena,
      innerJoin: () => {
        consulta.join = true;
        return cadena;
      },
      where: () => cadena,
      orderBy: () => cadena,
      limit: async (n: number) => {
        consulta.limite = n;
        // El estado de la charla: `{ planMode, goal }` de UNA fila.
        if ("planMode" in columnas && "goal" in columnas && !("userText" in columnas)) {
          if (respuestas.estado instanceof Error) throw respuestas.estado;
          return respuestas.estado;
        }
        // La fila del sondeo va con el proyecto (el dueño); el panel, sin él.
        return consulta.join ? respuestas.fila : respuestas.panel;
      },
      // Quién pidió cada turno (`conAutores`): el proyecto con su gente, sin `limit`.
      then: (ok: (v: unknown[]) => unknown) => ok(respuestas.gente),
    };
    return cadena;
  };
  return { db: { select }, schema };
});

import { _resetGoalActivation, armGoal } from "@/lib/agent/goal-activation";
import type { GoalSnapshot } from "@/lib/agent/goal";
import { CHAT_LIMIT, getChatMessages, leerTurnoDelUsuario } from "./chat";

const fila = (id: string, status: string) => ({
  id,
  projectId: "p1",
  userText: "añade reseñas",
  assistantReasoning: "Te propongo un plan.",
  status,
  createdAt: new Date("2026-10-05T12:00:00Z"),
  attachedImage: null,
  page: null,
  actions: null,
  noDocChange: false,
  centicredits: null,
  durationMs: null,
  conversation: null,
});
const encargo: GoalSnapshot = { id: "goal-1", revision: 2, objective: "la tienda", phase: "active", maxGoalRounds: 256, roundsStarted: 3 };

beforeEach(() => {
  consultas.length = 0;
  _resetGoalActivation();
  respuestas.panel = [fila("t1", "applied"), fila("t2", "en_curso")];
  respuestas.estado = [];
  respuestas.fila = [];
  respuestas.gente = [];
});

describe("getChatMessages y el estado de la charla", () => {
  it("la consulta del panel no lee la transcripción", async () => {
    await getChatMessages("p1");
    const panel = consultas.find((c) => c.limite === CHAT_LIMIT);
    expect(panel).toBeDefined();
    expect(Object.keys(panel!.columnas)).not.toContain("transcript");
    expect(Object.keys(panel!.columnas)).not.toContain("planMode");
    expect(Object.keys(panel!.columnas)).not.toContain("goal");
  });

  it("el modo plan sale de UNA fila y lo lleva el último turno cerrado", async () => {
    respuestas.estado = [{ planMode: "true", goal: null }];
    const turnos = await getChatMessages("p1");
    expect(consultas.find((c) => "planMode" in c.columnas)?.limite).toBe(1);
    expect(turnos.map((t) => t.planMode)).toEqual([true, undefined]);
  });

  it("pieza 8: el encargo también, en la MISMA consulta, con la activación del proceso", async () => {
    respuestas.estado = [{ planMode: null, goal: encargo }];
    armGoal("p1", "goal-1");
    const turnos = await getChatMessages("p1");
    expect(consultas.filter((c) => c.limite === 1)).toHaveLength(1);
    expect(turnos[0]!.goal).toEqual({ ...encargo, activation: "armed" });
    expect(turnos[1]).not.toHaveProperty("goal");
  });

  it("cada turno dice quién lo pidió: el dueño si la fila no dice otro", async () => {
    respuestas.panel = [fila("t1", "applied"), { ...fila("t2", "applied"), autorId: "ana" }];
    respuestas.gente = [
      { id: "dueno", name: "Jesús", email: "j@x", duenoId: "dueno" },
      { id: "ana", name: null, email: "ana@x", duenoId: "dueno" },
    ];
    const turnos = await getChatMessages("p1");
    expect(turnos.map((t) => t.autor)).toEqual(["Jesús", "ana@x"]);
  });

  it("sin el encargo armado en este proceso (tras un reinicio), desarmado", async () => {
    respuestas.estado = [{ planMode: null, goal: encargo }];
    const turnos = await getChatMessages("p1");
    expect(turnos[0]!.goal?.activation).toBe("disarmed");
  });

  it("sin la foto (o con otra cosa), ningún turno trae ni modo plan ni encargo", async () => {
    for (const estado of [[], [{ planMode: null, goal: null }], [{ planMode: "false", goal: "roto" }]]) {
      respuestas.estado = estado;
      const turnos = await getChatMessages("p1");
      expect(turnos.some((t) => "planMode" in t || "goal" in t)).toBe(false);
    }
  });

  it("si la consulta del estado falla, la charla se carga igual", async () => {
    respuestas.estado = new Error("columna rara");
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    const turnos = await getChatMessages("p1");
    expect(turnos.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(turnos.some((t) => "planMode" in t || "goal" in t)).toBe(false);
    avisos.mockRestore();
  });
});

describe("leerTurnoDelUsuario (el sondeo del chat)", () => {
  it("pieza 8: la fila trae SU encargo, con la activación", async () => {
    respuestas.fila = [{ ...fila("t1", "applied"), goal: encargo }];
    const turno = await leerTurnoDelUsuario("t1", "u1");
    expect(turno?.goal).toEqual({ ...encargo, activation: "disarmed" });
  });

  it("sin encargo en la fila, nada", async () => {
    respuestas.fila = [{ ...fila("t1", "applied"), goal: null }];
    expect(await leerTurnoDelUsuario("t1", "u1")).not.toHaveProperty("goal");
  });
});
