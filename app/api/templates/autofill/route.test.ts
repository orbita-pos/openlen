// Task 5 of the gate/request-surfaces plan. This route — not fill-template.ts,
// which the plan named — is the genuinely un-gated fill surface: `filledHtml`
// went straight into projects.data.html with no normalize, no page meta and no
// behaviour validation.
//
// fillTemplate is mocked so the test drives the ROUTE's gate; sanitize,
// normalize, ensurePageMeta and validateBehaviors are the real ones.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
  createVersion: vi.fn(),
  getCreditState: vi.fn(),
  debitCredits: vi.fn(),
  consumeToken: vi.fn(),
  fillTemplate: vi.fn(),
  extractFromText: vi.fn(),
  extractFromImage: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  schema: { projects: { id: "id", userId: "userId", data: "data" } },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  debitCredits: mocks.debitCredits,
  AUTOFILL_CREDIT_COST: 2,
}));
vi.mock("@/lib/rate-limit", () => ({
  consumeToken: mocks.consumeToken,
  RATE_LIMITS: { autofill: { limit: 10, windowMs: 3600000 } },
}));
vi.mock("@/lib/style-match/autofill", () => ({
  fillTemplate: mocks.fillTemplate,
  extractFromText: mocks.extractFromText,
  extractFromImage: mocks.extractFromImage,
}));

import { POST } from "./route";

const FILLER = "<p>Texto real de la página para que el documento tenga cuerpo.</p>".repeat(10);
const CURRENT_HTML = `<!doctype html><html lang="es"><head><title>Plantilla</title></head><body><h1>Tu negocio</h1>${FILLER}</body></html>`;

function filled(bodyInner: string): string {
  return `<!doctype html><html lang="es"><head><title>Tacos Doña Mari</title></head><body>${bodyInner}${FILLER}</body></html>`;
}

async function readEvents(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => ({
      event: /^event: (.+)$/m.exec(chunk)?.[1] ?? "",
      data: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}") as Record<string, unknown>,
    }));
}

let projectCounter = 0;
function call(): Promise<Response> {
  // A fresh projectId per call — the route holds an in-flight lock keyed by
  // user+project that is only released in a finally block.
  projectCounter += 1;
  return POST(
    new Request("http://localhost/api/templates/autofill", {
      method: "POST",
      body: JSON.stringify({
        projectId: `p${projectCounter}`,
        source: "text",
        description: "Taquería familiar en Guadalajara con recetas de la abuela.",
      }),
    }),
  );
}

describe("POST /api/templates/autofill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.consumeToken.mockReturnValue({ allowed: true, limit: 10, retryAfterMs: 0 });
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ data: { html: CURRENT_HTML } }] }) }),
    });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.createVersion.mockResolvedValue("v1");
    mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.debitCredits.mockResolvedValue(undefined);
    mocks.extractFromText.mockResolvedValue({
      ok: true,
      data: { business_name: "Tacos Doña Mari" },
    });
  });

  it("gives the filled page the passes it was never given, then saves it", async () => {
    mocks.fillTemplate.mockResolvedValue({
      ok: true,
      filledHtml: filled("<h1>Tacos Doña Mari</h1>"),
      appliedOps: 6,
      totalOps: 6,
    });

    const events = await readEvents(await call());

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.debitCredits).toHaveBeenCalledTimes(1);

    // The point of the migration: what is stored is the CANONICAL document,
    // not the model's raw fill. ensurePageMeta completes the head, and
    // normalizeBornCanonical adds the theme tokens that keep the page
    // themeable — neither ran on this route before.
    const stored = (mocks.set.mock.calls[0][0] as { data: { html: string } }).data.html;
    expect(stored).toMatch(/<meta name="description"/i);
    expect(stored).toContain("--ol-");
    // …and the same document is what the client is handed back, so the
    // editor preview does not drift from the row.
    expect(done?.data.newHtml).toBe(stored);
  });

  it("refuses a fill whose control would be born dead, and stores nothing", async () => {
    mocks.fillTemplate.mockResolvedValue({
      ok: true,
      filledHtml: filled('<h1>Tacos</h1><button data-ol-copy="cupon-fantasma">Copiar</button>'),
      appliedOps: 6,
      totalOps: 6,
    });

    const events = await readEvents(await call());

    const error = events.find((e) => e.event === "error");
    expect(error).toBeDefined();
    // The modal renders `message` verbatim and never reads `kind`, so the
    // reason has to be human Spanish prose, not a slug.
    expect(String(error?.data.message)).toMatch(/cupon-fantasma/);
    expect(String(error?.data.message)).toMatch(/no guardé nada/i);
    // Nothing written, nothing snapshotted, and no charge — the refusal
    // returns before debitCredits even though Gemini already ran.
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === "done")).toBe(false);
  });

  it("keeps reporting a reserved marker under its own kind", async () => {
    mocks.fillTemplate.mockResolvedValue({
      ok: true,
      filledHtml: filled('<section data-slot-path="a">x</section>'),
      appliedOps: 1,
      totalOps: 1,
    });

    const events = await readEvents(await call());

    const error = events.find((e) => e.event === "error");
    // This kind predates the gate and is the string the route's telemetry
    // already used; the migration must not silently retire it.
    expect(error?.data.kind).toBe("editor-marker-leak");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
