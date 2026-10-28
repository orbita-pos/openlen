// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Thin on purpose, like the PUT next door: who you are, whose project, the form and what each answer is.
// What a saved upload becomes (text or pointer, by the editor's path) is lib/files/upload.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const propios: { duenoId: string; rol: "editor" | "lector" | null }[] = [];
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, leftJoin: () => cadena, where: () => cadena, limit: async () => propios };
  return {
    db: { select: () => cadena },
    schema: { projects: { id: "id", userId: "userId" }, projectMembers: { projectId: "projectId", userId: "userId", rol: "rol" } },
  };
});
vi.mock("@/lib/files/upload", () => ({ uploadProjectFile: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ consumeToken: () => ({ allowed: true }), RATE_LIMITS: { upload: {} }, rateLimitedResponse: () => new Response(null, { status: 429 }) }));

import { auth } from "@/auth";
import { uploadProjectFile } from "@/lib/files/upload";

import { POST } from "./route";

const comoUsuario = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);

function subir(dir: string, files: Record<string, Uint8Array | string>, id = "p1") {
  const form = new FormData();
  form.set("dir", dir);
  for (const [name, body] of Object.entries(files)) form.append("file", new File([body as BlobPart], name));
  return POST(new Request(`http://x/api/projects/${id}/ficheros/upload`, { method: "POST", body: form }), { params: Promise.resolve({ id }) });
}

describe("POST /api/projects/[id]/ficheros/upload", () => {
  beforeEach(() => {
    propios.splice(0, propios.length, { duenoId: "u1", rol: null });
    vi.mocked(auth).mockReset();
    vi.mocked(uploadProjectFile).mockReset();
  });

  it("401 without a session, 404 on someone else's project, 403 for a viewer: nothing is uploaded", async () => {
    comoUsuario(null);
    expect((await subir("/img", { "a.png": "x" })).status).toBe(401);
    comoUsuario("u1");
    propios.splice(0);
    expect((await subir("/img", { "a.png": "x" })).status).toBe(404);
    propios.splice(0, propios.length, { duenoId: "u9", rol: "lector" });
    expect((await subir("/img", { "a.png": "x" })).status).toBe(403);
    expect(uploadProjectFile).not.toHaveBeenCalled();
  });

  it("each file goes to dir + its name (a folder's relative path kept), saved with the owner's id", async () => {
    comoUsuario("u2");
    propios.splice(0, propios.length, { duenoId: "u1", rol: "editor" });
    vi.mocked(uploadProjectFile).mockImplementation(async (p) => (p.ruta === "/img/big.mp4" ? { ok: false, motivo: "File too large" } : { ok: true, ruta: p.ruta }));
    const r = await subir("/img", { "logo.png": Uint8Array.from([0x89, 0x50, 0x00]), "iconos/x.svg": "<svg/>", "big.mp4": "v" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ guardados: ["/img/logo.png", "/img/iconos/x.svg"], rechazados: [{ ruta: "/img/big.mp4", motivo: "File too large" }] });
    const llamada = vi.mocked(uploadProjectFile).mock.calls[0]![0];
    expect(llamada).toMatchObject({ projectId: "p1", ownerId: "u1", personId: "u2", ruta: "/img/logo.png" });
    expect(Array.from(llamada.bytes)).toEqual([0x89, 0x50, 0x00]);
  });

  it("the root is dir \"\" or \"/\"; a name with .. is refused without uploading it", async () => {
    comoUsuario("u1");
    vi.mocked(uploadProjectFile).mockImplementation(async (p) => ({ ok: true, ruta: p.ruta }));
    const r = await subir("/", { "a.txt": "x", "../b.txt": "y" });
    expect(await r.json()).toEqual({ guardados: ["/a.txt"], rechazados: [{ ruta: "../b.txt", motivo: "not a valid file name" }] });
    expect(uploadProjectFile).toHaveBeenCalledTimes(1);
  });

  it("400 without files", async () => {
    comoUsuario("u1");
    expect((await subir("/img", {})).status).toBe(400);
  });
});
