// QUITAR EL ENCARGO (pieza 8): el control del dueño, como `/goal clear` de
// DeepSeek. Sólo el dueño del proyecto, nunca con una ronda viva (la pisaría al
// cerrar, con su foto), y desarma en el proceso.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  turnoVivoDelProyecto: vi.fn((): boolean => false),
  quitarEncargo: vi.fn(async (): Promise<"ok" | "no_encontrado"> => "ok"),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agent/direcciones", () => ({ turnoVivoDelProyecto: mocks.turnoVivoDelProyecto }));
vi.mock("@/lib/projects/chat", () => ({ quitarEncargo: mocks.quitarEncargo }));

import { _resetGoalActivation, armGoal, goalActivation } from "@/lib/agent/goal-activation";
import { POST } from "./route";

const pedir = async (cuerpo: unknown) => {
  const res = await POST(new Request("http://localhost/api/agent/encargo", { method: "POST", body: JSON.stringify(cuerpo) }));
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetGoalActivation();
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.turnoVivoDelProyecto.mockReturnValue(false);
  mocks.quitarEncargo.mockResolvedValue("ok");
});

describe("POST /api/agent/encargo", () => {
  it("quita el encargo de la charla y lo desarma", async () => {
    armGoal("p1", "goal-1");
    const { status, cuerpo } = await pedir({ projectId: "p1", action: "clear" });
    expect(status).toBe(200);
    expect(cuerpo).toEqual({ ok: true });
    expect(mocks.quitarEncargo).toHaveBeenCalledWith("p1", "u1");
    expect(goalActivation("p1", "goal-1")).toBe("disarmed");
  });

  it("🔴 con una ronda viva en el proyecto, 409 y no toca nada", async () => {
    armGoal("p1", "goal-1");
    mocks.turnoVivoDelProyecto.mockReturnValue(true);
    const { status, cuerpo } = await pedir({ projectId: "p1", action: "clear" });
    expect(status).toBe(409);
    expect(cuerpo).toEqual({ error: "turno_en_curso" });
    expect(mocks.quitarEncargo).not.toHaveBeenCalled();
    expect(goalActivation("p1", "goal-1")).toBe("armed");
  });

  it("el proyecto de otro (o uno que no existe): 404, y no desarma el suyo", async () => {
    armGoal("p1", "goal-1");
    mocks.quitarEncargo.mockResolvedValue("no_encontrado");
    expect((await pedir({ projectId: "p1", action: "clear" })).status).toBe(404);
    expect(goalActivation("p1", "goal-1")).toBe("armed");
  });

  it("otra acción, o sin proyecto: 400", async () => {
    expect((await pedir({ projectId: "p1", action: "pause" })).status).toBe(400);
    expect((await pedir({ action: "clear" })).status).toBe(400);
    expect(mocks.quitarEncargo).not.toHaveBeenCalled();
  });

  it("sin sesión, 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await pedir({ projectId: "p1", action: "clear" })).status).toBe(401);
  });
});
