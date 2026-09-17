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
  tope: vi.fn(async () => ({ ok: true })),
}));

vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", title: "title", data: "data" } },
}));
vi.mock("@/lib/projects", () => ({ getSubdomainOwner: mocks.duenyo }));
// El tope por IP se dobla a propósito: es un cubo COMPARTIDO por clave, y la
// clave aquí es la misma en todas las pruebas (una Request sin cabeceras no
// trae IP). Sin el doble, correr la suite dos veces en el mismo minuto empezaría
// a devolver 429 y las pruebas se caerían por el instrumento, no por el sujeto.
vi.mock("@/lib/limits", () => ({
  checkAndConsume: mocks.tope,
  getClientIp: () => "1.2.3.4",
  ipLimitKey: (ip: string, k: string) => `${k}:${ip}`,
}));

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
  mocks.tope.mockResolvedValue({ ok: true });
});

describe("GET /api/assistant/[sub] — el estado de las dos superficies", () => {
  it("🔴 encendido y sin chat: {asistente:true, chat:false}", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: true } }));
    const res = await pide();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ asistente: true, chat: false, traspaso: false });
  });

  it("🔴 apagado: {asistente:false} — que es lo que retira la burbuja", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: false } }));
    expect(await (await pide()).json()).toEqual({ asistente: false, chat: false, traspaso: false });
  });

  it("🔴 los dos encendidos: {asistente:true, chat:true}", async () => {
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: true }, chat: { enabled: true } }));
    expect(await (await pide()).json()).toEqual({ asistente: true, chat: true, traspaso: true });
  });

  it("🔴 una página SIN texto cuenta como apagado, igual que en el POST", async () => {
    // El POST contesta 403 `disabled` también cuando no hay de qué responder
    // (`!pageText`). Si el estado dijera que sí, la burbuja se quedaría para
    // dar exactamente el error que esto viene a quitar.
    mocks.limit.mockResolvedValue([
      { title: "Vacía", data: { html: "<html><body></body></html>", settings: { assistant: { enabled: true } } } },
    ]);
    expect(await (await pide()).json()).toEqual({ asistente: false, chat: false, traspaso: false });
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

// LAS ENTRADAS RARAS, que en este endpoint deciden si una burbuja viva se borra.
// Las pidió la revisión del 2026-09-17: el fichero sólo cubría los casos limpios.
describe("GET /api/assistant/[sub] — lo que no es un proyecto normal", () => {
  it("una fila sin `data` es 404, no un estado apagado", async () => {
    // La diferencia importa: un 404 el widget lo lee como «no sé» y no toca
    // nada; un {asistente:false} le borra la burbuja al visitante.
    mocks.limit.mockResolvedValue([{ title: "T", data: null }]);
    expect((await pide()).status).toBe(404);
  });

  it("un proyecto sin ajustes: todo apagado, y sin reventar", async () => {
    mocks.limit.mockResolvedValue([{ title: "T", data: { html: "<p>hola</p>" } }]);
    expect(await (await pide()).json()).toEqual({ asistente: false, chat: false, traspaso: false });
  });

  it("🔴 `enabled` con un valor raro cuenta como ENCENDIDO, igual que en el POST", async () => {
    // El JSONB admite lo que le metan. El POST usa `!assistant?.enabled`, así
    // que un 1 contesta; si aquí se usara `=== true`, el estado diría «apagado»
    // y el widget borraría una burbuja que atiende. Espejo exacto o nada.
    mocks.limit.mockResolvedValue(fila({ assistant: { enabled: 1 } }));
    expect((await (await pide()).json()).asistente).toBe(true);
  });

  it("🔴 el chat en modo CUENTA sigue encendido, pero sin traspaso", async () => {
    // `/api/chat/<sub>/handoff` acuña un invitado: exige espacio de invitado y
    // entrada libre. El botón «Hablar con una persona» cuelga de eso, no de que
    // el chat esté encendido.
    mocks.limit.mockResolvedValue(
      fila({ assistant: { enabled: true }, chat: { enabled: true, identityMode: "account" } }),
    );
    expect(await (await pide()).json()).toEqual({ asistente: true, chat: true, traspaso: false });
  });

  it("🔴 y un chat sólo por invitación, tampoco", async () => {
    mocks.limit.mockResolvedValue(
      fila({ assistant: { enabled: true }, chat: { enabled: true, selfServeJoin: false } }),
    );
    expect((await (await pide()).json()).traspaso).toBe(false);
  });

  it("pasado el tope por IP contesta 429 — y el widget ante eso NO se toca", async () => {
    mocks.tope.mockResolvedValue({ ok: false });
    const res = await pide();
    expect(res.status).toBe(429);
    // Lo que importa del 429 no es el número: es que no lleva `asistente`, así
    // que ninguna burbuja se retira por haber pasado un tope.
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});
