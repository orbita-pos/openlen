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
vi.mock("@/lib/agent/terminal/operar-a-mano", () => ({ operarAMano: vi.fn() }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/terminal/solo-lectura", () => ({ soloLecturaDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import { DELETE, PATCH, POST, PUT } from "./route";
import { operarAMano } from "@/lib/agent/terminal/operar-a-mano";
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

// CREAR, RENOMBRAR Y BORRAR (el explorador como el de VS Code). Igual de finas:
// la forma del cuerpo y el código de cada salida; lo de verdad, en node:test.
describe("POST, PATCH y DELETE — crear, renombrar y borrar desde el explorador", () => {
  const params = { params: Promise.resolve({ id: "p1" }) };
  const req = (metodo: string, cuerpo?: unknown, qs = "") =>
    new Request(`http://x/api/projects/p1/ficheros${qs}`, { method: metodo, ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}) });
  beforeEach(() => {
    propios.splice(0, propios.length, { id: "p1" });
    vi.mocked(auth).mockReset();
    vi.mocked(operarAMano).mockReset();
    comoUsuario("u1");
  });

  it("401 sin sesión y 404 ajeno, sin tocar nada", async () => {
    comoUsuario(null);
    expect((await POST(req("POST", { ruta: "/js/a.js" }), params)).status).toBe(401);
    comoUsuario("u1");
    propios.splice(0);
    expect((await DELETE(req("DELETE", undefined, "?ruta=/js"), params)).status).toBe(404);
    expect(operarAMano).not.toHaveBeenCalled();
  });

  it("crear: la operación con su ruta; 400 sin ruta absoluta", async () => {
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/js/a.js"] });
    const r = await POST(req("POST", { ruta: "/js/a.js" }), params);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ rutas: ["/js/a.js"] });
    expect(operarAMano).toHaveBeenCalledWith("p1", "u1", { tipo: "crear", ruta: "/js/a.js" });
    expect((await POST(req("POST", { ruta: "js/a.js" }), params)).status).toBe(400);
  });

  it("renombrar: { de, a }; «existe» y «pagina» son 409, «rechazado» 422", async () => {
    vi.mocked(operarAMano).mockResolvedValueOnce({ ok: false, motivo: "existe", rutas: ["/b.js"] });
    expect((await PATCH(req("PATCH", { de: "/a.js", a: "/b.js" }), params)).status).toBe(409);
    vi.mocked(operarAMano).mockResolvedValueOnce({ ok: false, motivo: "pagina", rutas: ["/menu/index.html"] });
    const p = await PATCH(req("PATCH", { de: "/menu", a: "/carta" }), params);
    expect(p.status).toBe(409);
    expect(await p.json()).toEqual({ error: "pagina", rutas: ["/menu/index.html"] });
    vi.mocked(operarAMano).mockResolvedValueOnce({ ok: false, motivo: "rechazado", detalle: "no" });
    expect((await PATCH(req("PATCH", { de: "/a.js", a: "/x/y.js" }), params)).status).toBe(422);
    expect(operarAMano).toHaveBeenLastCalledWith("p1", "u1", { tipo: "renombrar", de: "/a.js", a: "/x/y.js" });
  });

  it("borrar: ?ruta=; la raíz no se borra", async () => {
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/js/a.js"] });
    expect((await DELETE(req("DELETE", undefined, "?ruta=/js"), params)).status).toBe(200);
    expect(operarAMano).toHaveBeenCalledWith("p1", "u1", { tipo: "borrar", ruta: "/js" });
    expect((await DELETE(req("DELETE", undefined, "?ruta=/"), params)).status).toBe(400);
  });
});
