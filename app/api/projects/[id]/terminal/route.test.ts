import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La ruta es fina a propósito: comprueba quién eres, de quién es el proyecto,
// si la terminal está encendida y la forma del cuerpo. La terminal de verdad
// (just-bash, la guarda del JavaScript, ponerse al día) la prueban las de
// node:test en lib/agent/herramientas-de-ficheros.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const propios: { id: string }[] = [];
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, where: () => cadena, limit: async () => propios };
  return { db: { select: () => cadena }, schema: { projects: { id: "id", userId: "userId" } } };
});
vi.mock("@/lib/agent/terminal/terminal-del-usuario", () => ({ ejecutarEnLaTerminalDelUsuario: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/auth";
import { ejecutarEnLaTerminalDelUsuario } from "@/lib/agent/terminal/terminal-del-usuario";

const pedir = (cuerpo: unknown, id = "p1") =>
  POST(new Request(`http://x/api/projects/${id}/terminal`, { method: "POST", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }), {
    params: Promise.resolve({ id }),
  });
const comoUsuario = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);

describe("POST /api/projects/[id]/terminal — la terminal del usuario (la #17)", () => {
  const antes = process.env.OPENLEN_TERMINAL;
  beforeEach(() => {
    process.env.OPENLEN_TERMINAL = "1";
    propios.splice(0, propios.length, { id: "p1" });
    vi.mocked(auth).mockReset();
    vi.mocked(ejecutarEnLaTerminalDelUsuario).mockReset();
  });
  afterEach(() => {
    if (antes === undefined) delete process.env.OPENLEN_TERMINAL;
    else process.env.OPENLEN_TERMINAL = antes;
  });

  it("401 sin sesión y 404 en un proyecto ajeno: nada corre", async () => {
    comoUsuario(null);
    expect((await pedir({ command: "ls /" })).status).toBe(401);
    comoUsuario("u1");
    propios.splice(0);
    expect((await pedir({ command: "ls /" })).status).toBe(404);
    expect(ejecutarEnLaTerminalDelUsuario).not.toHaveBeenCalled();
  });

  it("409 con la terminal apagada en el servidor", async () => {
    comoUsuario("u1");
    delete process.env.OPENLEN_TERMINAL;
    const res = await pedir({ command: "ls /" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apagada" });
    expect(ejecutarEnLaTerminalDelUsuario).not.toHaveBeenCalled();
  });

  it("400 sin comando y 413 con uno enorme", async () => {
    comoUsuario("u1");
    expect((await pedir({})).status).toBe(400);
    expect((await pedir({ command: "   " })).status).toBe(400);
    expect((await pedir("no es json")).status).toBe(400);
    expect((await pedir({ command: "x".repeat(16_001) })).status).toBe(413);
    expect(ejecutarEnLaTerminalDelUsuario).not.toHaveBeenCalled();
  });

  it("corre como el usuario de la SESIÓN y devuelve lo que imprimió", async () => {
    comoUsuario("u1");
    vi.mocked(ejecutarEnLaTerminalDelUsuario).mockResolvedValue({ command: "pwd", salida: "/\n", exitCode: 0, cambio: false });
    const res = await pedir({ command: "pwd", userId: "otro" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ command: "pwd", salida: "/\n", exitCode: 0, cambio: false });
    expect(ejecutarEnLaTerminalDelUsuario).toHaveBeenCalledWith("p1", "u1", "pwd");
  });
});
