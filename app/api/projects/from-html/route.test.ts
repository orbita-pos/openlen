// Task 4 step 2 — from-html is a FAIL-OPEN surface: the project does not
// exist yet, so refusing costs the user the whole page instead of an edit.
//
// LA ENTRADA COMO VERCEL (2026-10-04): lo pegado se guarda como se pegó, con su
// JavaScript. Sólo el marcador reservado se rechaza.
//
// Only auth, db, the version store and the thumbnail are mocked; the gate,
// normalize and meta are the real passes (with the native binding).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  createVersion: vi.fn(),
  thumbnail: vi.fn(),
  tope: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert },
  schema: { projects: {} },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
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

  // 🔴 LA ENTRADA COMO VERCEL. Hasta el 2026-10-04 esta prueba se llamaba
  // «keeps the page and records the JavaScript it had to strip»: el saneador
  // borraba el `<script>` y el `onclick`, y la fila apuntaba la pérdida. Ahora
  // llegan los dos, y no hay nada que apuntar.
  it("🔴 guarda el JavaScript tal cual: el <script>, el on* y el script de un CDN", async () => {
    // Un script que una re-serialización descuidada rompería: `<`, `&&` y HTML
    // dentro de una cadena.
    const js = "if (a < b && c > d) { document.body.insertAdjacentHTML('beforeend', '<b>x</b>'); }";
    const res = await call(
      doc(
        `<h1>Hola</h1><script>${js}</script><button onclick="go()">Ir</button>` +
          '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      ),
    );

    expect(res.status).toBe(200);
    expect(mocks.values).toHaveBeenCalledTimes(1);
    const data = storedData();
    expect(data.html).toContain(`<script>${js}</script>`);
    expect(data.html).toContain('onclick="go()"');
    expect(data.html).toContain('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"');
    expect(data.degradations).toBeUndefined();
  });

  // ⚰️ Antes: «records a mis-wired control» (`broken_controls`). Ahora no hay
  // nada que anotar: las conductas `data-ol-*` se retiraron el 2026-10-04: un `data-ol-copy` es
  // un atributo como otro cualquiera, y la puerta ya no rechaza por él.
  it("un `data-ol-lightbox` suelto ya no deja ningún aviso: se guarda tal cual", async () => {
    const res = await call(doc('<a data-ol-lightbox href="https://x.test/a.jpg">sin img</a>'));

    expect(res.status).toBe(200);
    expect(storedData().degradations ?? []).toEqual([]);
  });

  // ⚰️ «records dynamic content that the transform could not bake» y «stays
  // quiet when the transform falls back on a page with no script»: el
  // transformador de ingestión se retiró el 2026-10-04.

  it("still refuses the reserved marker — that never fails open", async () => {
    const res = await call(doc('<section data-slot-path="a">x</section>'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_html");
    expect(mocks.values).not.toHaveBeenCalled();
  });

  // La comprobación literal de la puerta (`includes("data-slot-path=")`) no ve
  // esta variante; `gateReservedMarker` (Rust) sí. Sin el saneador delante, es
  // lo único que la para.
  it("y también sus variantes: mayúsculas y espacios alrededor del =", async () => {
    const res = await call(doc('<section DATA-SLOT-PATH = "a">x</section>'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_html");
    expect(mocks.values).not.toHaveBeenCalled();
  });

  // 🔴 Y ESCONDIDAS EN LOS DOS SCRIPTS QUE `sanitizeForPublish` SACA ANTES DE
  // LLAMAR A RUST: el `tailwind.config` y el carrier `data-ol-tw`. Pasaban la
  // puerta (medido el 2026-10-04 por el revisor de publicación) y, como la
  // puerta devuelve el documento original, llegaban a la base.
  it.each([
    ["el tailwind.config", '<script>tailwind.config={theme:{extend:{colors:{ink:"#111"}}}} /* DATA-SLOT-PATH="x" */</script>'],
    ["el carrier data-ol-tw", '<script type="application/json" data-ol-tw>{"colors":{"ink":"#111"}} Data-Slot-Path="a"</script>'],
  ])("y escondidas en %s", async (_, script) => {
    const res = await call(doc(`${script}<h1>Hola</h1>`));

    expect(res.status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("CONTRA-PRUEBA: un tailwind.config limpio entra, y con su script", async () => {
    const config = '<script>tailwind.config={theme:{extend:{colors:{ink:"#111"}}}}</script>';
    const res = await call(doc(`${config}<h1 class="text-ink">Hola</h1>`));

    expect(res.status).toBe(200);
    expect(storedData().html).toContain(config);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL TOPE DE INGESTIÓN.
//
// 🔴 Esta ruta no tenía puerta. No gasta una llamada de modelo —así que no la
// frenan ni el crédito ni la cuota de generación— y cada página pegada arranca
// un Chromium para su miniatura (y, hasta el 2026-10-04, otro para el
// transformador de ingestión).
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
  });

  it("🔴 se consulta ANTES de tocar el HTML: un bloqueo no arranca Chromium", async () => {
    mocks.tope.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "quota_exceeded" }), { status: 429 }),
    );

    const res = await call(doc("<h1>x</h1>"));

    expect(res.status).toBe(429);
    // Lo que importa no es el 429: es que la miniatura —la que abre el
    // navegador— no llegó a pedirse. Un tope que rechaza DESPUÉS de pagar el
    // trabajo no es un tope, es un mensaje.
    expect(mocks.thumbnail).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("y cuando deja pasar, la ruta hace lo de siempre", async () => {
    const res = await call(doc("<h1>x</h1>"));
    expect(res.status).toBe(200);
    expect(mocks.thumbnail).toHaveBeenCalled();
  });
});
