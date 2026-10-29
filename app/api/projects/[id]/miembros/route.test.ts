// @vitest-environment node
// Removing a member takes their scheduled tasks with them (spec local 2026-10-29-tareas-programadas,
// §7.4): they can no longer talk to Len there, nor should its email reach them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { id: "owner" } })),
  acceso: vi.fn(async () => ({ rol: "dueno", duenoId: "owner" })),
  quitarMiembro: vi.fn(async () => true),
  deleteTasksByCreator: vi.fn(async () => 2),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/email", () => ({ sendProjectInviteEmail: vi.fn() }));
vi.mock("@/lib/len-email/address", () => ({ lenEmailAddress: () => null }));
vi.mock("@/lib/profile/avatar", () => ({ avatarOf: () => null }));
vi.mock("@/lib/projects/acceso", () => ({ accesoAlProyecto: mocks.acceso, puede: () => true, ROLES_DE_MIEMBRO: ["editor", "lector"] }));
vi.mock("@/lib/projects/miembros", () => ({
  cambiarRol: vi.fn(),
  cancelarInvitacion: vi.fn(),
  gastoDeMiembrosDelMes: vi.fn(),
  invitar: vi.fn(),
  listarMiembros: vi.fn(),
  ponerTope: vi.fn(),
  quitarMiembro: mocks.quitarMiembro,
  topeDelProyecto: vi.fn(),
}));
vi.mock("@/lib/scheduled-tasks/store", () => ({ deleteTasksByCreator: mocks.deleteTasksByCreator }));

import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/projects/[id]/miembros?userId=", () => {
  it("removes the member and their scheduled tasks in that project", async () => {
    const res = await DELETE(new Request("http://x/api/projects/p1/miembros?userId=eli"), ctx);
    expect(res.status).toBe(200);
    expect(mocks.quitarMiembro).toHaveBeenCalledWith("p1", "eli");
    expect(mocks.deleteTasksByCreator).toHaveBeenCalledWith("p1", "eli");
  });

  it("a member who was not there leaves the tasks alone", async () => {
    mocks.quitarMiembro.mockResolvedValueOnce(false);
    const res = await DELETE(new Request("http://x/api/projects/p1/miembros?userId=nadie"), ctx);
    expect(res.status).toBe(404);
    expect(mocks.deleteTasksByCreator).not.toHaveBeenCalled();
  });
});
