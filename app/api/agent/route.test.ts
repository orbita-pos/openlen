import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCreditState: vi.fn(),
  noCreditsMessage: vi.fn(),
  runAgentLoop: vi.fn(),
  loadProject: vi.fn(),
  loadBusinessProfile: vi.fn(),
  getUserMemory: vi.fn(),
  listVersions: vi.fn(),
  modelJsEnabled: vi.fn(),
  verifyCapsule: vi.fn(),
  verifyEditedPage: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  noCreditsMessage: mocks.noCreditsMessage,
  debitCredits: vi.fn(),
  creditsForUsage: vi.fn(),
}));
vi.mock("@/lib/agent/brain", () => ({
  createAgentBrain: () => ({ modelId: "test", creditRate: () => "deepseek-flash" }),
}));
vi.mock("@/lib/ai-provider", () => ({
  resolveAIProvider: () => ({ key: "test-key" }),
}));
vi.mock("@/lib/ai/turn-credentials", () => ({
  credencialDelTurno: () => ({ value: "test-key" }),
  faltaCredencial: () => null,
}));
vi.mock("@/lib/html-ops", () => ({
  resolveOpIdByPath: () => null,
  stripOpIds: (html: string) => html,
  tagWithOpIds: (html: string) => ({ taggedHtml: html, taggedCount: 1 }),
}));
vi.mock("@/lib/ai/inline-image", () => ({ fetchImageAsInlineData: vi.fn() }));
vi.mock("@/lib/style-match/scrape/validate-url", () => ({
  validateUrl: vi.fn(),
}));
vi.mock("@/lib/agent/catalog", () => ({ buildFunctionDeclarations: () => [] }));
vi.mock("@/lib/agent/context", () => ({
  buildAgentMessages: () => ({
    ok: true,
    messages: [{ role: "user", content: "cambia el título" }],
  }),
}));
vi.mock("@/lib/agent/user-memory", () => ({ getUserMemory: mocks.getUserMemory }));
vi.mock("@/lib/projects/versions", () => ({ listVersions: mocks.listVersions }));
vi.mock("@/lib/collections/catalog-block", () => ({ collectionCatalogBlock: () => "" }));
vi.mock("@/lib/collections/store", () => ({ listPublishedItems: vi.fn() }));
vi.mock("@/lib/ai-stream/model-runtime", () => ({ modelJsEnabled: mocks.modelJsEnabled }));
vi.mock("@/lib/projects/model-runtime", () => ({ verifyCapsule: mocks.verifyCapsule }));
vi.mock("@/lib/agent/loop", () => ({ runAgentLoop: mocks.runAgentLoop }));
vi.mock("@/lib/agent/retry", () => ({ streamWithRetry: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({
  realDeps: () => ({
    loadProject: mocks.loadProject,
    loadBusinessProfile: mocks.loadBusinessProfile,
  }),
  runAgentTool: vi.fn(),
  summarizeProjectState: () => ({}),
}));
vi.mock("@/lib/agent/business", () => ({ summarizeBusinessForAgent: () => null }));
vi.mock("@/lib/agent/verify", () => ({ verifyEditedPage: mocks.verifyEditedPage }));

import { POST } from "./route";

async function readEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("event:"))
    .map((chunk) => ({
      event: /^event: (.+)$/m.exec(chunk)?.[1] ?? "",
      data: JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}") as Record<string, unknown>,
    }));
}

describe("POST /api/agent credit gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_AGENT", "1");
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "owner@example.com" } });
    mocks.loadProject.mockResolvedValue({
      title: "Página",
      subdomain: null,
      publishedAt: null,
      userBrief: "",
      brief: null,
      generatedRuntime: null,
      data: { html: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
    });
    mocks.loadBusinessProfile.mockResolvedValue(null);
    mocks.getUserMemory.mockResolvedValue(null);
    mocks.listVersions.mockResolvedValue([]);
    mocks.noCreditsMessage.mockReturnValue("MENSAJE-COMPARTIDO-AGENTE");
  });

  it("sin créditos usa la misma puerta y no inicia el bucle del Agente", async () => {
    const creditState = {
      plan: "free",
      balance: 0,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    };
    mocks.getCreditState.mockResolvedValue(creditState);

    const res = await POST(
      new Request("http://localhost/api/agent", {
        method: "POST",
        body: JSON.stringify({ projectId: "p1", prompt: "cambia el título" }),
      }),
    );

    expect(await readEvents(res)).toEqual([
      {
        event: "error",
        data: {
          message: "MENSAJE-COMPARTIDO-AGENTE",
          code: "no_credits",
          // La fecha sale como DATO: sin ella el cliente no puede decirla
          // en el idioma de quien lee (ver lib/credits-client.test.ts).
          refillsAt: "2026-09-23T12:00:00.000Z",
        },
      },
    ]);
    expect(mocks.noCreditsMessage).toHaveBeenCalledWith(creditState, "existing");
    expect(mocks.runAgentLoop).not.toHaveBeenCalled();
  });
});

