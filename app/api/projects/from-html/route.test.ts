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
  resolveProfile: vi.fn(),
  thumbnail: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { insert: mocks.insert },
  schema: { projects: {} },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/transform", () => ({ transformIngestedHtml: mocks.transform }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfile }));
vi.mock("@/lib/projects/thumbnail", () => ({ renderProjectThumbnail: mocks.thumbnail }));

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
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
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
      { surface: "from-html", stage: "behaviors", code: "broken_controls", count: 1 },
    ]);
  });

  it("records dynamic content that the transform could not bake", async () => {
    mocks.transform.mockImplementation(async (html: string) => ({
      html,
      report: { bakedContainers: 0, bakedGeoms: 0, translated: [], tabsFound: 0, ms: 1, fallback: "timeout" },
    }));

    const res = await call(doc("<h1>Hola</h1>"));

    expect(res.status).toBe(200);
    expect(storedData().degradations).toEqual([
      { surface: "from-html", stage: "transform", code: "dynamic_content", count: 1 },
    ]);
  });

  it("still refuses the reserved marker — that never fails open", async () => {
    const res = await call(doc('<section data-slot-path="a">x</section>'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_html");
    expect(mocks.values).not.toHaveBeenCalled();
  });
});
