// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
const propios: { duenoId: string; rol: "editor" | "lector" | null }[] = [];
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, leftJoin: () => cadena, where: () => cadena, limit: async () => propios };
  return {
    db: { select: () => cadena },
    schema: { projects: { id: "id", userId: "userId" }, projectMembers: { projectId: "projectId", userId: "userId", rol: "rol" } },
  };
});
vi.mock("@/lib/backend/files", () => ({ readProjectFileBytes: vi.fn() }));

import { auth } from "@/auth";
import { readProjectFileBytes } from "@/lib/backend/files";

import { GET } from "./route";

const comoUsuario = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
const pedir = (ruta: string | null, id = "p1") =>
  GET(new Request(`http://x/api/projects/${id}/ficheros/raw${ruta === null ? "" : `?ruta=${encodeURIComponent(ruta)}`}`), { params: Promise.resolve({ id }) });

describe("GET /api/projects/[id]/ficheros/raw", () => {
  beforeEach(() => {
    propios.splice(0, propios.length, { duenoId: "u1", rol: null });
    vi.mocked(auth).mockReset();
    vi.mocked(readProjectFileBytes).mockReset();
  });

  it("the file's bytes, with its type and a short private cache", async () => {
    comoUsuario("u1");
    vi.mocked(readProjectFileBytes).mockResolvedValue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    const r = await pedir("/img/a.png");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, max-age=60");
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(readProjectFileBytes).toHaveBeenCalledWith("p1", "/img/a.png");
  });

  it("a viewer can read it; someone else's project and a missing file are 404; no session is 401", async () => {
    comoUsuario("u2");
    propios.splice(0, propios.length, { duenoId: "u1", rol: "lector" });
    vi.mocked(readProjectFileBytes).mockResolvedValue(Uint8Array.from([1]));
    expect((await pedir("/a.bin")).status).toBe(200);
    vi.mocked(readProjectFileBytes).mockResolvedValue(null);
    expect((await pedir("/no.bin")).status).toBe(404);
    propios.splice(0);
    expect((await pedir("/a.bin")).status).toBe(404);
    comoUsuario(null);
    expect((await pedir("/a.bin")).status).toBe(401);
  });

  it("400 without a path", async () => {
    comoUsuario("u1");
    expect((await pedir(null)).status).toBe(400);
  });
});
