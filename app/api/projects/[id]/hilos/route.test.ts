import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quienEnElProyecto: vi.fn(),
  avisarMenciones: vi.fn(async () => {}),
  pedirleALen: vi.fn(async (): Promise<string | null> => null),
  crearHilo: vi.fn(async () => ({ hiloId: "h1", mensajeId: "m1", mencionados: [] as string[] })),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/notifications/dispatch", () => ({ scheduleNotification: vi.fn() }));
vi.mock("./_comun", async (original) => ({
  ...(await original<typeof import("./_comun")>()),
  quienEnElProyecto: mocks.quienEnElProyecto,
  avisarMenciones: mocks.avisarMenciones,
  pedirleALen: mocks.pedirleALen,
}));
vi.mock("@/lib/projects/hilos", async (original) => ({
  ...(await original<typeof import("@/lib/projects/hilos")>()),
  crearHilo: mocks.crearHilo,
}));
vi.mock("@/lib/agent/turnos-desde-el-servidor", () => ({ retomarPedidosDelHilo: vi.fn(async () => {}) }));

import { MAX_CODIGO_DEL_HILO } from "@/lib/projects/hilos";
import { POST } from "./route";

const crear = async (cuerpo: Record<string, unknown>) => {
  const res = await POST(
    new Request("http://localhost/api/projects/p1/hilos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
};

describe("POST /api/projects/[id]/hilos — abrir un hilo en una línea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quienEnElProyecto.mockResolvedValue({ ok: true, userId: "u1", nombre: "Dana", acceso: { rol: "dueno" } });
  });

  // 🔴 Visto en el ensayo del 07/10: un HTML pegado (o minificado, o un `<path>`
  // de SVG) es UNA línea de miles de caracteres, y el cliente manda la línea
  // entera. La ruta la rechazaba con `invalid_body` («No se pudo»), cuando lo
  // que se guarda es sólo su principio (`MAX_CODIGO_DEL_HILO`).
  it("🔴 una línea de miles de caracteres abre el hilo, con su código recortado", async () => {
    const linea = `<!doctype html>${"<div>x</div>".repeat(800)}`;
    const { status, cuerpo } = await crear({ ruta: "/index.html", linea: 1, codigo: linea, texto: "@Len cambia el botón", len: false });
    expect(status).toBe(200);
    expect(cuerpo.hiloId).toBe("h1");
    expect(mocks.crearHilo).toHaveBeenCalledWith(expect.objectContaining({ codigo: linea.slice(0, MAX_CODIGO_DEL_HILO) }));
  });

  it("una línea corta llega tal cual", async () => {
    await crear({ ruta: "/index.html", linea: 3, codigo: "<h1>Hola</h1>", texto: "revisa esto" });
    expect(mocks.crearHilo).toHaveBeenCalledWith(expect.objectContaining({ codigo: "<h1>Hola</h1>", linea: 3 }));
  });
});
