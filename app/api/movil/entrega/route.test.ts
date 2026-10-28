import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), acceso: vi.fn(), proyecto: vi.fn(), versiones: vi.fn(), html: vi.fn() }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.user }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: m.acceso }));
vi.mock("@/lib/projects", () => ({ getProject: m.proyecto }));
vi.mock("@/lib/projects/versions", () => ({ listVersions: m.versiones, getVersionHtml: m.html }));
import { GET } from "./route";
const req = () => new Request("https://openlen.com/api/movil/entrega?project=p1", { headers: { origin: "https://localhost" } });
beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue("u1");
  m.acceso.mockResolvedValue({ duenoId: "owner" });
  m.proyecto.mockResolvedValue({ title: "Página", data: { html: "<p>Ahora</p>", pages: {} }, updatedAt: new Date() });
  m.versiones.mockResolvedValue([{ id: "v2", page: null, createdAt: new Date() }, { id: "v1", page: null, createdAt: new Date() }]);
  m.html.mockImplementation(async ({ versionId }) => versionId === "v2" ? "<p>Ahora</p>" : "<p>Antes</p>");
});
describe("entrega móvil", () => {
  it("requiere acceso antes de leer versiones", async () => {
    m.acceso.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(req())).status).toBe(404);
    expect(m.versiones).not.toHaveBeenCalled();
  });
  it("usa dos documentos distintos del mismo proyecto", async () => {
    const r = await GET(req());
    expect(r.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const j = await r.json();
    expect(j.comparacion.antes.html).toBe("<p>Antes</p>");
    expect(j.comparacion.ahora.html).toBe("<p>Ahora</p>");
    expect(m.html).toHaveBeenCalledWith({ projectId: "p1", userId: "owner", versionId: "v1" });
  });
  it("no compara páginas distintas ni inventa un antes", async () => {
    m.versiones.mockResolvedValue([{ id: "v1", page: "contacto" }]);
    expect((await (await GET(req())).json()).comparacion).toBeNull();
    expect(m.html).not.toHaveBeenCalled();
  });
  it("sin sesión no lee el proyecto", async () => {
    m.user.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(m.proyecto).not.toHaveBeenCalled();
  });
  it("conserva los estilos Tailwind sin ejecutar el CDN en la app", async () => {
    m.proyecto.mockResolvedValue({ title: "Página", data: { html: '<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><p class="text-orange-500">Ahora</p></body></html>' }, updatedAt: new Date() });
    const j = await (await GET(req())).json();
    expect(j.comparacion.ahora.html).not.toContain("cdn.tailwindcss.com");
    expect(j.comparacion.ahora.html).toContain(".text-orange-500");
  });
});
