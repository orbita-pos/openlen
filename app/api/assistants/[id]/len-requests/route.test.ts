// @vitest-environment node
// HOW HER REQUESTS TO LEN ARE GOING, for her phone (spec local 2026-11-16-movil-es-tu-asistente, §5.8.5). Final review,
// I7: only her person reads them; C1: the cap keeps the NEWEST rows; I1: a row a restart left «en curso» is closed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  person: vi.fn(async (): Promise<string | null> => "u1"),
  assistantById: vi.fn(async (): Promise<Record<string, unknown> | null> => ({ id: "a1", personId: "u1" })),
  notes: vi.fn(async (_id: string, _filas: readonly string[]) => [] as unknown[]),
  leerTurno: vi.fn(async (_fila: string, _u: string): Promise<Record<string, unknown> | null> => null),
  cortar: vi.fn(async (_fila: string) => {}),
  vivo: vi.fn((_fila: string, _u: string): string | null => null),
  enMarcha: vi.fn((_fila: string) => false),
}));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.person }));
vi.mock("@/lib/movil/cors", () => ({ paraLaApp: <T,>(h: T) => h, respuestaPrevia: () => new Response(null, { status: 204 }) }));
vi.mock("@/lib/assistants/store", () => ({ assistantById: m.assistantById, assistantNoticesByFila: m.notes }));
vi.mock("@/lib/projects/chat", () => ({ leerTurnoDelUsuario: m.leerTurno, marcarCortadaSiSigueEnCurso: m.cortar }));
vi.mock("@/lib/agent/direcciones", () => ({ turnoDeLaFila: m.vivo, filaEnMarcha: m.enMarcha }));

const { GET } = await import("./route");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ask = (filas: string, id = "a1") => GET(new Request(`http://x/api/assistants/${id}/len-requests?filas=${filas}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.person.mockResolvedValue("u1");
  m.assistantById.mockResolvedValue({ id: "a1", personId: "u1" });
  delete process.env.OPENLEN_ASSISTANT;
});

describe("GET /api/assistants/[id]/len-requests", () => {
  it("🔴 without a session or the phone's key: 401", async () => {
    m.person.mockResolvedValueOnce(null);
    expect((await ask(uuid(1))).status).toBe(401);
  });

  it("🔴 another person's assistant: 404, and nothing is read", async () => {
    m.assistantById.mockResolvedValueOnce({ id: "a1", personId: "u2" });
    expect((await ask(uuid(1))).status).toBe(404);
    expect(m.leerTurno).not.toHaveBeenCalled();
    expect(m.notes).not.toHaveBeenCalled();
  });

  it("assistants off: 404", async () => {
    process.env.OPENLEN_ASSISTANT = "0";
    expect((await ask(uuid(1))).status).toBe(404);
  });

  it("only uuid-shaped rows are read", async () => {
    const res = await ask(`${uuid(1)},nope,../x`);
    const body = (await res.json()) as { requests: { filaId: string }[] };
    expect(body.requests.map((r) => r.filaId)).toEqual([uuid(1)]);
  });

  it("🔴 more than 20 rows: the NEWEST 20 are read (the phone sends them oldest first)", async () => {
    const filas = Array.from({ length: 25 }, (_, i) => uuid(i + 1));
    const body = (await (await ask(filas.join(","))).json()) as { requests: { filaId: string }[] };
    expect(body.requests.map((r) => r.filaId)).toEqual(filas.slice(-20));
  });

  it("🔴 a row a restart left in progress, run by no one, is closed as cut", async () => {
    m.leerTurno.mockResolvedValueOnce({ id: uuid(1), userText: "x", assistantReasoning: "", status: "applied", enCurso: true });
    const body = (await (await ask(uuid(1))).json()) as { requests: { status: string; reason?: string }[] };
    expect(m.cortar).toHaveBeenCalledWith(uuid(1));
    expect(body.requests[0]).toMatchObject({ status: "failed", reason: "interrupted" });
  });

  it("a row whose turn runs here is not touched", async () => {
    m.leerTurno.mockResolvedValueOnce({ id: uuid(1), userText: "x", assistantReasoning: "", status: "applied", enCurso: true });
    m.vivo.mockReturnValueOnce("t1");
    const body = (await (await ask(uuid(1))).json()) as { requests: { status: string; turnoId?: string }[] };
    expect(m.cortar).not.toHaveBeenCalled();
    expect(body.requests[0]).toMatchObject({ status: "running", turnoId: "t1" });
  });
});
