import { describe, it, expect, vi, beforeEach } from "vitest";

// `@/lib/projects` arrastra el binding nativo de html-engine por su cadena de
// imports, y vitest no puede cargar un `.node`. Se mockea el módulo entero: lo
// que esta ruta hace suyo es la autorización y la forma de la respuesta, no lo
// que `getProject` sepa leer.
vi.mock("@/lib/projects", () => ({
  getProject: vi.fn(),
}));
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { GET } from "./route";
import { getProject } from "@/lib/projects";
import { auth } from "@/auth";

const pedir = (id = "p1") =>
  GET(new Request(`http://x/api/projects/${id}/brief`), {
    params: Promise.resolve({ id }),
  });

const comoUsuario = (userId: string | null) =>
  vi.mocked(auth).mockResolvedValue(
    (userId ? { user: { id: userId } } : null) as never,
  );

describe("GET /api/projects/[id]/brief", () => {
  beforeEach(() => {
    vi.mocked(getProject).mockReset();
    vi.mocked(auth).mockReset();
  });

  it("401 sin sesión — el brief es contexto privado del proyecto", async () => {
    comoUsuario(null);
    expect((await pedir()).status).toBe(401);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("404 en un proyecto ajeno: la propiedad la comprueba getProject, no esta ruta", async () => {
    comoUsuario("u1");
    vi.mocked(getProject).mockResolvedValue(null as never);
    expect((await pedir()).status).toBe(404);
    // Y se le pregunta POR EL USUARIO de la sesión, nunca por uno del cuerpo.
    expect(getProject).toHaveBeenCalledWith("p1", "u1");
  });

  it("devuelve el brief del proyecto", async () => {
    comoUsuario("u1");
    vi.mocked(getProject).mockResolvedValue({ userBrief: "el tono es formal" } as never);
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brief: "el tono es formal" });
  });

  it("un brief vacío sale como cadena, no como null — el textarea no puede recibir null", async () => {
    comoUsuario("u1");
    vi.mocked(getProject).mockResolvedValue({ userBrief: null } as never);
    expect(await (await pedir()).json()).toEqual({ brief: "" });
  });
});
