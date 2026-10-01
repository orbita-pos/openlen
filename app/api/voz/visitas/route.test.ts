// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ quien: vi.fn(), dueno: vi.fn(), resumir: vi.fn() }));
vi.mock("@/lib/movil/quien", () => ({ usuarioDeLaPeticion: mocks.quien }));
vi.mock("@/lib/voz/dueno", () => ({ esDuenoDelProyecto: mocks.dueno }));
vi.mock("@/lib/resultados/visitas", () => ({ resumirVisitas: mocks.resumir }));

import { GET } from "./route";

const cuenta = { vistas: 0, personas: 0, clics: 0 };
const RESUMEN = {
  zona: "America/Mexico_City", hoy: { ...cuenta, vistas: 3 }, ayer: cuenta, ultimos7: { vistas: 8, personas: 8, clics: 0 }, ultimos30: cuenta,
  rango: { desde: "", hasta: "", total: { vistas: 8, personas: 8, clics: 0 }, porDia: [], paginas: [], deDonde: [], dispositivos: [] },
  recortadoDesde: null,
};
const pide = () => new Request("http://x/api/voz/visitas?project=p1&zona=America%2FMexico_City", { headers: { origin: "http://localhost:5173" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.quien.mockResolvedValue("u1");
  mocks.dueno.mockResolvedValue(true);
  mocks.resumir.mockResolvedValue(RESUMEN);
});

describe("GET /api/voz/visitas desde la app", () => {
  it("con quien sea que diga usuarioDeLaPeticion, y con CORS", async () => {
    const r = await GET(pide());
    expect(r.status).toBe(200);
    expect((await r.json()).vistas).toBe(8);
    expect(mocks.dueno).toHaveBeenCalledWith("p1", "u1");
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("nadie → 401, también con CORS (la app tiene que poder leer el 401)", async () => {
    mocks.quien.mockResolvedValue(null);
    const r = await GET(pide());
    expect(r.status).toBe(401);
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
