// Task 3 of the gate/request-surfaces plan — ai-design (the Chat tab) is the
// third "fail closed" surface. The page already exists, so refusing an edit
// costs the user the edit, not the page.
//
// The real sanitizeForPublish / normalizeBornCanonical / validateBehaviors run
// here on purpose; only the model, the DB, auth and credits are mocked.
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
  estimateCredits: vi.fn(),
  creditsForUsage: vi.fn(),
  resolveAIProvider: vi.fn(),
  stream: vi.fn(),
  fireworksStream: vi.fn(),
  renderReference: vi.fn(async (): Promise<{ mimeType: string; dataBase64: string } | null> => null),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  schema: { projects: { id: "id", userId: "userId", data: "data", userBrief: "userBrief" } },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  debitCredits: mocks.debitCredits,
  estimateCredits: mocks.estimateCredits,
  creditsForUsage: mocks.creditsForUsage,
}));
vi.mock("@/lib/ai-provider", () => ({
  resolveAIProvider: mocks.resolveAIProvider,
}));
vi.mock("@/lib/ai-gateway", () => ({
  GeminiProvider: class {
    stream(...args: unknown[]) {
      return mocks.stream(...args);
    }
  },
}));
vi.mock("@/lib/ai/fireworks-stream-client", () => ({
  createFireworksStreamClient: () => ({ modelId: "deepseek", stream: mocks.fireworksStream }),
}));
vi.mock("@/lib/ai/inline-image", () => ({
  renderHtmlToInlineImage: mocks.renderReference,
}));

import { POST } from "./route";
import { MARKER } from "./system-prompt";

const FILLER = "<p>Contenido real de la página para que el documento no parezca truncado.</p>".repeat(20);
const CURRENT_HTML = `<!doctype html><html lang="es"><head><title>Mi página</title></head><body><h1>Hola</h1>${FILLER}</body></html>`;

function rewrite(bodyInner: string): string {
  return `<!doctype html><html lang="es"><head><title>Mi página</title></head><body>${bodyInner}${FILLER}</body></html>`;
}

function modelSays(html: string) {
  return (async function* () {
    yield { type: "text_delta" as const, text: `Rediseño la página.\n${MARKER}\n${html}` };
    yield { type: "usage" as const, inputTokens: 1000, outputTokens: 1000 };
    yield { type: "done" as const, stopReason: { kind: "end_turn" as const } };
  })();
}

async function readEvents(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

function call(): Promise<Response> {
  return POST(
    new Request("http://localhost/api/templates/ai-design", {
      method: "POST",
      body: JSON.stringify({
        projectId: "p1",
        currentHtml: CURRENT_HTML,
        prompt: "ponle un botón para copiar el cupón",
      }),
    }),
  );
}

describe("POST /api/templates/ai-design", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.select.mockReturnValue({
      from: () => ({
        where: () => ({ limit: async () => [{ data: { html: CURRENT_HTML }, userBrief: "" }] }),
      }),
    });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.createVersion.mockResolvedValue(undefined);
    mocks.getCreditState.mockResolvedValue({ balance: 100 });
    mocks.estimateCredits.mockReturnValue(1);
    mocks.creditsForUsage.mockReturnValue(1);
    mocks.debitCredits.mockResolvedValue(undefined);
    mocks.resolveAIProvider.mockReturnValue({
      key: "test-key",
      label: "Gemini",
      model: "gemini-flash",
      rate: 1,
    });
    mocks.renderReference.mockResolvedValue(null);
    delete process.env.OPENLEN_CHAT_PROVIDER;
    delete process.env.OPENLEN_AIDESIGN_PAGE_REFERENCE;
  });

  it("saves a redesign whose behaviours are wired correctly", async () => {
    mocks.fireworksStream.mockReturnValue(
      modelSays(
        rewrite('<h1>Hola</h1><code id="cupon">TACOS20</code><button data-ol-copy="cupon" aria-label="Copiar">Copiar</button>'),
      ),
    );

    const events = await readEvents(await call());

    expect(events.some((e) => e.event === "error")).toBe(false);
    expect(events.some((e) => e.event === "done")).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("refuses a redesign whose control would be born dead, and stores nothing", async () => {
    // data-ol-copy pointing at an id that does not exist: OpenLen would bake a
    // button that copies nothing.
    mocks.fireworksStream.mockReturnValue(
      modelSays(rewrite('<h1>Hola</h1><button data-ol-copy="cupon-fantasma">Copiar</button>')),
    );

    const events = await readEvents(await call());

    const error = events.find((e) => e.event === "error");
    expect(error).toBeDefined();
    // The reason has to reach the person reading the chat as prose, not as a
    // machine slug.
    expect(String(error?.data.message)).toMatch(/cupon-fantasma/);
    expect(String(error?.data.message)).toMatch(/no guardé nada/i);
    // The page the user already had is untouched, and no version is written.
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createVersion).not.toHaveBeenCalled();
    expect(events.some((e) => e.event === "done")).toBe(false);
  });

  it("edita con DeepSeek sin que nadie tenga que encenderlo", async () => {
    // Medido sobre 6 turnos reales: primer byte de 1.0-2.4s contra 3.8-84.7s,
    // 6 de 6 turnos completados contra 4 de 6.
    mocks.fireworksStream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
    await readEvents(await call());
    expect(mocks.fireworksStream).toHaveBeenCalledTimes(1);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.fireworksStream.mock.calls[0][0]).toMatchObject({ operation: "page_edit" });
  });

  it("con OPENLEN_CHAT_PROVIDER=gemini vuelve el camino de antes", async () => {
    process.env.OPENLEN_CHAT_PROVIDER = "gemini";
    mocks.stream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
    await readEvents(await call());
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.fireworksStream).not.toHaveBeenCalled();
  });

  it("un turno con imagen de referencia se queda en Gemini pase lo que pase", async () => {
    // En la política de Fireworks toda imagen va a Qwen y al razonador nunca se
    // le ha mandado una: mandarla a ciegas apuesta la edición del usuario.
    process.env.OPENLEN_AIDESIGN_PAGE_REFERENCE = "1";
    mocks.renderReference.mockResolvedValue({ mimeType: "image/jpeg", dataBase64: "AQID" });
    mocks.stream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
    await readEvents(await call());
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.fireworksStream).not.toHaveBeenCalled();
  });

  it("fija el presupuesto de pensamiento, que es de donde salen los minutos de espera", async () => {
    // Medido sobre una página real de 40KB: sin fijarlo, 3,251 tokens de
    // pensamiento para producir 208 de edición y 20.3s hasta el primer byte.
    process.env.OPENLEN_CHAT_PROVIDER = "gemini";
    mocks.stream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
    await readEvents(await call());
    expect(mocks.stream.mock.calls[0][0]).toMatchObject({ thinkingBudget: 1024 });
  });

  it("con `auto` vuelve al presupuesto dinámico de antes", async () => {
    const previous = process.env.OPENLEN_AIDESIGN_THINKING;
    process.env.OPENLEN_AIDESIGN_THINKING = "auto";
    process.env.OPENLEN_CHAT_PROVIDER = "gemini";
    try {
      mocks.stream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
      await readEvents(await call());
      expect((mocks.stream.mock.calls[0][0] as { thinkingBudget?: number }).thinkingBudget).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.OPENLEN_AIDESIGN_THINKING;
      else process.env.OPENLEN_AIDESIGN_THINKING = previous;
    }
  });
});
