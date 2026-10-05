// LA CHARLA AL RECARGAR (pieza 7): el modo plan vuelve con ella, sin leer la
// transcripción de cada fila. `transcript->>'planMode'` obliga a Postgres a
// descomprimir la transcripción ENTERA (hasta `TOPE_TRANSCRIPCION`, 400 KB):
// en las 50 filas del panel eran megas en cada carga de proyecto. Así que el
// panel sigue sin ella y el modo plan sale de UNA fila, la que pliega el
// servidor (`planModeFromRows`: la última cerrada con transcripción).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Consulta = { columnas: Record<string, unknown>; limite: number | null };
const consultas: Consulta[] = [];
const respuestas: { panel: unknown[]; plan: unknown[] | Error } = { panel: [], plan: [] };

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const select = (columnas: Record<string, unknown>) => {
    const consulta: Consulta = { columnas, limite: null };
    consultas.push(consulta);
    const esDelPlan = "planMode" in columnas && Object.keys(columnas).length === 1;
    const cadena = {
      from: () => cadena,
      where: () => cadena,
      orderBy: () => cadena,
      limit: async (n: number) => {
        consulta.limite = n;
        if (!esDelPlan) return respuestas.panel;
        if (respuestas.plan instanceof Error) throw respuestas.plan;
        return respuestas.plan;
      },
    };
    return cadena;
  };
  return { db: { select }, schema };
});

import { CHAT_LIMIT, getChatMessages } from "./chat";

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

beforeEach(() => {
  consultas.length = 0;
  respuestas.panel = [fila("t1", "applied"), fila("t2", "en_curso")];
  respuestas.plan = [];
});

describe("getChatMessages y el modo plan", () => {
  it("la consulta del panel no lee la transcripción", async () => {
    await getChatMessages("p1");
    const panel = consultas.find((c) => c.limite === CHAT_LIMIT);
    expect(panel).toBeDefined();
    expect(Object.keys(panel!.columnas)).not.toContain("transcript");
    expect(Object.keys(panel!.columnas)).not.toContain("planMode");
  });

  it("el modo plan sale de UNA fila y lo lleva el último turno cerrado", async () => {
    respuestas.plan = [{ planMode: "true" }];
    const turnos = await getChatMessages("p1");
    expect(consultas.find((c) => "planMode" in c.columnas)?.limite).toBe(1);
    expect(turnos.map((t) => t.planMode)).toEqual([true, undefined]);
  });

  it("sin la foto (o con otra cosa), ningún turno lo trae", async () => {
    for (const plan of [[], [{ planMode: null }], [{ planMode: "false" }]]) {
      respuestas.plan = plan;
      const turnos = await getChatMessages("p1");
      expect(turnos.some((t) => "planMode" in t)).toBe(false);
    }
  });

  it("si la consulta del modo plan falla, la charla se carga igual", async () => {
    respuestas.plan = new Error("columna rara");
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    const turnos = await getChatMessages("p1");
    expect(turnos.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(turnos.some((t) => "planMode" in t)).toBe(false);
    avisos.mockRestore();
  });
});
