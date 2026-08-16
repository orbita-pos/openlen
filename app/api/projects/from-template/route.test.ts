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
  resolveProfile: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { insert: mocks.insert }, schema: { projects: {} } }));
vi.mock("@/lib/templates/store", () => ({
  getTemplate: mocks.getTemplate,
  getTemplateHtml: mocks.getTemplateHtml,
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/transform/template-cache", () => ({ transformTemplateCached: mocks.transformCached }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfile }));

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
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
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
});
