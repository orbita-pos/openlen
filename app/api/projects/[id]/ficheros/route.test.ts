import { beforeEach, describe, expect, it, vi } from "vitest";

// El PUT es fino a propósito: quién eres, de quién es el proyecto, la forma del
// cuerpo y qué código devuelve cada salida. El guardado de verdad (el camino de
// la terminal, sus guardas, «cambió desde que lo abriste») lo prueban las de
// node:test en lib/agent/herramientas-de-ficheros.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const propios: { id: string }[] = [];
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, where: () => cadena, limit: async () => propios };
  return { db: { select: () => cadena }, schema: { projects: { id: "id", userId: "userId" } } };
});
vi.mock("@/lib/agent/terminal/editar-a-mano", () => ({ guardarAMano: vi.fn() }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/terminal/solo-lectura", () => ({ soloLecturaDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import { PUT } from "./route";
import { auth } from "@/auth";
import { guardarAMano } from "@/lib/agent/terminal/editar-a-mano";

const pedir = (cuerpo: unknown, id = "p1") =>
  PUT(new Request(`http://x/api/projects/${id}/ficheros`, { method: "PUT", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }), {
    params: Promise.resolve({ id }),
  });
const comoUsuario = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
const BIEN = { ruta: "/index.html", contenido: "<h1>b</h1>", base: "<h1>a</h1>" };

describe("PUT /api/projects/[id]/ficheros — editar a mano (la #18)", () => {
  beforeEach(() => {
    propios.splice(0, propios.length, { id: "p1" });
    vi.mocked(auth).mockReset();
    vi.mocked(guardarAMano).mockReset();
  });

  it("401 sin sesión y 404 en un proyecto ajeno: nada se guarda", async () => {
    comoUsuario(null);
    expect((await pedir(BIEN)).status).toBe(401);
    comoUsuario("u1");
    propios.splice(0);
    expect((await pedir(BIEN)).status).toBe(404);
    expect(guardarAMano).not.toHaveBeenCalled();
  });

  it("400 sin los tres campos y 413 con un fichero enorme", async () => {
    comoUsuario("u1");
    expect((await pedir({ ruta: "/index.html", contenido: "x" })).status).toBe(400);
    expect((await pedir({ ...BIEN, ruta: "index.html" })).status).toBe(400);
    expect((await pedir("no es json")).status).toBe(400);
    expect((await pedir({ ...BIEN, contenido: "x".repeat(2_000_001) })).status).toBe(413);
    expect(guardarAMano).not.toHaveBeenCalled();
  });

  it("guarda como el usuario de la SESIÓN, y cada salida con su código", async () => {
    comoUsuario("u1");
    vi.mocked(guardarAMano).mockResolvedValueOnce({ ok: true, contenido: "<h1>b</h1>" });
    const bien = await pedir({ ...BIEN, userId: "otro" });
    expect(bien.status).toBe(200);
    expect(await bien.json()).toEqual({ contenido: "<h1>b</h1>" });
    expect(guardarAMano).toHaveBeenCalledWith("p1", "u1", "/index.html", "<h1>b</h1>", "<h1>a</h1>");

    vi.mocked(guardarAMano).mockResolvedValueOnce({ ok: false, motivo: "cambio", actual: "<h1>c</h1>" });
    const cambio = await pedir(BIEN);
    expect(cambio.status).toBe(409);
    expect(await cambio.json()).toEqual({ error: "cambio", actual: "<h1>c</h1>" });

    vi.mocked(guardarAMano).mockResolvedValueOnce({ ok: false, motivo: "rechazado", detalle: "index.html: not saved — …" });
    expect((await pedir(BIEN)).status).toBe(422);

    vi.mocked(guardarAMano).mockResolvedValueOnce({ ok: false, motivo: "no_existe" });
    expect((await pedir(BIEN)).status).toBe(404);
  });
});
