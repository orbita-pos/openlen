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
  noCreditsMessage: vi.fn(),
  debitCredits: vi.fn(),
  estimateCredits: vi.fn(),
  creditsForUsage: vi.fn(),
  resolveAIProvider: vi.fn(),
  stream: vi.fn(),
  fireworksStream: vi.fn(),
  renderReference: vi.fn(async (): Promise<{ mimeType: string; dataBase64: string } | null> => null),
  render: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { select: mocks.select, update: mocks.update },
  schema: { projects: { id: "id", userId: "userId", data: "data", userBrief: "userBrief" } },
}));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  noCreditsMessage: mocks.noCreditsMessage,
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
// El navegador de la etapa de medición. Se dobla —no se apaga— porque lo que
// estas pruebas vigilan es CUÁNDO se abre y CON QUÉ, no lo que ve dentro.
vi.mock("@/lib/ai/visual-quality-renderer", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  renderVisualQualityViewports: (...args: unknown[]) => mocks.render(...args),
}));

import { POST } from "./route";
import { MARKER } from "./system-prompt";
import { tagWithOpIds } from "@/lib/html-ops";

const JPEG = { mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg").toString("base64") } as const;

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
    mocks.noCreditsMessage.mockReturnValue("MENSAJE-COMPARTIDO-EDICION");
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
    // Sin navegador: esta prueba mide el contrato de la RUTA, y las dos etapas
    // que rinden la página tienen las suyas (lib/page-engine, lib/document).
    // Con Chrome de verdad cada caso tarda 3.5 s solo y se agota compitiendo
    // con los otros 255 archivos.
    process.env.OPENLEN_RENDER_CHECKS = "0";
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

  it("sin créditos usa la puerta compartida y no llama al modelo", async () => {
    const creditState = {
      plan: "free",
      balance: 0,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    };
    mocks.getCreditState.mockResolvedValue(creditState);

    const events = await readEvents(await call());

    expect(events).toEqual([
      {
        event: "error",
        data: {
          message: "MENSAJE-COMPARTIDO-EDICION",
          code: "no_credits",
          refillsAt: "2026-09-23T12:00:00.000Z",
        },
      },
    ]);
    expect(mocks.noCreditsMessage).toHaveBeenCalledWith(creditState, "existing");
    expect(mocks.fireworksStream).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  // CONTRATO DE SOBREGIRO. El coste real sólo existe al final del stream: un
  // turno admitido con 1 crédito puede costar 2 y aun así debe guardar, cobrar
  // (debitCredits topa en cero) y cerrar bien. Una segunda consulta, reserva o
  // estimación previa convierte esta prueba en roja.
  it("un turno que arranca con 1 crédito termina aunque el coste real sea 2", async () => {
    mocks.getCreditState.mockResolvedValue({
      plan: "free",
      balance: 1,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    });
    // Poison for a future preflight: if somebody uses the fallback as a
    // reservation estimate, it exceeds the admitted balance.
    mocks.estimateCredits.mockReturnValue(2);
    mocks.creditsForUsage.mockReturnValue(2);
    mocks.fireworksStream.mockReturnValue(
      modelSays(rewrite("<h1>Con botón nuevo</h1>")),
    );

    const events = await readEvents(await call());
    const done = events.find((event) => event.event === "done");

    expect(mocks.getCreditState).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.debitCredits).toHaveBeenCalledOnce();
    expect(mocks.debitCredits).toHaveBeenCalledWith("u1", 2);
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.debitCredits.mock.invocationCallOrder[0]!,
    );
    expect(events.some((event) => event.event === "error")).toBe(false);
    expect(String(done?.data.html)).toContain("Con botón nuevo");
  });

  // 🔴 UNA OP QUE EL PARSER RECHAZA NO PUEDE DESAPARECER EN SILENCIO.
  //
  // `parseOps` devuelve ops Y errores a la vez: un `<edits>` con un replace
  // bueno y un `op="nuke"` sale como {ops:[1], errors:[1]} — comprobado contra
  // el parser real. La ruta sólo abortaba con `errors.length > 0 && ops.length
  // === 0`, así que guardaba el cambio bueno y cerraba en `done`. El dueño leía
  // «aplicado» mientras la mitad de lo que pidió se había evaporado.
  //
  // El arreglo NO es fallar cerrado —eso tiraría cuatro cambios buenos por una
  // errata—: es la política que esta ruta ya aplica al runtime, al CSS y al
  // <head>, escrita en su propio código: guardar-y-AVISAR.
  describe("ops que el parser rechaza", () => {
    const opsSays = (inner: string) =>
      (async function* () {
        yield { type: "text_delta" as const, text: `Lo hago.
${MARKER}
${inner}` };
        yield { type: "usage" as const, inputTokens: 10, outputTokens: 10 };
        yield { type: "done" as const, stopReason: { kind: "end_turn" as const } };
      })();

    const opIdDelH1 = () => {
      const { taggedHtml } = tagWithOpIds(CURRENT_HTML);
      return /<h1[^>]*\sdata-op-id="([^"]+)"/.exec(taggedHtml)?.[1] ?? "";
    };

    it("aplica la buena, guarda, y AVISA de la que se cayó", async () => {
      mocks.fireworksStream.mockReturnValue(
        opsSays(
          `<edits><edit op="replace" target="${opIdDelH1()}"><h1>Hola de nuevo</h1></edit>` +
            `<edit op="nuke" target="algo"><p>fuera</p></edit></edits>`,
        ),
      );

      const events = await readEvents(await call());
      const done = events.find((e) => e.event === "done");

      expect(events.some((e) => e.event === "error")).toBe(false);
      expect(String(done?.data.html)).toContain("Hola de nuevo");
      // Lo que el usuario LEE. Sin esto el turno mentía por omisión.
      expect(String(done?.data.reasoning)).toContain("no se aplicó");
      expect(String(done?.data.reasoning)).toContain("nuke");
    });

    it("y cuando el parser no se queja, no inventa un aviso", async () => {
      mocks.fireworksStream.mockReturnValue(
        opsSays(
          `<edits><edit op="replace" target="${opIdDelH1()}"><h1>Hola de nuevo</h1></edit></edits>`,
        ),
      );

      const events = await readEvents(await call());
      const done = events.find((e) => e.event === "done");

      expect(String(done?.data.html)).toContain("Hola de nuevo");
      expect(String(done?.data.reasoning)).not.toContain("no se aplicó");
    });
  });

  // 🔴 UN TURNO QUE YA GUARDÓ NO PUEDE TERMINAR EN ERROR.
  //
  // El cobro corre DESPUÉS de `persistPage`. Cuando `debitCredits` rechazaba,
  // el catch del stream emitía `error`: el lienzo volvía al documento anterior
  // y al recargar reaparecía el cambio que la interfaz acababa de llamar fallo.
  // El usuario lo pedía otra vez y pagaba dos veces el mismo turno.
  //
  // El control de que esto no es vacío está justo debajo: un turno que NO llegó
  // a guardar tiene que seguir siendo un error de verdad.
  it("si el cobro falla DESPUÉS de guardar, el turno cierra en done — la página ya cambió", async () => {
    mocks.debitCredits.mockRejectedValue(new Error("db down"));
    mocks.fireworksStream.mockReturnValue(modelSays(rewrite("<h1>Con botón nuevo</h1>")));

    const events = await readEvents(await call());

    expect(mocks.update, "no llegó a guardar; la prueba no mide nada").toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.event === "error")).toBe(false);
    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    // Y el cliente recibe el documento REAL, no el anterior: converger con la
    // base es la mitad del arreglo.
    expect(String(done?.data.html)).toContain("Con botón nuevo");
  });

  // La red general, para todo lo que pueda lanzar DESPUÉS del guardado y no sea
  // el cobro: el cálculo de créditos, los avisos de CSS muerto, la prueba del
  // modelo. Cualquiera de ésos emitía `error` sobre una página ya cambiada.
  it("si algo revienta después de guardar, cierra en done con aviso — nunca en error", async () => {
    mocks.creditsForUsage.mockImplementation(() => {
      throw new Error("boom");
    });
    mocks.estimateCredits.mockImplementation(() => {
      throw new Error("boom");
    });
    mocks.fireworksStream.mockReturnValue(modelSays(rewrite("<h1>Guardado igual</h1>")));

    const events = await readEvents(await call());

    expect(mocks.update, "no llegó a guardar; la prueba no mide nada").toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.event === "error")).toBe(false);
    const done = events.find((e) => e.event === "done");
    expect(String(done?.data.html)).toContain("Guardado igual");
    // Y se le DICE que algo falló: converger en silencio sería la otra mitad
    // del mismo problema.
    expect(String(done?.data.reasoning)).toMatch(/falló al cerrar el turno/i);
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

  /**
   * ESTO ERA AL REVÉS. La referencia adjunta se quedaba en Gemini «pase lo que
   * pase», con este motivo: *"al razonador nunca se le ha mandado una imagen;
   * mandarla a ciegas apuesta la edición del usuario"*.
   *
   * Cambió el 2026-08-21 por decisión de Jesús: DeepSeek y Qwen son los modelos
   * de la casa, Gemini se queda para los píxeles. La imagen ya no va al
   * razonador —eso seguiría estando mal— sino a QWEN, que es el papel con visión
   * de la política. `OPENLEN_CHAT_PROVIDER=gemini` sigue devolviendo el camino
   * de antes.
   */
  it("un turno con imagen de referencia va a Qwen, no a Gemini", async () => {
    process.env.OPENLEN_AIDESIGN_PAGE_REFERENCE = "1";
    mocks.renderReference.mockResolvedValue({ mimeType: "image/jpeg", dataBase64: "AQID" });
    mocks.fireworksStream.mockReturnValue(modelSays(rewrite("<h1>Hola</h1>")));
    await readEvents(await call());
    expect(mocks.stream, "Gemini no debería haber corrido").not.toHaveBeenCalled();
    expect(mocks.fireworksStream).toHaveBeenCalledTimes(1);
    // Y la referencia tiene que VIAJAR: un turno de visión sin la imagen sería
    // peor que el anterior — el modelo decidiría a ciegas y nadie lo notaría.
    expect(mocks.fireworksStream.mock.calls[0][0]).toMatchObject({
      operation: "page_write_with_reference",
    });
    expect(mocks.fireworksStream.mock.calls[0][0].images).toHaveLength(1);
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

// ── LA PRUEBA DECLARADA EN EL CHAT ──────────────────────────────────────────
//
// Lo que se vigila aquí es la DECISIÓN de la ruta, que es donde esto puede
// nacer dark: un turno de ops que cambia el JavaScript tiene que pagar el
// navegador —era el único camino capaz de reescribir el comportamiento de la
// página entera sin que nada lo mirara— y un turno que sólo toca texto NO.
  // La MISMA valla que en crear: el modelo abre con ```html de vez en cuando y
  // lo que se pinta mientras llega iba crudo.
  describe("lo que se pinta mientras el Chat reescribe", () => {
    const pintado = (events: { event: string; data: Record<string, unknown> }[]) =>
      events.filter((e) => e.event === "html_chunk").map((e) => String(e.data.text)).join("");

    it("nunca pinta la valla ```html", async () => {
      const doc = rewrite("<h1>Hola</h1>");
      mocks.fireworksStream.mockReturnValue(
        (async function* () {
          yield { type: "text_delta" as const, text: `Lo hago.
${MARKER}
\`\`\`html
${doc}` };
          yield { type: "usage" as const, inputTokens: 10, outputTokens: 10 };
          yield { type: "done" as const, stopReason: { kind: "end_turn" as const } };
        })(),
      );

      const salida = pintado(await readEvents(await call()));
      expect(salida).not.toContain("`");
      expect(salida.startsWith("<!doctype")).toBe(true);
    });

    it("y una reescritura normal pasa sin tocarse", async () => {
      const doc = rewrite("<h1>Hola</h1>");
      mocks.fireworksStream.mockReturnValue(modelSays(doc));
      expect(pintado(await readEvents(await call()))).toBe(doc);
    });
  });

  describe("la prueba declarada, en la pestaña Chat", () => {
    const RUNTIME = '<script data-openlen-model-runtime>document.title="x";</script>';

    /** Cada llamada al render, con el HTML que vio y el guion que se le mandó. */
    let vistas: { html: string; behaviorProgram?: string }[] = [];

    const opsSays = (inner: string) =>
      (async function* () {
        yield { type: "text_delta" as const, text: `Lo hago.\n${MARKER}\n${inner}` };
        yield { type: "usage" as const, inputTokens: 10, outputTokens: 10 };
        yield { type: "done" as const, stopReason: { kind: "end_turn" as const } };
      })();

    /** El `data-op-id` de un elemento del documento que la ruta va a etiquetar. */
    const opIdDelH1 = () => {
      const { taggedHtml } = tagWithOpIds(CURRENT_HTML);
      return /<h1[^>]*\bdata-op-id="([^"]+)"/.exec(taggedHtml)?.[1] ?? "";
    };

    beforeEach(() => {
      vistas = [];
      process.env.OPENLEN_MODEL_JS = "1";
      delete process.env.OPENLEN_RENDER_CHECKS;
      mocks.render.mockImplementation(async (html: string, _i: unknown, o: { behaviorProgram?: string } = {}) => {
        vistas.push({ html, ...(o.behaviorProgram ? { behaviorProgram: o.behaviorProgram } : {}) });
        return { desktop: JPEG, mobile: JPEG, behaviorResult: [] };
      });
    });

    it("un turno de ops que toca el JavaScript SÍ paga el navegador", async () => {
      mocks.fireworksStream.mockReturnValue(
        opsSays(`<edits><edit op="replace" target="runtime">${RUNTIME}</edit></edits>
  <prueba>[{"clic":"#b","entonces":[{"donde":"#r","que":"cambia"}]}]</prueba>`),
      );

      const events = await readEvents(await call());

      expect(events.find((e) => e.event === "error")?.data.message ?? null).toBeNull();
      // `preparePage` abre el navegador dos veces —legibilidad y medición— y
      // sólo la SEGUNDA lleva guion. La primera devuelve documento, así que un
      // injerto suyo acabaría persistido en `data.html`: por eso no ve el
      // script. Ese reparto se comprueba aquí, no se da por hecho.
      const conGuion = vistas.filter((v) => v.behaviorProgram);
      expect(conGuion).toHaveLength(1);
      // Con el JavaScript dentro: sin él se mide una página sin comportamiento
      // y cualquier prueba falla porque no hay ni un manejador puesto.
      expect(conGuion[0]!.html).toContain('document.title="x"');
      expect(conGuion[0]!.behaviorProgram).toContain("#b");
      expect(vistas.filter((v) => v.html.includes('document.title="x"'))).toHaveLength(1);
    });

    it("y un turno de ops que sólo toca texto NO lo paga — sigue costando 17 ms", async () => {
      mocks.fireworksStream.mockReturnValue(
        opsSays(`<edits><edit op="replace" target="${opIdDelH1()}"><h1>Otro título</h1></edit></edits>`),
      );

      const events = await readEvents(await call());

      expect(events.some((e) => e.event === "error")).toBe(false);
      expect(vistas).toHaveLength(0);
    });

    it("cuando su prueba falla, el aviso llega al chat con el elemento", async () => {
      mocks.render.mockImplementation(async (html: string, _i: unknown, o: { behaviorProgram?: string } = {}) => {
        vistas.push({ html, ...(o.behaviorProgram ? { behaviorProgram: o.behaviorProgram } : {}) });
        return { desktop: JPEG, mobile: JPEG, behaviorResult: [[0, "#r no cambió"]] };
      });
      mocks.fireworksStream.mockReturnValue(
        opsSays(`<edits><edit op="replace" target="runtime">${RUNTIME}</edit></edits>
  <prueba>[{"clic":"#b","entonces":[{"donde":"#r","que":"cambia"}]}]</prueba>`),
      );

      const events = await readEvents(await call());

      // Se GUARDA igual: una promesa incumplida no cuesta la edición del usuario.
      // El bucle lo cierra el turno siguiente — el aviso viaja en `reasoning`, el
      // cliente lo guarda como turno del asistente y el modelo lo recibe.
      const done = events.find((e) => e.event === "done");
      expect(done).toBeDefined();
      expect(String(done?.data.reasoning)).toContain("#r no cambió");
      expect(String(done?.data.reasoning)).toMatch(/TU PROPIA PRUEBA FALLÓ/);
    });

    it("sin prueba declarada se mide igual, pero sin guion", async () => {
      mocks.fireworksStream.mockReturnValue(
        opsSays(`<edits><edit op="replace" target="runtime">${RUNTIME}</edit></edits>`),
      );

      await readEvents(await call());

      // Se abre igual —el turno cambió el comportamiento— pero se pulsa a
      // ciegas: sin promesa declarada sólo se puede preguntar «¿explotó?».
      expect(vistas.length).toBeGreaterThan(0);
      expect(vistas.every((v) => v.behaviorProgram === undefined)).toBe(true);
    });
  });
});
