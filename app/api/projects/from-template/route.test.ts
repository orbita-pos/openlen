// Task 4 step 2 — degradation #6. A curated subpage that fails the gate used
// to be dropped silently: the clone shipped, the nav still linked to it, and
// because a broken link serves the HOME page the site looked complete and
// lied about itself. It now fails the whole clone loudly.
//
// LA ENTRADA COMO VERCEL (2026-10-04): la plantilla se clona como es, con su
// JavaScript; sólo el marcador reservado se rechaza.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  getTemplate: vi.fn(),
  getTemplateHtml: vi.fn(),
  createVersion: vi.fn(),
  tope: vi.fn(async (): Promise<Response | null> => null),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert }, schema: { projects: {} } }));
vi.mock("@/lib/templates/store", () => ({
  getTemplate: mocks.getTemplate,
  getTemplateHtml: mocks.getTemplateHtml,
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
// El tope de ingestión: por defecto DEJA PASAR, para que las pruebas de siempre
// midan lo que venían midiendo. Su propio caso lo pone en bloqueo.
vi.mock("@/lib/ingestion/tope", () => ({ topeDeIngestion: mocks.tope }));
import { POST } from "./route";

const FILLER = "<p>Contenido de la plantilla.</p>".repeat(10);
const doc = (inner: string) =>
  `<!doctype html><html lang="es"><head><title>T</title></head><body>${inner}${FILLER}</body></html>`;
const HOME = doc("<h1>Home</h1>");

function call(): Promise<Response> {
  return POST(
    new Request("http://localhost/api/projects/from-template", {
      method: "POST",
      body: JSON.stringify({ templateId: "mirror" }),
    }),
  );
}

describe("POST /api/projects/from-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.createVersion.mockResolvedValue("v1");
    mocks.getTemplateHtml.mockResolvedValue(HOME);
    mocks.getTemplate.mockResolvedValue({
      id: "mirror",
      name: "Mirror",
      status: "published",
      pages: [],
    });
  });

  it("clones a clean multi-page template, subpages included", async () => {
    mocks.getTemplate.mockResolvedValue({
      id: "mirror",
      name: "Mirror",
      status: "published",
      pages: [{ slug: "tienda", html: doc("<h1>Tienda</h1>") }],
    });

    const res = await call();

    expect(res.status).toBe(200);
    const data = (mocks.values.mock.calls[0][0] as { data: { pages?: Record<string, unknown> } }).data;
    expect(Object.keys(data.pages ?? {})).toEqual(["tienda"]);
  });

  // 🔴 LA HOME RECUPERABA SUS `<script>` Y LAS SUBPÁGINAS NO (2026-08-31 a
  // 2026-09-01): el empalme `conservarScripts` estaba sólo en la Home. Desde el
  // 2026-10-04 no hay empalme —la puerta no quita los scripts—, y esto vigila
  // que las dos sigan llegando enteras.
  it("🔴 una subpágina conserva sus <script>, igual que la Home", async () => {
    const SCRIPT = `<script>window.__tienda=1;</script>`;
    mocks.getTemplateHtml.mockResolvedValue(doc(`<h1>Home</h1>${SCRIPT}`));
    mocks.getTemplate.mockResolvedValue({
      id: "mirror",
      name: "Mirror",
      status: "published",
      pages: [{ slug: "tienda", html: doc(`<h1>Tienda</h1>${SCRIPT}`) }],
    });

    const res = await call();

    expect(res.status).toBe(200);
    const data = (
      mocks.values.mock.calls[0][0] as {
        data: { html: string; pages?: Record<string, { html: string }> };
      }
    ).data;
    // La Home ya lo hacía.
    expect(data.html).toContain("window.__tienda=1;");
    // La subpágina es la que no.
    expect(data.pages?.tienda.html).toContain("window.__tienda=1;");
  });

  // 🔴 LA ENTRADA COMO VERCEL. El saneador se llevaba los `on*` (y nadie los
  // devolvía: `conservarScripts` trabajaba con bloques) y los `<script src>`
  // que no fueran el CDN de Tailwind. Ahora llega todo, y la fila no apunta
  // ninguna pérdida.
  it("🔴 clona el JavaScript tal cual: el on*, el script de un CDN y el inline", async () => {
    mocks.getTemplateHtml.mockResolvedValue(
      doc(
        '<h1>Home</h1><button onclick="abrir()">Abrir</button>' +
          '<script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>' +
          "<script>if (1 < 2 && 3 > 2) { window.__ok = '<i>ok</i>'; }</script>",
      ),
    );

    const res = await call();

    expect(res.status).toBe(200);
    const data = (mocks.values.mock.calls[0][0] as { data: { html: string; degradations?: unknown } }).data;
    expect(data.html).toContain('onclick="abrir()"');
    expect(data.html).toContain('src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"');
    expect(data.html).toContain("<script>if (1 < 2 && 3 > 2) { window.__ok = '<i>ok</i>'; }</script>");
    expect(data.degradations).toBeUndefined();
  });

  it("fails the whole clone when a subpage cannot be cleaned, instead of dropping it", async () => {
    mocks.getTemplate.mockResolvedValue({
      id: "mirror",
      name: "Mirror",
      status: "published",
      pages: [{ slug: "tienda", html: doc('<section data-slot-path="a">x</section>') }],
    });

    const res = await call();

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid_template");
    // Name the page, so whoever fixes the curated file knows which one.
    expect(body.message).toContain("tienda");
    // Nothing half-built reaches the database.
    expect(mocks.values).not.toHaveBeenCalled();
  });

  it("does not publish the template's marketing copy as the user's page identity", async () => {
    // Curated bodies ship real marketing metadata — templates/starter/abismo.html
    // opens with <title>ABISMO — Terror atmosférico…</title> and an og:description
    // about a game. ensurePageMeta is NON-DESTRUCTIVE by default, so a clone
    // faithfully keeps all of it: the user's browser tab, Google result and
    // WhatsApp card advertise someone else's product. `replaceStaleMeta` exists
    // for exactly this and names this exact path in its doc comment — and this
    // path was the one not passing it.
    const CURATED = `<!doctype html><html lang="es"><head>
<title>ABISMO — Terror atmosférico de supervivencia. Baja, si te atreves.</title>
<meta name="description" content="ABISMO es un juego indie de terror. Próximamente en Steam." />
<meta property="og:title" content="ABISMO — Terror atmosférico de supervivencia" />
<meta property="og:description" content="Baja al abismo, si te atreves." />
</head><body><h1>Pastelería Luna</h1><p>Pasteles artesanales hechos a mano en Guadalajara desde 2011.</p>${FILLER}</body></html>`;
    mocks.getTemplateHtml.mockResolvedValue(CURATED);

    const res = await call();

    expect(res.status).toBe(200);
    const html = (mocks.values.mock.calls[0][0] as { data: { html: string } }).data.html;
    expect(html).not.toContain("ABISMO");
    expect(html).not.toContain("Steam");
    expect(html).toContain("<title>Mirror</title>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL TOPE DE INGESTIÓN.
//
// 🔴 Esta ruta no tenía puerta. No gasta una llamada de modelo, así que no la
// frenan ni el crédito ni la cuota de generación. Hasta el 2026-10-04 el
// transformador arrancaba Chromium por documento; hoy cada clon escribe un
// proyecto y sus versiones.
describe("el tope de ingestión", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.values.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.createVersion.mockResolvedValue("v1");
    mocks.getTemplateHtml.mockResolvedValue(HOME);
    mocks.tope.mockResolvedValue(null);
    mocks.getTemplate.mockResolvedValue({
      id: "mirror",
      name: "Mirror",
      status: "published",
      pages: [],
    });
  });

  it("🔴 se consulta ANTES de ir a buscar la plantilla, no después", async () => {
    mocks.tope.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "quota_exceeded" }), { status: 429 }),
    );

    const res = await call();

    expect(res.status).toBe(429);
    // Rechazar DESPUÉS de haber traído el cuerpo por la red es pagar el
    // trabajo que se está rechazando.
    expect(mocks.getTemplateHtml).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("y cuando deja pasar, el clon ocurre igual que siempre", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalled();
  });
});
