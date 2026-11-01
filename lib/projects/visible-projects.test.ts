// The projects a person can see, with their role (spec local 2026-10-31-len-movil, §5.6): their own and
// the ones shared with them, as the phone's project list shows them.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/projects", () => ({
  listProjects: vi.fn(async () => [
    { id: "own", title: "Mi tienda", isBlank: false },
    { id: "blank", title: "", isBlank: true },
  ]),
  listProjectsByIds: vi.fn(async (ids: string[]) =>
    [
      { id: "shared", title: "Del equipo", isBlank: false },
      { id: "seen", title: "Sólo mirar", isBlank: false },
    ].filter((p) => ids.includes(p.id)),
  ),
}));
vi.mock("@/lib/projects/miembros", () => ({
  proyectosCompartidos: vi.fn(async () => [
    { projectId: "shared", rol: "editor", duenoEmail: "a@x", duenoName: null },
    { projectId: "seen", rol: "lector", duenoEmail: "b@x", duenoName: null },
  ]),
}));

import { visibleProjects } from "./visible-projects";

describe("visibleProjects", () => {
  it("lists their own projects as owner and the shared ones with their role, without the blank one", async () => {
    expect(await visibleProjects("u1")).toEqual([
      { id: "own", title: "Mi tienda", role: "dueno" },
      { id: "shared", title: "Del equipo", role: "editor" },
      { id: "seen", title: "Sólo mirar", role: "lector" },
    ]);
  });
});
