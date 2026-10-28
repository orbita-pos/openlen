import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
// What `accesoAlProyecto` reads: the project's owner and, for a member, their role.
const owners: { duenoId: string; rol: "editor" | "lector" | null }[] = [];
vi.mock("@/lib/db", () => {
  const chain = { from: () => chain, leftJoin: () => chain, where: () => chain, limit: async () => owners };
  return {
    db: { select: () => chain },
    schema: { projects: { id: "id", userId: "userId" }, projectMembers: { projectId: "projectId", userId: "userId", rol: "rol" } },
  };
});
vi.mock("@/lib/agent/herramientas-de-ficheros", () => ({ cargarFicherosDeLaTerminal: vi.fn() }));
const loadProject = vi.fn();
vi.mock("@/lib/agent/tools", () => ({ realDeps: () => ({ loadProject }) }));

import { GET } from "./route";
import { auth } from "@/auth";
import { cargarFicherosDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";

const asUser = (userId: string | null) => vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
const get = (headers: Record<string, string> = {}) =>
  GET(new Request("http://x/api/projects/p1/mention-index", { headers }), { params: Promise.resolve({ id: "p1" }) });

const HOME = "<!doctype html>\n<html><body>\n<h1>Pan</h1>\n</body></html>";
const CONTACT = "<!doctype html>\n<html><body>\n<h2>Contacto</h2>\n</body></html>";

describe("GET /api/projects/[id]/mention-index", () => {
  beforeEach(() => {
    owners.splice(0, owners.length, { duenoId: "u1", rol: null });
    vi.mocked(auth).mockReset();
    loadProject.mockReset();
    vi.mocked(cargarFicherosDeLaTerminal).mockReset();
  });

  it("401 without a session and 404 for someone else's project", async () => {
    asUser(null);
    expect((await get()).status).toBe(401);
    asUser("u1");
    owners.splice(0);
    expect((await get()).status).toBe(404);
  });

  it("serves each page of a site tagged with line positions, plus the file list", async () => {
    asUser("u1");
    loadProject.mockResolvedValue({ data: { html: HOME, pages: { contacto: { html: CONTACT } } }, userBrief: null });
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({
      "/index.html": HOME,
      "/contacto/index.html": CONTACT,
      "/LEN.md": "notas",
      "/AGENTS.md": "manual",
      "/.openlen/resultados/x.json": "{}",
    });
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("page");
    expect(body.pages.map((p: { ruta: string }) => p.ruta)).toEqual(["/index.html", "/contacto/index.html"]);
    expect(body.pages[1].page).toBe("contacto");
    expect(body.pages[0].tagged).toContain('<h1 data-op-id="L3C1">');
    expect(body.files).toEqual(["/LEN.md", "/contacto/index.html", "/index.html"]);
    expect(res.headers.get("etag")).toBe(`"${body.hash}"`);
  });

  it("serves an app as its JSX outline", async () => {
    asUser("u1");
    loadProject.mockResolvedValue({ data: { html: "<div id=root></div>", app: { catalogo: "2026-11", entrada: "/src/main.jsx" } }, userBrief: null });
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({
      "/index.html": "<div id=root></div>",
      "/src/App.jsx": "export default function App() {\n  return <h1>Hola</h1>;\n}\n",
    });
    const body = await (await get()).json();
    expect(body.kind).toBe("app");
    expect(body.entries).toEqual([expect.objectContaining({ ruta: "/src/App.jsx", line: 2, tag: "h1", name: "Hola" })]);
    expect(vi.mocked(cargarFicherosDeLaTerminal).mock.calls[0]![0]).toMatchObject({ app: { catalogo: "2026-11" } });
  });

  it("answers 304 when nothing changed", async () => {
    asUser("u1");
    loadProject.mockResolvedValue({ data: { html: HOME }, userBrief: null });
    vi.mocked(cargarFicherosDeLaTerminal).mockResolvedValue({ "/index.html": HOME });
    const first = await get();
    const etag = first.headers.get("etag")!;
    const second = await get({ "if-none-match": etag });
    expect(second.status).toBe(304);
  });
});
