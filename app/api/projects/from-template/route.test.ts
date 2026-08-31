// Task 4 step 2 — degradation #6. A curated subpage that fails the gate used
// to be dropped silently: the clone shipped, the nav still linked to it, and
// because a broken link serves the HOME page the site looked complete and
// lied about itself. It now fails the whole clone loudly.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  getTemplate: vi.fn(),
  getTemplateHtml: vi.fn(),
  createVersion: vi.fn(),
  transformCached: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert }, schema: { projects: {} } }));
vi.mock("@/lib/templates/store", () => ({
  getTemplate: mocks.getTemplate,
  getTemplateHtml: mocks.getTemplateHtml,
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/transform/template-cache", () => ({ transformTemplateCached: mocks.transformCached }));
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
    // The transform is a pass-through in these tests.
    mocks.transformCached.mockImplementation(async (_id: string, html: string) => html);
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
