// EL ESTADO QUE MIRA LA BURBUJA ANTES DE QUEDARSE.
//
// El widget va HORNEADO en la release: apagar el asistente en el taller no toca
// el disco, así que hasta hoy la burbuja seguía ahí y, al preguntarle, contestaba
// «Hubo un problema. Intenta de nuevo en un momento.» — un 403 `disabled`
// disfrazado de avería pasajera. Este GET es lo que le permite esconderse sola.
//
// La regla de lo que devuelve: ESPEJO EXACTO de lo que las rutas de verdad
// hacen cumplir. `asistente` es lo mismo que decide el POST de aquí al lado
// (habilitado + la página tiene texto del que responder), y `chat` es lo mismo
// que decide `/api/chat/<sub>/*` (habilitado). Si el espejo se despega, la
// burbuja se esconde cuando sí funciona, o se queda cuando ya no.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  duenyo: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", title: "title", data: "data" } },
}));
vi.mock("@/lib/projects", () => ({ getSubdomainOwner: mocks.duenyo }));

import { GET } from "./route";

const pide = (sub = "taller") =>
  GET(new Request(`https://openlen.com/api/assistant/${sub}`), {
    params: Promise.resolve({ sub }),
  });

const fila = (settings: Record<string, unknown>) => [
  { title: "Taller Sauco", data: { html: "<html lang=es><body><h1>Taller Sauco</h1><p>Abrimos de lunes a viernes.</p></body></html>", settings } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.duenyo.mockResolvedValue({ userId: "u1", projectId: "p1" });
});

describe("GET /api/assistant/[sub] — el estado de las dos superficies", () => {
  it("🔴 encendido y sin chat: {asistente:true, chat:false}", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: true } }));
    const res = await pide();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asistente: true, chat: false });
  });

  it("🔴 apagado: {asistente:false} — que es lo que retira la burbuja", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: false } }));
    expect(await (await pide()).json()).toEqual({ asistente: false, chat: false });
  });

  it("🔴 los dos encendidos: {asistente:true, chat:true}", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: true }, chat: { enabled: true } }));
    expect(await (await pide()).json()).toEqual({ asistente: true, chat: true });
  });

  it("🔴 una página SIN texto cuenta como apagado, igual que en el POST", async () => {
    // El POST contesta 403 `disabled` también cuando no hay de qué responder
    // (`!pageText`). Si el estado dijera que sí, la burbuja se quedaría para
    // dar exactamente el error que esto viene a quitar.
    mocks.limit.mockResolvedValue([
      { title: "Vacía", data: { html: "<html><body></body></html>", settings: { assistant: { enabled: true } } } },
    ]);
    expect(await (await pide()).json()).toEqual({ asistente: false, chat: false });
  });

  it("un subdominio que no existe es 404, y el widget ante eso NO se toca", async () => {
    mocks.duenyo.mockResolvedValue(null);
    const res = await pide("fantasma");
    expect(res.status).toBe(404);
  });

  it("🔴 viaja con CORS y con una caché corta: lo pide otro origen en cada visita", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: true } }));
    const res = await pide();
    // La página vive en <sub>.openlen.app y esto contesta desde la apex.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // Una visita = una petición. El techo de 60 s es lo que separa «esto lo
    // aguanta Node en una portada con tráfico» de «cada visitante despierta la
    // base de datos», y es también lo que tarda como mucho en esconderse.
    expect(res.headers.get("cache-control")).toMatch(/max-age=60/);
  });

  it("y OPTIONS anuncia el GET, o el navegador no deja leer la respuesta", async () => {
    const { OPTIONS } = await import("./route");
    expect(OPTIONS().headers.get("access-control-allow-methods")).toMatch(/GET/);
  });
});
