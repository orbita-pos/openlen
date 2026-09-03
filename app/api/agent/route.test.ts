import { beforeEach, describe, expect, it, vi } from "vitest";

// El tipo REAL de los ojos, no una copia a mano. Aquí vivía la firma escrita
// dos veces —`{ html, page }`— y al añadirle `soloDeterminista` al bucle esta
// copia se quedó atrás: el test llamaba con un campo que su propio tipo no
// conocía. Es `import type`, así que se borra al compilar y no despierta al
// módulo mockeado.
import type { AgentLoopArgs } from "@/lib/agent/loop";

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
  getUserMemoryBounded: vi.fn(),
  listVersions: vi.fn(),
  verifyCapsule: vi.fn(),
  verifyEditedPage: vi.fn(),
  leerDireccion: vi.fn(() => null as string | null),
  createPool: vi.fn(),
  renderViewports: vi.fn(async () => ({ desktop: "d", mobile: "m" })),
  poolRender: vi.fn(async () => ({ desktop: "pool-d", mobile: "pool-m" })),
  poolClose: vi.fn(async () => {}),
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
vi.mock("@/lib/agent/user-memory", () => ({ getUserMemoryBounded: mocks.getUserMemoryBounded }));
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
// `observarPagina` es el ojo de `mirar_pagina`. Aquí devuelve null —«no se pudo
// mirar»— porque ninguna prueba de esta ruta la ejercita: lo que importa es que
// el doble la EXPORTE, o el import de la ruta revienta el módulo entero.
// El almacen de correcciones a media faena. Se dobla para poder DECIDIR que
// lee el bucle: el turno real se abre y se cierra dentro del mismo `POST`, asi
// que con el almacen de verdad no hay ventana para meter nada desde fuera.
vi.mock("@/lib/agent/direcciones", () => ({
  abrirTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  leerDireccion: mocks.leerDireccion,
  MAX_DIRECCION: 2000,
}));
// El renderizador de Chromium. Se dobla para poder CONTAR arranques: el punto
// del pool es que dos verificaciones del mismo turno no abran dos navegadores.
vi.mock("@/lib/ai/visual-quality-renderer", () => ({
  createVisualQualityRendererPool: mocks.createPool,
  renderVisualQualityViewports: mocks.renderViewports,
}));
vi.mock("@/lib/agent/verify", () => ({
  verifyEditedPage: mocks.verifyEditedPage,
  observarPagina: async () => null,
}));

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
    mocks.getUserMemoryBounded.mockResolvedValue(null);
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

    // EL `turno` VA DELANTE, TAMBIÉN AQUÍ. Esta lista era exacta y se quedó
    // atrás el 2026-09-03 (`57c3a011`): desde que se puede corregir el rumbo, la
    // ruta emite el id del turno ANTES de la puerta de créditos, a propósito —
    // «si el turno se muere por cualquier motivo, el taller ya sabe a qué id iba
    // y puede cerrar su caja de texto sin quedarse esperando». La prueba sigue
    // siendo exacta (los DOS eventos, en orden); lo que cambia es que ahora
    // describe la ruta que hay.
    const eventos = await readEvents(res);
    expect(eventos.map((e) => e.event)).toEqual(["turno", "error"]);
    expect(eventos[0]!.data.turnoId).toBeTypeOf("string");
    expect(eventos[1]).toEqual({
      event: "error",
      data: {
        message: "MENSAJE-COMPARTIDO-AGENTE",
        code: "no_credits",
        // La fecha sale como DATO: sin ella el cliente no puede decirla
        // en el idioma de quien lee (ver lib/credits-client.test.ts).
        refillsAt: "2026-09-23T12:00:00.000Z",
      },
    });
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
    let capturado: NonNullable<AgentLoopArgs["verifyTurn"]> | null = null;
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
    mocks.getUserMemoryBounded.mockResolvedValue(null);
    mocks.listVersions.mockResolvedValue([]);
    mocks.getCreditState.mockResolvedValue({ plan: "free", balance: 50, allotment: 20, refillsAt: null });
    // El runtime que los ojos verán sale del HTML que la re-lectura devuelva.
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], observaciones: [], fallback: false });
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

  /**
   * «NO PUDE MIRAR» NO ES «ESTÁ BIEN».
   *
   * Los ojos fallan ABIERTOS por diseño: Chrome caído, sin key, timeout o JSON
   * malformado devuelven un veredicto benigno con `fallback: true`. Eso está
   * bien —una verificación que no arranca no puede tumbar el turno del
   * usuario—. Lo que estaba mal es que esta función lo convertía en el MISMO
   * `ok: true` que una verificación de verdad, así que dentro del producto no
   * quedaba nada que los distinguiera. Con Chromium caído en el box la
   * verificación aprobaba todo en silencio, y sólo el diario lo sabía.
   */
  it("un veredicto de fallback sale como no_mirado, no como visto bueno", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: { html: `<!doctype html><html><body><h1>Hola</h1></body></html>` },
    });
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], observaciones: [], fallback: true });

    const r = await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(r).toEqual({
      estado: "no_mirado",
      motivo: "la verificación visual no pudo correr",
    });
  });

  // EL BRAZO DE CONTROL. El MISMO veredicto benigno, pero mirado de verdad:
  // tiene que salir como visto bueno. Si esto se moviera con el de arriba, el
  // arreglo estaría llamando «no mirado» a todo.
  it("y un veredicto benigno DE VERDAD sigue saliendo como visto bueno", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: { html: `<!doctype html><html><body><h1>Hola</h1></body></html>` },
    });
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], observaciones: [], fallback: false });

    const r = await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(r).toEqual({ estado: "bien" });
  });

  it("y una rotura sale como roto, con la crítica", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      title: "Página", subdomain: null, publishedAt: null, userBrief: "", brief: null,
      data: { html: `<!doctype html><html><body><h1>Hola</h1></body></html>` },
    });
    mocks.verifyEditedPage.mockResolvedValue({
      broken: true,
      issues: ["el hero quedó con texto encimado"],
      observaciones: [],
      fallback: false,
    });

    const r = await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    expect(r).toEqual({
      estado: "roto",
      critique: "- el hero quedó con texto encimado",
      // LA CUENTA, desde el 2026-09-01. Es lo que deja al bucle decir si la
      // segunda pasada BAJÓ el número: sin ella, «lo arreglé» y «lo dejé
      // igual» llegan idénticos.
      problemas: 1,
    });
  });

  // La segunda pasada — la que comprueba si el arreglo arregló — se pide con
  // `soloDeterminista` y NO gasta una llamada con visión. La ruta tiene que
  // pasar la bandera: si se queda por el camino, la segunda vuelve a pagar el
  // crítico y el ahorro que la justifica desaparece sin que nada falle.
  it("la segunda pasada viaja como determinista hasta verifyEditedPage", async () => {
    const verifyTurn = await capturarVerifyTurn();
    mocks.loadProject.mockResolvedValue({
      data: { html: `<!doctype html><html><body><h1>Hola</h1></body></html>` },
    });
    mocks.verifyEditedPage.mockResolvedValue({ broken: false, issues: [], observaciones: [], fallback: false });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null, soloDeterminista: true });
    expect(mocks.verifyEditedPage.mock.calls.at(-1)![0]).toMatchObject({
      soloDeterminista: true,
    });

    await verifyTurn({ html: "<h1>Hola</h1>", page: null });
    expect(mocks.verifyEditedPage.mock.calls.at(-1)![0]).not.toHaveProperty("soloDeterminista");
  });

  it("si NO se puede releer lo guardado, el turno queda SIN verificar — nunca contra el viejo", async () => {
    const verifyTurn = await capturarVerifyTurn();
    // Los dos intentos fallan: no hay forma de saber qué se guardó.
    mocks.loadProject.mockRejectedValue(new Error("la base no contesta"));

    // 🔴 Y LO DICE. Esta línea afirmaba `{ ok: true }` — el visto bueno — en la
    // prueba que se titula «queda SIN verificar»: el nombre decía una cosa y la
    // aserción sujetaba la contraria. Aguas abajo, ese `ok: true` era
    // indistinguible del de una verificación de verdad.
    await expect(verifyTurn({ html: "<h1>Hola</h1>", page: null })).resolves.toEqual({
      estado: "no_mirado",
      motivo: "no se pudo releer el documento guardado",
    });
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

  /**
   * 🔴 EL OBJETIVO SIGUE A LA CORRECCIÓN.
   *
   * MEDIDO EN VIVO el 2026-09-03, con el mecanismo de dirigir recién puesto:
   * el dueño mandó «reescribe la página en brutalista», corrigió a media faena
   * («brutalista no: deja el diseño y cambia sólo el botón»), el Agente
   * obedeció — y los ojos suspendieron la página:
   *
   *   [agent-verify] broken=true issues="El estilo visual no corresponde en
   *   absoluto a lo solicitado: la página mantiene un diseño minimalista … en
   *   lugar del estilo brutalista pedido"
   *
   * La página estaba EXACTAMENTE como el dueño acababa de pedir. El fallo es
   * de entrada: `userPrompt` se fijaba una vez, con el prompt del cuerpo de la
   * petición, y la corrección no lo tocaba. El Agente se salvó DISCUTIENDO con
   * el revisor, o sea con criterio; lo que le tocaba al servidor era el
   * mecanismo. Costó una vuelta y una llamada de visión.
   */
  it("una corrección a media faena entra en el objetivo que ven los ojos", async () => {
    mocks.leerDireccion.mockReturnValueOnce(
      "brutalista no: deja el diseño como estaba y cambia sólo el botón",
    );
    let verifyTurn: NonNullable<AgentLoopArgs["verifyTurn"]> | null = null;
    mocks.runAgentLoop.mockImplementation(async (args: Record<string, unknown>) => {
      // Lo que hace el bucle de verdad: mirarlo ENTRE vueltas.
      (args.leerDireccion as AgentLoopArgs["leerDireccion"])?.();
      verifyTurn = args.verifyTurn as typeof verifyTurn;
      return { turns: 2, toolCalls: 1, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, terminalError: false };
    });

    await readEvents(
      await POST(
        new Request("http://localhost/api/agent", {
          method: "POST",
          body: JSON.stringify({ projectId: "p1", prompt: "reescribe la página en brutalista" }),
        }),
      ),
    );
    await verifyTurn!({ html: "<h1>Hola</h1>", page: null });

    const { userPrompt } = mocks.verifyEditedPage.mock.calls[0]![0] as { userPrompt: string };
    expect(userPrompt, "el pedido original tiene que seguir ahí").toContain(
      "reescribe la página en brutalista",
    );
    expect(userPrompt, "los ojos juzgaban contra el objetivo que el dueño retiró").toContain(
      "brutalista no",
    );
  });

  /** CONTRA-PRUEBA: sin corrección, el objetivo es el prompt y nada más. */
  it("y sin corrección el objetivo no crece", async () => {
    const verifyTurn = await capturarVerifyTurn();
    await verifyTurn({ html: "<h1>Hola</h1>", page: null });

    const { userPrompt } = mocks.verifyEditedPage.mock.calls[0]![0] as { userPrompt: string };
    expect(userPrompt).toBe("ponle un contador");
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
    mocks.getUserMemoryBounded.mockResolvedValue(null);
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

  // ── El corte de la ventana, también al usuario ─────────────────────────────
  //
  // 🔴 Al MODELO ya se le decía (`conversacionRecortada` → la nota del
  // contexto), para que pueda contestar «de eso ya no me acuerdo» en vez de
  // nombrar el turno más viejo que tenga a mano. Al usuario no se le decía nada:
  // veía a Len olvidar y no tenía forma de saber por qué, ni de saber que
  // alargar la misma charla empeora la memoria en vez de mejorarla.
  describe("el corte de la ventana viaja en el done", () => {
    const limpio = {
      finalText: "listo", turns: 1, toolCalls: 1,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      terminalError: false,
    };
    /** Una charla de `total` turnos, de los que viajan `enviados`. */
    const charla = (enviados: number, total: number) =>
      POST(
        new Request("http://localhost/api/agent", {
          method: "POST",
          body: JSON.stringify({
            projectId: "p1",
            prompt: "sigue",
            historyTotal: total,
            history: Array.from({ length: enviados }, (_, i) => ({
              role: "user",
              content: `mensaje ${i}`,
            })),
          }),
        }),
      );

    it("cuando la charla no cabe entera, van los DOS números", async () => {
      mocks.runAgentLoop.mockResolvedValue(limpio);
      const events = await readEvents(await charla(12, 20));
      const done = events.find((e) => e.event === "done")!;
      // Números, no prosa: la frase la compone el cliente en el idioma del
      // usuario. Un booleano «memoria recortada» sería una disculpa; «ve 12 de
      // 20» es algo que el usuario puede USAR.
      expect(done.data.ventana).toEqual({ visibles: 12, totales: 20 });
    });

    it("cuando cabe entera, no se dice nada", async () => {
      mocks.runAgentLoop.mockResolvedValue(limpio);
      const events = await readEvents(await charla(5, 5));
      expect(events.find((e) => e.event === "done")!.data.ventana).toBeUndefined();
    });

    it("🔴 y el modelo y el usuario reciben la MISMA cuenta", async () => {
      mocks.runAgentLoop.mockResolvedValue(limpio);
      const events = await readEvents(await charla(12, 20));
      const done = events.find((e) => e.event === "done")!;
      // `buildAgentMessages` recibe la nota para el modelo; el `done`, la del
      // usuario. Salían de dos expresiones distintas y por eso ahora salen de
      // una sola: dos verdades duplicadas sobre el mismo hecho es exactamente
      // la forma de defecto que este barrido persigue.
      // `buildAgentMessages` es un `vi.fn` sin argumentos declarados, así que
      // sus `calls` vienen tipadas como tupla vacía: se pasa por `unknown`.
      const paraElModelo = (mocks.buildAgentMessages.mock.calls.at(-1) as unknown as [
        { conversacionRecortada?: { visibles: number; totales: number } | null },
      ])[0];
      expect(paraElModelo.conversacionRecortada).toEqual(done.data.ventana);
    });
  });

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

  /**
   * 🔴 UNA CANCELACIÓN NO PUEDE LEERSE COMO UNA AVERÍA.
   *
   * El diario escribía la misma línea para las dos, y el 2026-09-03 eso costó
   * una investigación entera: un turno abortado porque el panel se remontó se
   * persiguió como un fallo de Fireworks, con re-corrida de un documento de
   * 206 KB para descartar el tamaño. El código ya existía dentro del bucle; lo
   * que faltaba era que volviera y se escribiera.
   */
  it("el diario dice POR QUÉ terminó mal: ■ del dueño o caída del proveedor", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const [errorCode, esperado] of [
        ["cancelled", "cancelled"],
        ["upstream", "upstream"],
      ] as const) {
        log.mockClear();
        mocks.runAgentLoop.mockResolvedValue({
          finalText: "", turns: 1, toolCalls: 0,
          usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
          terminalError: true,
          errorCode,
          mutoDurable: false,
        });

        await readEvents(await pedir());

        const linea = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("terminal-error"));
        expect(linea, "la línea del diario desapareció").toBeDefined();
        expect(linea, `no distingue ${errorCode}`).toContain(`motivo=${esperado}`);
      }
    } finally {
      log.mockRestore();
    }
  });

  /** Y el tope tampoco es una avería: es quedarse sin cuerda. */
  it("y un tope se escribe como tope, no como fallo sin nombre", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      mocks.runAgentLoop.mockResolvedValue({
        finalText: "", turns: 12, toolCalls: 20,
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
        terminalError: true,
        errorCode: null,
        topeAlcanzado: "turn_limit",
        mutoDurable: false,
      });

      await readEvents(await pedir());

      const linea = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("terminal-error"));
      expect(linea).toContain("motivo=turn_limit");
    } finally {
      log.mockRestore();
    }
  });

  /**
   * 🔴 UN NAVEGADOR POR TURNO, NO POR MIRADA.
   *
   * MEDIDO el 2026-09-03 sobre una plantilla real de 59,6 KB: abrir Chromium y
   * medir cuesta **4,80 s**; medir con el navegador YA abierto, **2,16 s**. El
   * arranque son ~2,6 s y se pagaba entero en CADA mirada — las dos
   * verificaciones del turno y cada `mirar_pagina` del modelo.
   *
   * El pool existía (`createVisualQualityRendererPool`) y sólo lo usaba la hoja
   * de contactos de plantillas. Aquí se comparte uno por REQUEST — no por
   * proceso: un Chromium residente en una caja de 4 GB que además lleva Postgres
   * es una decisión de infraestructura, y ésta no lo es.
   *
   * El doble de los ojos LLAMA al medidor, como hace el de verdad; si no, el
   * pool nunca se crearía y la prueba pasaría sin probar nada.
   */
  async function turnoConDosMiradas() {
    mocks.verifyEditedPage.mockImplementation(
      async (_params: unknown, internals?: { medir?: (h: string) => Promise<unknown> }) => {
        await internals?.medir?.("<h1>Hola</h1>");
        return { broken: false, issues: [], observaciones: [], fallback: false };
      },
    );
    mocks.runAgentLoop.mockImplementation(async (args: Record<string, unknown>) => {
      const verifyTurn = args.verifyTurn as (i: { html: string; page: string | null }) => Promise<unknown>;
      await verifyTurn({ html: "<h1>Hola</h1>", page: null });
      await verifyTurn({ html: "<h1>Hola</h1>", page: null });
      return { turns: 2, toolCalls: 2, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, terminalError: false };
    });
    await readEvents(
      await POST(
        new Request("http://localhost/api/agent", {
          method: "POST",
          body: JSON.stringify({ projectId: "p1", prompt: "ponle un contador" }),
        }),
      ),
    );
  }

  it("las DOS verificaciones del turno comparten un solo navegador", async () => {
    mocks.createPool.mockResolvedValue({ render: mocks.poolRender, close: mocks.poolClose });

    await turnoConDosMiradas();

    expect(mocks.verifyEditedPage).toHaveBeenCalledTimes(2);
    expect(mocks.createPool, "un navegador por mirada, no por turno").toHaveBeenCalledTimes(1);
    expect(mocks.poolRender).toHaveBeenCalledTimes(2);
    expect(
      mocks.renderViewports,
      "con pool no puede usarse el camino de un-navegador-por-llamada",
    ).not.toHaveBeenCalled();
  });

  /** Se cierra SIEMPRE. Un Chromium colgado por turno es una fuga de memoria. */
  it("y el navegador del turno se cierra al acabar", async () => {
    mocks.createPool.mockResolvedValue({ render: mocks.poolRender, close: mocks.poolClose });

    await turnoConDosMiradas();

    expect(mocks.poolClose, "el navegador del turno quedó abierto").toHaveBeenCalledTimes(1);
  });

  /**
   * FAIL-SOFT: si el navegador no arranca, los ojos NO pueden quedarse ciegos.
   * Se cae al camino de siempre —uno por llamada—, que fallará por su cuenta si
   * tiene que fallar, pero por la razón de verdad y no por el pool.
   */
  it("si el pool no arranca, se mide como se medía antes", async () => {
    mocks.createPool.mockRejectedValue(new Error("no hay chrome"));

    await turnoConDosMiradas();

    expect(mocks.renderViewports, "los ojos se quedaron ciegos").toHaveBeenCalledTimes(2);
    expect(mocks.poolRender).not.toHaveBeenCalled();
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

