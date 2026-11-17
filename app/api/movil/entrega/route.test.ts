import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), acceso: vi.fn(), proyecto: vi.fn(), versiones: vi.fn(), html: vi.fn(), cambios: vi.fn() }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: m.user }));
vi.mock("@/lib/projects/acceso", () => ({ exigirAcceso: m.acceso }));
vi.mock("@/lib/projects", () => ({ getProject: m.proyecto }));
vi.mock("@/lib/projects/versions", () => ({ listVersions: m.versiones, getVersionHtml: m.html }));
vi.mock("@/lib/projects/deshacer-turno", () => ({ cambiosDe: m.cambios }));
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
  // Deferred minor of the final review: a Len card's «Antes / Ahora» showed the page's latest change, not its turn's.
  it("🔴 con la fila de una tarjeta, compara lo que cambió ESE turno, nunca la última versión", async () => {
    m.cambios.mockResolvedValue({ deshecho: false, cambios: [
      { ruta: "/contacto/index.html", antes: "<p>C antes</p>", despues: "<p>C ahora</p>", deshacible: true },
      { ruta: "/index.html", antes: "<p>Turno antes</p>", despues: "<p>Turno ahora</p>", deshacible: true },
      { ruta: "/src/App.tsx", antes: "a", despues: "b", deshacible: true },
    ] });
    const j = await (await GET(new Request("https://openlen.com/api/movil/entrega?project=p1&fila=f1"))).json();
    expect(m.cambios).toHaveBeenCalledWith("p1", "f1");
    expect(j.comparacion.page).toBeNull();
    expect(j.comparacion.antes.html).toBe("<p>Turno antes</p>");
    expect(j.comparacion.ahora.html).toBe("<p>Turno ahora</p>");
    expect(m.versiones).not.toHaveBeenCalled();
  });
  it("🔴 un turno que no cambió ninguna página (o ya no se guarda): no hay comparación", async () => {
    m.cambios.mockResolvedValue({ deshecho: false, cambios: [{ ruta: "/index.html", antes: null, despues: "<p>Nueva</p>", deshacible: true }] });
    expect((await (await GET(new Request("https://openlen.com/api/movil/entrega?project=p1&fila=f1"))).json()).comparacion).toBeNull();
    m.cambios.mockResolvedValue(null);
    expect((await (await GET(new Request("https://openlen.com/api/movil/entrega?project=p1&fila=f1"))).json()).comparacion).toBeNull();
    expect(m.versiones).not.toHaveBeenCalled();
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
