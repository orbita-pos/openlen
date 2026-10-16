import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  chargeCredits: vi.fn(async () => 600),
  getCreditState: vi.fn(),
  cabeEnElTope: vi.fn(async () => true),
  sumarGasto: vi.fn(async () => undefined),
  editImage: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
vi.mock("@/lib/projects/miembros", () => ({ cabeEnElTope: mocks.cabeEnElTope, sumarGasto: mocks.sumarGasto }));
vi.mock("@/lib/credits", () => ({
  AI_IMAGE_EDIT_CREDIT_COST: 600,
  chargeCredits: mocks.chargeCredits,
  getCreditState: mocks.getCreditState,
}));
vi.mock("@/lib/ai/image-edit-core", () => ({
  OPENAI_IMAGE_EDIT_MODEL_ID: "gpt-image-2",
  editImage: mocks.editImage,
  realImageEditTransport: () => async () => ({}),
}));

import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";

import { POST } from "./route";

const call = () =>
  POST(
    new Request("http://localhost/api/projects/p1/ai-edit-image", {
      method: "POST",
      body: JSON.stringify({ imageBase64: "aGVsbG8=", mimeType: "image/png", prompt: "fondo blanco" }),
    }),
    { params: Promise.resolve({ id: "p1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCreditState.mockResolvedValue({ balance: 5_000 });
  // The core charges on success through the `debit` the route hands it.
  mocks.editImage.mockImplementation(async (_input: unknown, deps: { debit: (cost: number) => Promise<void> }) => {
    await deps.debit(600);
    return { imageBase64: "b3V0", mimeType: "image/png", cost: 600 };
  });
});
afterEach(() => fijarAccesoDePrueba(null));

describe("POST /api/projects/[id]/ai-edit-image", () => {
  it("ledger: an editor image edit writes an image_edit row for the owner", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    expect((await call()).status).toBe(200);
    expect(mocks.chargeCredits).toHaveBeenCalledWith("u1", 600, {
      surface: "image_edit",
      outcome: "ok",
      projectId: "p1",
      actorId: null,
      listCenticredits: 600,
      uses: [{ provider: "openai", model: "gpt-image-2", images: 1 }],
    });
  });

  it("ledger: a member's edit is the owner's row and names the member", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "ana" } });
    fijarAccesoDePrueba((_p, u) => (u === "ana" ? { rol: "editor", duenoId: "dueno-1" } : null));
    expect((await call()).status).toBe(200);
    expect(mocks.chargeCredits).toHaveBeenCalledWith("dueno-1", 600, expect.objectContaining({ surface: "image_edit", actorId: "ana" }));
    expect(mocks.sumarGasto).toHaveBeenCalledWith("p1", "ana", 600);
  });
});
