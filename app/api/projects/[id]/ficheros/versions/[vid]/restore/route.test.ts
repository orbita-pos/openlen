// DESHACER UN FICHERO DE LA CARPETA (pieza 9 de Len 2.5): la misma forma que
// `versions/[vid]/restore` de las páginas — sin cuerpo, la versión la lee el
// servidor y la propiedad la comprueba `restoreFileVersion` (une con el dueño).
import { beforeEach, describe, expect, it, vi } from "vitest";

// Compartir el proyecto: aquí quien pide es el dueño (ver acceso-de-prueba.ts).
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/file-versions", () => ({ restoreFileVersion: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/auth";
import { restoreFileVersion } from "@/lib/projects/file-versions";

const pedir = (id = "p1", vid = "f1") =>
  POST(new Request(`http://x/api/projects/${id}/ficheros/versions/${vid}/restore`, { method: "POST" }), {
    params: Promise.resolve({ id, vid }),
  });
const comoUsuario = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);

describe("POST /api/projects/[id]/ficheros/versions/[vid]/restore", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(restoreFileVersion).mockReset();
  });

  it("🔴 401 sin sesión: no se restaura nada", async () => {
    comoUsuario(null);
    expect((await pedir()).status).toBe(401);
    expect(restoreFileVersion).not.toHaveBeenCalled();
  });

  it("🔴 404 si la versión no es de ese proyecto y ese dueño", async () => {
    comoUsuario("u1");
    vi.mocked(restoreFileVersion).mockResolvedValue(null);
    expect((await pedir()).status).toBe(404);
    expect(restoreFileVersion).toHaveBeenCalledWith({ projectId: "p1", userId: "u1", versionId: "f1" });
  });

  it("200 con lo restaurado y la versión de lo que había (el propio deshacer se deshace)", async () => {
    comoUsuario("u1");
    vi.mocked(restoreFileVersion).mockResolvedValue({ path: "/js/app.js", content: "antes", versionPrevia: "f2" });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/js/app.js", content: "antes", versionPrevia: "f2" });
  });
});
