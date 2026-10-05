// @vitest-environment node
//
// EXPORTAR LLEVA LA CARPETA (pieza 9 de Len 2.5): «te llevas tu carpeta y
// funciona en Vercel y Supabase». Con el `projectId` de un proyecto TUYO entran
// sus ficheros —`js/`, `tests/`, `supabase/`— con su ruta; con uno ajeno, no.
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  propios: [] as Array<{ id: string }>,
  carpeta: {} as Record<string, string>,
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => {
  const cadena = { from: () => cadena, where: () => cadena, limit: async () => mocks.propios };
  return { db: { select: () => cadena }, schema: { projects: { id: "id", userId: "userId" } } };
});
vi.mock("@/lib/backend/files", () => ({ listProjectFiles: vi.fn(async () => mocks.carpeta) }));

import { POST } from "./route";

const HTML = "<!doctype html><html><head><title>Tacos</title></head><body><script src=\"/js/app.js\"></script></body></html>";
const pide = (cuerpo: unknown) =>
  POST(new Request("http://x/api/export/zip", { method: "POST", body: JSON.stringify(cuerpo) }));
const leer = async (res: Response) => JSZip.loadAsync(await res.arrayBuffer());

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.propios = [{ id: "p1" }];
  mocks.carpeta = {
    "/js/app.js": "document.title = 'x'",
    "/data/menu.json": "[]",
    "/tests/menu.spec.ts": "test('menu', () => {})",
    "/supabase/migrations/20261004120000_init.sql": "create table t ();",
  };
});

describe("POST /api/export/zip — la carpeta", () => {
  it("🔴 con un proyecto tuyo, cada fichero de la carpeta entra con su ruta", async () => {
    const zip = await leer(await pide({ html: HTML, projectId: "p1" }));
    expect(await zip.file("index.html")?.async("string")).toBe(HTML);
    expect(await zip.file("js/app.js")?.async("string")).toBe("document.title = 'x'");
    expect(await zip.file("data/menu.json")?.async("string")).toBe("[]");
    expect(await zip.file("tests/menu.spec.ts")?.async("string")).toContain("test('menu'");
    expect(await zip.file("supabase/migrations/20261004120000_init.sql")?.async("string")).toContain("create table");
    expect(await zip.file("README.md")?.async("string")).toMatch(/supabase\/.*tests\//s);
  });

  it("🔴 con el projectId de OTRO, la carpeta no entra (sólo lo que mandó el cuerpo)", async () => {
    mocks.propios = [];
    const zip = await leer(await pide({ html: HTML, projectId: "ajeno" }));
    expect(zip.file("index.html")).not.toBeNull();
    expect(zip.file("js/app.js")).toBeNull();
    expect(zip.file("supabase/migrations/20261004120000_init.sql")).toBeNull();
  });

  it("BRAZO DE CONTROL: sin projectId, el zip de siempre", async () => {
    const zip = await leer(await pide({ html: HTML }));
    expect(Object.keys(zip.files).sort()).toEqual(["README.md", "index.html"]);
  });

  it("el README del dueño se respeta; el nuestro va aparte", async () => {
    mocks.carpeta = { "/README.md": "# Mi proyecto" };
    const zip = await leer(await pide({ html: HTML, projectId: "p1" }));
    expect(await zip.file("README.md")?.async("string")).toBe("# Mi proyecto");
    expect(await zip.file("OPENLEN.md")?.async("string")).toMatch(/Exported from OpenLen/);
  });

  it("lo que no es de la carpeta (rutas de la plataforma) no entra", async () => {
    mocks.carpeta = { "/js/app.js": "1", "/AGENTS.md": "manual", "/.openlen/x.md": "y", "/memoria/a.md": "z" };
    const zip = await leer(await pide({ html: HTML, projectId: "p1" }));
    expect(zip.file("js/app.js")).not.toBeNull();
    expect(zip.file("AGENTS.md")).toBeNull();
    expect(zip.file(".openlen/x.md")).toBeNull();
    expect(zip.file("memoria/a.md")).toBeNull();
  });
});
