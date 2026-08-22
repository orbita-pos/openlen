// Task 3 of the gate/request-surfaces plan — apply-template is one of the
// three "fail closed" surfaces: the user's page already exists, so refusing a
// restyle costs them the restyle, not the page.
//
// The real sanitizeForPublish / normalizeBornCanonical (native Rust binding)
// run here on purpose — they load fine under vitest, and mocking them would
// mock away the ordering this test is meant to pin.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getProject: vi.fn(),
  getTemplateHtml: vi.fn(),
  fillTemplateFromPage: vi.fn(),
  getCreditState: vi.fn(),
  debitCredits: vi.fn(),
  createVersion: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { update: mocks.update },
  schema: { projects: { id: "id", userId: "userId" } },
}));
vi.mock("@/lib/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  debitCredits: mocks.debitCredits,
  AUTOFILL_CREDIT_COST: 2,
}));
vi.mock("@/lib/templates/store", () => ({ getTemplateHtml: mocks.getTemplateHtml }));
vi.mock("@/lib/style-match/autofill/fill-from-page", () => ({
  fillTemplateFromPage: mocks.fillTemplateFromPage,
}));

import { POST } from "./route";

const STORED_HTML =
  '<!doctype html><html lang="es"><head><title>Antes</title></head><body><h1>Antes</h1></body></html>';
const CLEAN_RESTYLE =
  '<!doctype html><html lang="es"><head><title>Después</title></head><body><h1>Después</h1></body></html>';
// A lightbox marker whose required <img> is missing — validateBehaviors flags
// it, and the runtime would bake a control that opens nothing.
const BROKEN_BEHAVIOR_RESTYLE =
  '<!doctype html><html lang="es"><head><title>Después</title></head><body><a data-ol-lightbox href="https://images.openlen.com/x.jpg">sin img</a></body></html>';

function call(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/projects/p1/apply-template", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );
}

describe("POST /api/projects/[id]/apply-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.getProject.mockResolvedValue({ data: { html: STORED_HTML } });
    mocks.getTemplateHtml.mockResolvedValue("<html><body>plantilla</body></html>");
    mocks.getCreditState.mockResolvedValue({ balance: 10 });
    mocks.createVersion.mockResolvedValue(undefined);
    mocks.debitCredits.mockResolvedValue(undefined);
    mocks.where.mockResolvedValue(undefined);
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.update.mockReturnValue({ set: mocks.set });
  });

  it("stores the restyle and charges when the document passes the gate", async () => {
    mocks.fillTemplateFromPage.mockResolvedValue({ ok: true, html: CLEAN_RESTYLE, appliedOps: 4 });

    const res = await call({ templateId: "mirror" });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.debitCredits).toHaveBeenCalledTimes(1);
  });

  it("refuses a restyle whose behaviours would be born dead, and stores nothing", async () => {
    mocks.fillTemplateFromPage.mockResolvedValue({
      ok: true,
      html: BROKEN_BEHAVIOR_RESTYLE,
      appliedOps: 4,
    });

    const res = await call({ templateId: "mirror" });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "behaviors_invalid", detail: "lightbox" });
    // The page the user already had must be exactly as it was: no write, no
    // version snapshot, and — because Gemini already ran — no charge either.
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  it("keeps the reserved-marker refusal distinct from a sanitization failure", async () => {
    mocks.fillTemplateFromPage.mockResolvedValue({
      ok: true,
      html: '<!doctype html><html lang="es"><head><title>x</title></head><body><section data-slot-path="a">x</section></body></html>',
      appliedOps: 1,
    });

    const res = await call({ templateId: "mirror" });

    expect(res.status).toBe(422);
    // Collapsing this into a generic failure is the one thing the plan's
    // ledger names as its structural lesson.
    expect(await res.json()).toMatchObject({ error: "reserved_marker" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