// 🔴 LOS OJOS NO PUEDEN APROBAR EL SCRIPT NUEVO MIRANDO EL VIEJO (hallazgo 6).
//
// `verifyTurn` re-lee de la base lo que se acaba de guardar, precisamente
// porque `runtimeCode` se calcula ANTES del turno: en el turno donde el modelo
// ESCRIBE el JavaScript, ese valor es el de antes. Pero la re-lectura tenía un
// `.catch(() => null)` que caía a `runtimeCode` — o sea que un fallo de lectura
// reintroducía el fallo entero, y en silencio.
describe("POST /api/agent — los ojos y lo que se guardó", () => {
  const RUNTIME_VIEJO = "window.viejo=1";
  const RUNTIME_NUEVO = "window.nuevo=1";

  /** Arranca un turno y devuelve el `verifyTurn` que la ruta le pasó al bucle. */
  async function capturarVerifyTurn() {
    let capturado: ((a: { html: string; page: string | null }) => Promise<unknown>) | null = null;
    mocks.runAgentLoop.mockImplementation(async (args: Record<string, unknown>) => {
      capturado = args.verifyTurn as typeof capturado;
      return { turns: 1, toolCalls: 0, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, terminalError: false };
    });
    await readEvents(
      await POST(
        new Request("http://localhost/api/agent", {
          method: "POST",
          body: JSON.stringify({ projectId: "p1", prompt: "ponle un contador" }),
        }),
      ),
    );
    expect(capturado).toBeTypeOf("function");
    return capturado!;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_AGENT", "1");
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "owner@example.com" } });
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      generatedRuntime: "capsula-vieja",
      data: { html: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
    });
    mocks.loadBusinessProfile.mockResolvedValue(null);
    mocks.getUserMemory.mockResolvedValue(null);
    mocks.listVersions.mockResolvedValue([]);
    mocks.getCreditState.mockResolvedValue({ plan: "free", balance: 50, allotment: 20, refillsAt: null });
    mocks.modelJsEnabled.mockReturnValue(true);
    mocks.verifyCapsule.mockReturnValue({ ok: true, code: RUNTIME_NUEVO });
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], fallback: false });
  });

  it("verifica con el runtime RECIÉN GUARDADO, no con el del principio del turno", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      generatedRuntime: "capsula-nueva",
      data: { html: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
    });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    expect(mocks.verifyEditedPage.mock.calls[0]![0].runtime).toBe(RUNTIME_NUEVO);
  });

  it("si NO se puede releer lo guardado, el turno queda SIN verificar — nunca contra el viejo", async () => {
    const verifyTurn = await capturarVerifyTurn();
    // Los dos intentos fallan: no hay forma de saber qué se guardó.
    mocks.loadProject.mockRejectedValue(new Error("la base no contesta"));

    await expect(verifyTurn({ html: "<h1>Hola</h1>", page: null })).resolves.toEqual({ ok: true });
    // Lo que importa: NO se verificó nada. Antes se llamaba con RUNTIME_VIEJO
    // y un script nuevo y roto salía aprobado.
    expect(mocks.verifyEditedPage).not.toHaveBeenCalled();
    expect(RUNTIME_VIEJO).not.toBe(RUNTIME_NUEVO);
  });

  it("reintenta una vez antes de rendirse — un fallo suelto no cuesta la verificación", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce({
        title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
        generatedRuntime: "capsula-nueva",
        data: { html: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
      });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    expect(mocks.verifyEditedPage.mock.calls[0]![0].runtime).toBe(RUNTIME_NUEVO);
  });
});
