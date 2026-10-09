import { beforeEach, describe, expect, it, vi } from "vitest";

// El PUT es fino a propósito: quién eres, de quién es el proyecto, la forma del
// cuerpo y qué código devuelve cada salida. El guardado de verdad (el camino de
// la terminal, sus guardas, «cambió desde que lo abriste») lo prueban las de
// node:test en lib/agent/herramientas-de-ficheros.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
// Lo que devuelve la consulta de `accesoAlProyecto`: el dueño del proyecto y,
// si quien pide es miembro, su rol (lib/projects/acceso.ts).
const propios: { duenoId: string; rol: "editor" | "lector" | null }[] = [];
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, leftJoin: () => cadena, where: () => cadena, limit: async () => propios };
  return {
    db: { select: () => cadena },
    schema: { projects: { id: "id", userId: "userId" }, projectMembers: { projectId: "projectId", userId: "userId", rol: "rol" } },
  };
});
vi.mock("@/lib/agent/terminal/editar-a-mano", () => ({ guardarAMano: vi.fn() }));
vi.mock("@/lib/agent/terminal/operar-a-mano", () => ({ operarAMano: vi.fn() }));
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/terminal/solo-lectura", () => ({ soloLecturaDeLaTerminal: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({}) }));

import { DELETE, GET, PATCH, POST, PUT } from "./route";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { soloLecturaDeLaTerminal } from "@/lib/agent/terminal/solo-lectura";
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
    propios.splice(0, propios.length, { duenoId: "u1", rol: null });
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
    expect(guardarAMano).toHaveBeenCalledWith("p1", "u1", "/index.html", "<h1>b</h1>", "<h1>a</h1>", undefined, "u1");

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
    propios.splice(0, propios.length, { duenoId: "u1", rol: null });
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
    expect(operarAMano).toHaveBeenCalledWith("p1", "u1", { tipo: "crear", ruta: "/js/a.js" }, undefined, "u1");
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
    expect(operarAMano).toHaveBeenLastCalledWith("p1", "u1", { tipo: "renombrar", de: "/a.js", a: "/x/y.js" }, undefined, "u1");
  });

  it("borrar: ?ruta=; la raíz no se borra", async () => {
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/js/a.js"] });
    expect((await DELETE(req("DELETE", undefined, "?ruta=/js"), params)).status).toBe(200);
    expect(operarAMano).toHaveBeenCalledWith("p1", "u1", { tipo: "borrar", ruta: "/js" }, undefined, "u1");
    expect((await DELETE(req("DELETE", undefined, "?ruta=/"), params)).status).toBe(400);
  });
});

describe("los miembros del proyecto (compartir el proyecto)", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(guardarAMano).mockReset();
    vi.mocked(operarAMano).mockReset();
  });

  it("🔴 un editor guarda, y se guarda con el id del DUEÑO; un lector, 403; un extraño, 404", async () => {
    vi.mocked(guardarAMano).mockResolvedValue({ ok: true, contenido: "<h1>b</h1>" });
    comoUsuario("ana");
    propios.splice(0, propios.length, { duenoId: "u1", rol: "editor" });
    expect((await pedir(BIEN)).status).toBe(200);
    // …y su memoria PERSONAL es la suya: va como persona (plans/len-md).
    expect(guardarAMano).toHaveBeenCalledWith("p1", "u1", BIEN.ruta, BIEN.contenido, BIEN.base, undefined, "ana");

    vi.mocked(guardarAMano).mockClear();
    propios.splice(0, propios.length, { duenoId: "u1", rol: "lector" });
    expect((await pedir(BIEN)).status).toBe(403);
    const borrar = await DELETE(new Request("http://x/api/projects/p1/ficheros?ruta=/a.js", { method: "DELETE" }), { params: Promise.resolve({ id: "p1" }) });
    expect(borrar.status).toBe(403);

    propios.splice(0, propios.length, { duenoId: "u1", rol: null });
    expect((await pedir(BIEN)).status).toBe(404);
    expect(guardarAMano).not.toHaveBeenCalled();
    expect(operarAMano).not.toHaveBeenCalled();
  });

  // plans/len-md: crear, renombrar y borrar desde el explorador también tocan
  // ~/.len/LEN.md, así que van con quien pide como persona, igual que el PUT.
  it("🔴 crear, renombrar y borrar de un editor van con el id del DUEÑO y él como persona", async () => {
    vi.mocked(operarAMano).mockResolvedValue({ ok: true, rutas: ["/home/user/.len/LEN.md"] });
    comoUsuario("ana");
    propios.splice(0, propios.length, { duenoId: "u1", rol: "editor" });
    const ctx = { params: Promise.resolve({ id: "p1" }) };
    const ruta = "/home/user/.len/LEN.md";
    await POST(new Request("http://x/api/projects/p1/ficheros", { method: "POST", body: JSON.stringify({ ruta }) }), ctx);
    await PATCH(new Request("http://x/api/projects/p1/ficheros", { method: "PATCH", body: JSON.stringify({ de: ruta, a: "/LEN.md" }) }), ctx);
    await DELETE(new Request(`http://x/api/projects/p1/ficheros?ruta=${ruta}`, { method: "DELETE" }), ctx);
    expect(vi.mocked(operarAMano).mock.calls.map((c) => [c[0], c[1], c[3], c[4]])).toEqual([
      ["p1", "u1", undefined, "ana"],
      ["p1", "u1", undefined, "ana"],
      ["p1", "u1", undefined, "ana"],
    ]);
  });
});

// 🔴 MIEMBROS (plans/len-md, Task 1): la lente arma su sesión con el DUEÑO —con
// él se leen y guardan los ficheros—, pero la memoria PERSONAL que enseña y
// guarda es la de quien mira (`personId`), nunca la del dueño.
describe("la lente Código y la memoria personal de un miembro", () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(guardarAMano).mockReset();
    vi.mocked(cargarFicherosDeLaTerminal).mockReset().mockResolvedValue({});
    vi.mocked(soloLecturaDeLaTerminal).mockReset().mockResolvedValue({ rutas: [], leer: async () => "" } as never);
  });

  it("un LECTOR abre la lente: la sesión lleva su id como persona", async () => {
    propios.splice(0, propios.length, { duenoId: "dueno", rol: "lector" });
    comoUsuario("lector");
    const r = await GET(new Request("http://x/api/projects/p1/ficheros"), { params: Promise.resolve({ id: "p1" }) });
    expect(r.status).toBe(200);
    const sesion = vi.mocked(cargarFicherosDeLaTerminal).mock.calls[0]![0];
    expect(sesion).toMatchObject({ userId: "dueno", personId: "lector" });
  });
});
