// Task 4 step 2 — from-html is a FAIL-OPEN surface: the project does not
// exist yet, so refusing costs the user the whole page instead of an edit. It
// ships what it can and records what was lost on the row.
//
// Only auth, db, the profile store, the transform and the thumbnail are
// mocked; sanitize/normalize/meta/behaviours are the real passes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  createVersion: vi.fn(),
  transform: vi.fn(),
  thumbnail: vi.fn(),
  tope: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert },
  schema: { projects: {} },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/transform", () => ({ transformIngestedHtml: mocks.transform }));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: mocks.thumbnail }));
// El tope de ingestión: por defecto DEJA PASAR, para que las pruebas de
// siempre midan lo que venían midiendo. Su propio caso lo pone en bloqueo.
vi.mock("@/lib/ingestion/tope", () => ({ topeDeIngestion: mocks.tope }));

import { POST } from "./route";

const FILLER = "<p>Contenido de la página pegada.</p>".repeat(10);
const doc = (inner: string) =>
  `<!doctype html><html lang="es"><head><title>Mi página</title></head><body>${inner}${FILLER}</body></html>`;

function call(html: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/projects/from-html", {
      method: "POST",
      body: JSON.stringify({ html }),
    }),
  );
}

function storedData(): { html: string; degradations?: { code: string; count: number }[] } {
  return (mocks.values.mock.calls[0][0] as { data: { html: string; degradations?: { code: string; count: number }[] } }).data;
}

describe("POST /api/projects/from-html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.createVersion.mockResolvedValue("v1");
    mocks.thumbnail.mockReturnValue(undefined);
    // Default: the transform succeeded and changed nothing.
    mocks.transform.mockImplementation(async (html: string) => ({
      html,
      report: { bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, ms: 1 },
    }));
  });

  it("records nothing when the page comes through whole", async () => {
    const res = await call(doc("<h1>Hola</h1>"));

    expect(res.status).toBe(200);
    const data = storedData();
    expect(data.degradations).toBeUndefined();
    // The gate's passes still ran: the head is completed and the page is
    // born on the theme contract.
    expect(data.html).toMatch(/<meta name="description"/i);
    expect(data.html).toContain("--ol-");
  });

  it("keeps the page and records the JavaScript it had to strip", async () => {
    const res = await call(
      doc('<h1>Hola</h1><script>init()</script><button onclick="go()">Ir</button>'),
    );

    // FAIL OPEN — the user gets their page.
    expect(res.status).toBe(200);
    expect(mocks.values).toHaveBeenCalledTimes(1);
    const data = storedData();
    // One script + one inline handler fold into a single thing the user lost.
    expect(data.degradations).toEqual([
      { surface: "from-html", stage: "sanitize", code: "scripts", count: 2 },
    ]);
    expect(data.html).not.toContain("<script>init()");
  });

  it("keeps the page and records a mis-wired control instead of refusing", async () => {
    // behaviors:"warn" is what makes this a fail-open surface. Blocking here
    // would cost the user the whole paste.
    const res = await call(doc('<a data-ol-lightbox href="https://x.test/a.jpg">sin img</a>'));

    expect(res.status).toBe(200);
    expect(storedData().degradations).toEqual([
      {
        surface: "from-html",
        stage: "behaviors",
        code: "broken_controls",
        count: 1,
        // El detalle viaja con el conteo hasta la fila del proyecto: es lo que
        // el botón "Arreglar esto" le pasa al asistente. Sin él, el aviso
        // vuelve a ser "algunos controles" y el creador no sabe qué pedir.
        detail: [expect.any(String)],
      },
    ]);
  });

  it("records dynamic content that the transform could not bake", async () => {
    mocks.transform.mockImplementation(async (html: string) => ({
      html,
      report: { bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, ms: 1, fallback: "timeout" },
    }));

    const res = await call(doc("<h1>Hola</h1><script>build()</script>"));

    expect(res.status).toBe(200);
    expect(storedData().degradations).toEqual([
      { surface: "from-html", stage: "transform", code: "dynamic_content", count: 1 },
      { surface: "from-html", stage: "sanitize", code: "scripts", count: 1 },
    ]);
  });

  it("stays quiet when the transform falls back on a page with no script", async () => {
    // The fallback also fires when Chrome dies — a recurring failure. Warning
    // then would alarm every paste during an outage about dynamic content the
    // page never had.
    mocks.transform.mockImplementation(async (html: string) => ({
      html,
      report: { bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, ms: 1, fallback: "timeout" },
    }));

    const res = await call(doc("<h1>Hola</h1>"));

    expect(res.status).toBe(200);
    // Absent, not empty: a row with nothing to say reads the same as one
    // created before this existed, and the surface has nothing to render.
    expect(storedData().degradations).toBeUndefined();
  });

  it("still refuses the reserved marker — that never fails open", async () => {
    const res = await call(doc('<section data-slot-path="a">x</section>'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_html");
    expect(mocks.values).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL TOPE DE INGESTIÓN.
//
// 🔴 Esta ruta no tenía puerta. No gasta una llamada de modelo —así que no la
// frenan ni el crédito ni la cuota de generación— pero SÍ arranca Chromium, y
// además NO cachea nada (su propio comentario: «contenido de un solo uso»), así
// que CADA petición paga su navegador entero con HTML arbitrario.
describe("el tope de ingestión", () => {
  // El mismo montaje que el bloque de arriba: este describe vive fuera de su
  // `beforeEach`, así que sin esto la ruta contestaría 401 y la prueba
  // mediría la puerta equivocada.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.createVersion.mockResolvedValue("v1");
    mocks.thumbnail.mockReturnValue(undefined);
    mocks.tope.mockResolvedValue(null);
    mocks.transform.mockImplementation(async (html) => ({
      html,
      report: { bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, ms: 1 },
    }));
  });

  it("🔴 se consulta ANTES de tocar el HTML: un bloqueo no arranca Chromium", async () => {
    mocks.tope.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "quota_exceeded" }), { status: 429 }),
    );

    const res = await call(doc("<h1>x</h1>"));

    expect(res.status).toBe(429);
    // Lo que importa no es el 429: es que el transform —el que abre el
    // navegador— no llegó a correr. Un tope que rechaza DESPUÉS de pagar el
    // trabajo no es un tope, es un mensaje.
    expect(mocks.transform).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("y cuando deja pasar, la ruta hace lo de siempre", async () => {
    const res = await call(doc("<h1>x</h1>"));
    expect(res.status).toBe(200);
    expect(mocks.transform).toHaveBeenCalled();
  });
});
