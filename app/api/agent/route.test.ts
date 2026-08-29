import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCreditState: vi.fn(),
  noCreditsMessage: vi.fn(),
  runAgentLoop: vi.fn(),
  runAgentTool: vi.fn(),
  debitCredits: vi.fn(),
  creditsForUsage: vi.fn(),
  loadProject: vi.fn(),
  loadBusinessProfile: vi.fn(),
  getUserMemory: vi.fn(),
  listVersions: vi.fn(),
  verifyCapsule: vi.fn(),
  verifyEditedPage: vi.fn(),
  buildFunctionDeclarations: vi.fn(() => []),
  buildAgentMessages: vi.fn(() => ({
    ok: true as const,
    messages: [{ role: "user", content: "cambia el título" }],
  })),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  noCreditsMessage: mocks.noCreditsMessage,
  debitCredits: mocks.debitCredits,
  creditsForUsage: mocks.creditsForUsage,
}));
vi.mock("@/lib/agent/brain", () => ({
  createAgentBrain: () => ({ modelId: "test", creditRate: () => "deepseek-flash" }),
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
vi.mock("@/lib/agent/catalog", () => ({
  buildFunctionDeclarations: mocks.buildFunctionDeclarations,
}));
vi.mock("@/lib/agent/context", () => ({
  buildAgentMessages: mocks.buildAgentMessages,
}));
vi.mock("@/lib/agent/user-memory", () => ({ getUserMemory: mocks.getUserMemory }));
vi.mock("@/lib/projects/versions", () => ({ listVersions: mocks.listVersions }));
vi.mock("@/lib/collections/catalog-block", () => ({ collectionCatalogBlock: () => "" }));
vi.mock("@/lib/collections/store", () => ({ listPublishedItems: vi.fn() }));
vi.mock("@/lib/projects/model-runtime", () => ({ verifyCapsule: mocks.verifyCapsule }));
vi.mock("@/lib/agent/loop", () => ({ runAgentLoop: mocks.runAgentLoop }));
vi.mock("@/lib/agent/retry", () => ({ streamWithRetry: vi.fn() }));
vi.mock("@/lib/agent/tools", () => ({
  realDeps: () => ({
    loadProject: mocks.loadProject,
    loadBusinessProfile: mocks.loadBusinessProfile,
  }),
  runAgentTool: mocks.runAgentTool,
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
    vi.stubEnv("OPENLEN_MODEL_JS", "0");
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

  // RETIRADA el 2026-08-26 con el interruptor. Vigilaba que las tres
  // superficies —prompt, catálogo y sesión— recibieran LA MISMA capacidad,
  // porque cada una leía el interruptor por su cuenta y ése fue el hallazgo 1.
  // Ya no hay capacidad que repartir: el modelo siempre puede escribir el
  // JavaScript de su página, así que no queda nada en lo que discrepar.
  it("un slug inválido devuelve 404 antes de construir prompt o autoridad de Home", async () => {
    const res = await POST(new Request("http://localhost/api/agent", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", page: "no-existe", prompt: "edita esto" }),
    }));
    expect(res.status).toBe(404);
    expect(mocks.buildAgentMessages).not.toHaveBeenCalled();
    expect(mocks.runAgentTool).not.toHaveBeenCalled();
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
    vi.stubEnv("OPENLEN_MODEL_JS", "1");
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "owner@example.com" } });
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: { html: `<!doctype html><html><body><h1>Hola</h1><script>${RUNTIME_NUEVO}</script></body></html>` },
    });
    mocks.loadBusinessProfile.mockResolvedValue(null);
    mocks.getUserMemory.mockResolvedValue(null);
    mocks.listVersions.mockResolvedValue([]);
    mocks.getCreditState.mockResolvedValue({ plan: "free", balance: 50, allotment: 20, refillsAt: null });
    // El runtime que los ojos verán sale del HTML que la re-lectura devuelva.
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], fallback: false });
  });

  it("verifica con el runtime RECIÉN GUARDADO, no con el del principio del turno", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,

      data: { html: `<!doctype html><html><body><h1>Hola</h1><script>${RUNTIME_NUEVO}</script></body></html>` },
    });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    expect(mocks.verifyEditedPage.mock.calls[0]![0].runtime).toBe(RUNTIME_NUEVO);
  });

  /**
   * Y DE LA PÁGINA QUE EL TURNO EDITÓ. La re-lectura existía para no verificar
   * contra el script VIEJO; leía siempre `generatedRuntime` + `data.html`, así
   * que en un turno sobre /menu cometía la misma falta por el otro eje —
   * aprobar el trabajo mirando OTRA página. El comentario de esa función ya
   * decía «en vez de verificado contra otra página»; sólo faltaba cumplirlo.
   */
  it("y la relee de la PÁGINA que el turno editó, no de la Home", async () => {
    const verifyTurn = await capturarVerifyTurn();
    const JS_MENU = "window.__DEL_MENU__=1";
    const JS_HOME = "window.__DE_LA_PORTADA__=1";
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: {
        html: `<!doctype html><html><body><h1>Portada</h1><script>${JS_HOME}</script></body></html>`,
        pages: {
          menu: { html: `<!doctype html><html><body><h1>Menu</h1><script>${JS_MENU}</script></body></html>` },
        },
      },
    });

    await verifyTurn({ html: "<h1>Menu</h1>", page: "menu" });

    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    const { runtime } = mocks.verifyEditedPage.mock.calls[0]![0];
    expect(runtime, "los ojos miraban el script de la portada").toBe(JS_MENU);
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
        data: { html: `<!doctype html><html><body><h1>Hola</h1><script>${RUNTIME_NUEVO}</script></body></html>` },
      });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    expect(mocks.verifyEditedPage.mock.calls[0]![0].runtime).toBe(RUNTIME_NUEVO);
  });

  it("la ruta entrega a verifyEditedPage la spec final de A→B, nunca la anterior", async () => {
    const SPEC_A = [{ clic: "#a", veces: 1, entonces: [{ donde: "#ra", que: "cambia" }] }];
    const SPEC_B = [{ clic: "#b", veces: 1, entonces: [{ donde: "#rb", que: "cambia" }] }];
    mocks.runAgentTool.mockImplementation(async (session: { behaviorSpec?: unknown }, _deps: unknown, _name: string, args: { prueba?: unknown }) => {
      session.behaviorSpec = args.prueba ?? null;
      return { response: { ok: true }, updatedHtml: "<h1>Hola</h1>", page: null };
    });
    mocks.runAgentLoop.mockImplementation(async (args: Record<string, unknown>) => {
      const runTool = args.runTool as (name: string, input: Record<string, unknown>) => Promise<unknown>;
      const verifyTurn = args.verifyTurn as (input: { html: string; page: null }) => Promise<unknown>;
      await runTool("editar_pagina", { prueba: SPEC_A });
      await runTool("editar_pagina", { prueba: SPEC_B });
      await verifyTurn({ html: "<h1>Hola</h1>", page: null });
      return { turns: 2, toolCalls: 2, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, terminalError: false };
    });

    await readEvents(
      await POST(
        new Request("http://localhost/api/agent", {
          method: "POST",
          body: JSON.stringify({ projectId: "p1", prompt: "cambia A por B" }),
        }),
      ),
    );

    expect(mocks.runAgentTool).toHaveBeenCalledTimes(2);
    expect(mocks.verifyEditedPage).toHaveBeenCalledOnce();
    expect(mocks.verifyEditedPage.mock.calls[0]![0].spec).toEqual(SPEC_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HALLAZGO 4B — un turno que ya mutó no puede terminar como fallo puro.
//
// El cliente no puede saberlo solo: un cambio de AJUSTES es igual de durable y
// no emite `html`. Así que la ruta lo dice en el terminal, y lo dice TAMBIÉN
// cuando el bucle revienta (ahí `result` ni existe).
describe("POST /api/agent — la mutación durable viaja en el terminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_AGENT", "1");
    mocks.auth.mockResolvedValue({ user: { id: "u1", email: "owner@example.com" } });
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: { html: "<html><body><h1>hola</h1></body></html>" },
    });
    mocks.loadBusinessProfile.mockResolvedValue(null);
    mocks.getUserMemory.mockResolvedValue(null);
    mocks.listVersions.mockResolvedValue([]);
    mocks.getCreditState.mockResolvedValue({ balance: 100 });
  });

  const pedir = () =>
    POST(
      new Request("http://localhost/api/agent", {
        method: "POST",
        body: JSON.stringify({ projectId: "p1", prompt: "cámbiame el titular" }),
      }),
    );

  it("un turno terminal QUE MUTÓ cierra con done + mutoDurable", async () => {
    mocks.runAgentLoop.mockResolvedValue({
      finalText: "", turns: 1, toolCalls: 1,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      terminalError: true,
      mutoDurable: true,
    });

    const events = await readEvents(await pedir());
    const done = events.find((e) => e.event === "done");

    expect(done, "sin `done` el cliente se queda con el rojo").toBeDefined();
    expect(done!.data.mutoDurable).toBe(true);
    // La regla de facturación (Jesús, 2026-07-07) NO cambia aquí: terminal = 0.
    expect(mocks.debitCredits).not.toHaveBeenCalled();
  });

  // DECISIÓN de Jesús (2026-08-25): medir el cargo perdido antes de tocar la
  // regla. El diario decía QUE se regalaba algo pero no CUÁNTO, así que se
  // podían contar los casos y no sumarlos — y la pregunta es de dinero, no de
  // frecuencia. Esta prueba sujeta el instrumento: si alguien saca el importe
  // de la línea, la medición se queda muda y nadie se entera hasta el mes que
  // viene.
  it("y el diario dice CUÁNTO se regaló, no sólo que se regaló", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mocks.creditsForUsage.mockReturnValue(37);
      mocks.runAgentLoop.mockResolvedValue({
        finalText: "", turns: 1, toolCalls: 1,
        usage: { inputTokens: 900_000, outputTokens: 300_000, cachedTokens: 0 },
        terminalError: true,
        mutoDurable: true,
      });

      await readEvents(await pedir());

      const linea = log.mock.calls
        .map((c) => String(c[0]))
        .find((l) => l.includes("cargo perdido"));
      expect(linea, "sin esta línea no hay nada que medir").toBeDefined();
      // El importe, y que sea el de VERDAD: un turno de 1,2M de tokens no puede
      // registrarse como el mínimo de 1 crédito.
      const n = Number(/cargo perdido de (\d+)/.exec(linea!)?.[1]);
      expect(n, "el diario no lleva el importe").toBeGreaterThan(1);
    } finally {
      log.mockRestore();
    }
  });

  it("si el BUCLE revienta y ya había mutado, igual cierra con done", async () => {
    mocks.runAgentLoop.mockImplementation(async (args: Record<string, unknown>) => {
      (args.onMutacion as () => void)();
      throw new Error("Gemini se cayó");
    });

    const events = await readEvents(await pedir());

    // El error se dice —hay que decir por qué— pero el terminal cierra el turno
    // como aplicado-con-aviso en vez de dejar un rojo sobre una página cambiada.
    expect(events.some((e) => e.event === "error")).toBe(true);
    const done = events.find((e) => e.event === "done");
    expect(done, "el bucle reventó tras mutar y no hubo terminal").toBeDefined();
    expect(done!.data.mutoDurable).toBe(true);
  });

  // ── CONTRA-PRUEBAS ────────────────────────────────────────────────────────
  it("CONTRA-PRUEBA: un terminal SIN mutación no lleva la bandera", async () => {
    mocks.runAgentLoop.mockResolvedValue({
      finalText: "", turns: 1, toolCalls: 1,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      terminalError: true,
      mutoDurable: false,
    });

    const events = await readEvents(await pedir());
    const done = events.find((e) => e.event === "done");

    expect(done).toBeDefined();
    expect("mutoDurable" in done!.data).toBe(false);
  });

  it("CONTRA-PRUEBA: si el bucle revienta SIN haber mutado, no hay done", async () => {
    mocks.runAgentLoop.mockRejectedValue(new Error("Gemini se cayó"));

    const events = await readEvents(await pedir());

    expect(events.some((e) => e.event === "error")).toBe(true);
    expect(events.some((e) => e.event === "done")).toBe(false);
  });
});

/**
 * DE QUÉ PÁGINA ES EL JAVASCRIPT QUE EL AGENTE VE Y VERIFICA.
 *
 * Los dos sitios leían siempre `generatedRuntime` + `data.html` — el documento
 * raíz—, hicieras lo que hicieras. Trabajando en /menu eso significa que Len ve
 * el JavaScript de la PORTADA como si fuera el de la página que tiene delante
 * (peor que no ver nada: le da algo ajeno que "arreglar") y que sus ojos
 * aprueban el turno mirando otro documento.
 *
 * Se afirma sobre lo que recibe `verifyCapsule` —la cápsula y el HTML— porque
 * es el único sitio donde la elección se ve; el resultado lo decide el mock.
 */
// RETIRADO con la cápsula. Clavaba que Len viera el JavaScript de la página
// ACTIVA y no el de la portada — un fallo real. Ahora el script viaja dentro
// del documento que el modelo recibe, así que no hay forma de darle el de
// otra página: sería darle otro documento.

