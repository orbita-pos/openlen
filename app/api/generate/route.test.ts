// Task 4 step 3 — generate is a FAIL-OPEN surface: the project does not exist
// yet, so refusing costs the user a page they waited ~60s and paid credits
// for. It ships what it can and records what was lost on the row.
//
// This route was parked behind a checkpoint because four mutations ran after
// its last sanitize (one of them injects a <script> — the Tailwind carrier)
// and it validated behaviours AFTER the row was written, so its only answer to
// a dead control was a console.warn nobody reads. The tests below pin what
// adopting the gate must NOT change (the palette carrier, the modules bridge,
// the brand seeding) alongside what it must.
//
// Only auth/limits/credits/provider/AI are mocked; sanitize, normalize, meta,
// seeding and behaviour validation are the real passes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTwCarrier } from "@/lib/publish/tw-config";
import type { PasoSpec } from "@/lib/agent/behavior-spec";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getUserPlan: vi.fn(),
  checkAndConsume: vi.fn(),
  getCreditState: vi.fn(),
  noCreditsMessage: vi.fn(),
  generateHtmlStream: vi.fn(),
  selectReference: vi.fn(),
  resolveProfile: vi.fn(),
  createProject: vi.fn(),
  appendChatMessage: vi.fn(),
  createVersion: vi.fn(),
  repairGeneratedPage: vi.fn(),
  renderVisualQualityViewports: vi.fn(),
  critique: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/limits", () => ({
  getUserPlan: mocks.getUserPlan,
  checkAndConsume: mocks.checkAndConsume,
  userLimitKey: (u: string, k: string) => `${u}:${k}`,
  PLAN_LIMITS: { pro: { generate: [] }, free: { generate: [] } },
}));
vi.mock("@/lib/credits", () => ({
  getCreditState: mocks.getCreditState,
  noCreditsMessage: mocks.noCreditsMessage,
}));
vi.mock("@/lib/ai-provider", () => ({
  resolveAIProvider: () => ({ key: "test-key", label: "Gemini", model: "gemini-3-flash" }),
}));
vi.mock("@/lib/ai-stream/generate", () => ({ generateHtmlStream: mocks.generateHtmlStream, pageWriterUsesDeepSeek: () => true }));
vi.mock("@/lib/templates/select-reference", () => ({ selectReferenceTemplate: mocks.selectReference }));
vi.mock("@/lib/ai/inline-image", () => ({ fetchImageAsInlineData: vi.fn() }));
// El navegador es dependencia pesada como cualquier otra aquí: un null deja el
// arreglo de legibilidad en fail-soft y la ruta entrega la página tal cual.
// El arreglo en sí está cubierto con navegador de verdad en
// lib/document/repair-unreadable-text.browser.test.ts.
vi.mock("@/lib/ai/visual-quality-renderer", () => ({ renderVisualQualityViewports: mocks.renderVisualQualityViewports }));
vi.mock("@/lib/business-profiles/store", () => ({ resolveProfileForCreation: mocks.resolveProfile }));
vi.mock("@/lib/projects", () => ({ createProject: mocks.createProject }));
vi.mock("@/lib/projects/chat", () => ({ appendChatMessage: mocks.appendChatMessage }));
vi.mock("@/lib/projects/versions", () => ({ createVersion: mocks.createVersion }));
vi.mock("@/lib/generation/repair-pass", () => ({ repairGeneratedPage: mocks.repairGeneratedPage }));
vi.mock("@/lib/ai/vision-critique", () => ({ critiqueGeneratedPage: mocks.critique }));

import { POST } from "./route";

// >1000 chars: the route rejects a short document as an incomplete generation.
/** El documento original CON su script dentro — que es donde vive desde el
 *  2026-08-26. Antes viajaba por un parámetro aparte de `modelReturns`. */
const conScriptOriginal = (html: string) =>
  html.replace("</body>", "<script>window.originalRuntime = true;</script></body>");

const FILLER = "<p>Contenido real de la página generada.</p>".repeat(30);
const doc = (head: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Café Luna</title>${head}</head><body>${body}${FILLER}</body></html>`;

/** The model's output, as `generateHtmlStream` would hand it back. */
function modelReturns(
  html: string,
  modelRuntime: string | null = null,
  modelPrueba?: readonly PasoSpec[],
): void {
  mocks.generateHtmlStream.mockImplementation(() => ({
    stream: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(html));
        c.close();
      },
    }),
    done: Promise.resolve({
      finalHtml: html,
      result: null,
      usage: { inputTokens: 10, outputTokens: 20 },
      creditsDebited: 1,
      stopKind: "end_turn" as const,
      error: null,
      modelRuntime,
      ...(modelPrueba ? { modelPrueba } : {}),
    }),
  }));
}

async function call(brief = "una landing para una cafetería de especialidad"): Promise<{
  status: number;
  events: { event: string; data: Record<string, unknown> }[];
}> {
  const res = await POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ brief }),
    }),
  );
  const text = res.body ? await new Response(res.body).text() : "";
  const events = text
    .split("\n\n")
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const [head, ...rest] = block.split("\n");
      return {
        event: head.slice("event: ".length),
        data: JSON.parse(rest.join("\n").slice("data: ".length)) as Record<string, unknown>,
      };
    });
  return { status: res.status, events };
}

function savedInput(): { html: string; modelRuntime?: string | null; degradations?: { code: string; count: number }[] } {
  return mocks.createProject.mock.calls[0][1] as {
    html: string;
    degradations?: { code: string; count: number }[];
  };
}

describe("POST /api/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The critic and the photo library are separate features with their own
    // tests; this file is about what the save path does with the document.
    vi.stubEnv("OPENLEN_VISION_CRITIC", "0");
    vi.stubEnv("OPENLEN_IMAGERY", "0");
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.getUserPlan.mockResolvedValue("pro");
    mocks.checkAndConsume.mockResolvedValue({ ok: true, blocked: null, resetAt: null });
    mocks.getCreditState.mockResolvedValue({ balance: 50 });
    mocks.noCreditsMessage.mockReturnValue("MENSAJE-COMPARTIDO-CREAR");
    mocks.selectReference.mockResolvedValue(null);
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
    mocks.createProject.mockResolvedValue("p1");
    mocks.appendChatMessage.mockResolvedValue(undefined);
    mocks.createVersion.mockResolvedValue("v1");
    mocks.repairGeneratedPage.mockResolvedValue({ ok: false, reason: "sin_resultado" });
    mocks.renderVisualQualityViewports.mockResolvedValue(null);
  });

  // 🔴 UN TURNO NO PUEDE DURAR PARA SIEMPRE (hallazgo 10, mitad servidor).
  //
  // Chat y Agente ya tenían techo (`STREAM_TIMEOUT_MS` sobre su
  // `upstreamAbort`). Crear era la única de las tres SIN él — y es la
  // superficie donde el usuario mira una pantalla en blanco. Peor: el
  // keepalive de `progress` cada 5s existe A PROPÓSITO para que el watchdog
  // del navegador no salte durante el «pensar» inicial, así que cada ping
  // rearmaba el único reloj que quedaba. Un proveedor que acepta la conexión
  // y deja de mandar bytes dejaba la generación corriendo indefinidamente.
  describe("el techo del turno", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("un proveedor que nunca contesta se corta, y el usuario recibe un error", async () => {
      vi.useFakeTimers();
      let señal: AbortSignal | null = null;
      mocks.generateHtmlStream.mockImplementation((opts: { signal: AbortSignal }) => {
        señal = opts.signal;
        return {
          stream: new ReadableStream<Uint8Array>({
            start(c) {
              // Acepta la conexión y no manda un solo byte, como el caso real.
              opts.signal.addEventListener("abort", () => c.close());
            },
          }),
          done: new Promise((resolve) => {
            opts.signal.addEventListener("abort", () =>
              resolve({
                finalHtml: null,
                result: null,
                usage: null,
                creditsDebited: 0,
                stopKind: "cancelled" as const,
                error: null,
                modelRuntime: null,
              }),
            );
          }),
        };
      });

      const pendiente = call();
      await vi.advanceTimersByTimeAsync(600_001);
      const { events } = await pendiente;

      expect(señal).not.toBeNull();
      expect(señal!.aborted).toBe(true);
      expect(events.at(-1)?.event).toBe("error");
      // Y NO se reintenta: reintentar contra una señal ya abortada es tirar
      // otra llamada que falla igual y registrar dos veces el mismo fallo.
      expect(mocks.generateHtmlStream).toHaveBeenCalledTimes(1);
    });

    it("una generación normal no se ve afectada por el techo", async () => {
      // Control: sin esto, un techo de cero segundos pasaría la prueba de
      // arriba y rompería todas las generaciones.
      modelReturns(doc("", "<h1>Café Luna</h1>"));

      const { events } = await call();

      expect(events.at(-1)?.event).toBe("project_saved");
    });
  });

  // 🔴 EL PRESUPUESTO DE MEJORA NO PUEDE DEPENDER DE QUE LA MEJORA SALGA BIEN
  // (hallazgo 15). `regenerated` significaba «la página entregada viene de una
  // reescritura» y se usaba ADEMÁS como presupuesto del crítico. Sólo se ponía
  // a true cuando la reescritura era ACEPTADA — así que una reescritura que
  // corrió, se pagó y se midió PEOR dejaba el presupuesto intacto, y el crítico
  // podía pedir una tercera generación cobrable sobre la misma pulsación. El
  // contrato de créditos (REGEN_CREDIT_OVERHEAD) promete una sola.
  describe("el presupuesto de pasadas cobrables", () => {
    /** Cada llamada al modelo devuelve un documento distinto, para poder medir
     *  cada pasada por separado en el renderizador. */
    function pasadasDistintas(): void {
      let n = 0;
      mocks.generateHtmlStream.mockImplementation(() => {
        n += 1;
        const html = doc("", `<h1>Pasada ${n}</h1>`);
        return {
          stream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode(html));
              c.close();
            },
          }),
          done: Promise.resolve({
            finalHtml: html,
            result: null,
            usage: { inputTokens: 10, outputTokens: 20 },
            creditsDebited: 1,
            stopKind: "end_turn" as const,
            error: null,
            modelRuntime: null,
          }),
        };
      });
    }

    beforeEach(() => {
      vi.stubEnv("OPENLEN_VISION_CRITIC", "1");
      vi.stubEnv("OPENLEN_VISION_CRITIC_REGEN", "1");
      mocks.critique.mockResolvedValue({
        shouldRegenerate: true,
        issues: ["se ve pobre"],
        regenerationFeedback: "hazla mejor",
        fallback: false,
      });
      // La primera pasada sale rota; la reescritura sale PEOR, así que se
      // descarta. Es justo el caso en el que el presupuesto se perdía.
      mocks.renderVisualQualityViewports.mockImplementation(async (html: string) =>
        html.includes("Pasada 2")
          ? { mobileOverflow: true, unreadableText: [{ contrast: 1.2 }] }
          : { mobileOverflow: true, unreadableText: [] },
      );
    });

    it("una reescritura que se descarta YA gastó el presupuesto: el crítico no pide otra", async () => {
      pasadasDistintas();

      const { events } = await call();

      // Inicial + reescritura por rotura medida. Ni una más.
      expect(mocks.generateHtmlStream).toHaveBeenCalledTimes(2);
      // Y ni siquiera se le pregunta: preguntar cuesta una llamada de visión.
      expect(mocks.critique).not.toHaveBeenCalled();
      expect(events.at(-1)?.event).toBe("project_saved");
      // La página entregada es la primera — la reescritura salió peor.
      expect(savedInput().html).toContain("Pasada 1");
    });

    it("sin rotura medida no hay reescritura, y ahí el crítico SÍ tiene su turno", async () => {
      // Control: sin esto, «el crítico nunca corre» pasaría la prueba de
      // arriba sin que el presupuesto exista.
      pasadasDistintas();
      mocks.renderVisualQualityViewports.mockResolvedValue({
        mobileOverflow: false,
        unreadableText: [],
      });

      await call();

      expect(mocks.critique).toHaveBeenCalledTimes(1);
      expect(mocks.generateHtmlStream).toHaveBeenCalledTimes(2);
    });
  });

  it("acepta exactamente 4000 caracteres", async () => {
    modelReturns(doc("", "<h1>Café Luna</h1>"));

    const { status, events } = await call("x".repeat(4000));

    expect(status).toBe(200);
    expect(events.at(-1)?.event).toBe("project_saved");
    expect(mocks.generateHtmlStream).toHaveBeenCalledTimes(1);
  });

  it("rechaza 4001 caracteres antes de iniciar generación", async () => {
    const { status } = await call("x".repeat(4001));

    expect(status).toBe(400);
    expect(mocks.generateHtmlStream).not.toHaveBeenCalled();
    expect(mocks.checkAndConsume).not.toHaveBeenCalled();
  });

  // La puerta PRO mandaba al usuario free al "Quick (curated) flow" — que era
  // /api/curate, borrado con el catálogo. Un usuario nuevo se topaba con un muro
  // y una salida inexistente. Lo que separa free de pro son el tope por hora y
  // los créditos, no una puerta.
  it("un usuario free puede crear su página", async () => {
    mocks.getUserPlan.mockResolvedValue("free");
    modelReturns(doc("", "<h1>El Pastor</h1>"));

    const { status, events } = await call();

    expect(status).toBe(200);
    expect(events.at(-1)?.event).toBe("project_saved");
    expect(events.map((e) => e.event)).not.toContain("error");
  });

  it("sin créditos usa la puerta compartida y no afirma que una página nueva se guardó", async () => {
    const creditState = {
      plan: "free",
      balance: 0,
      allotment: 20,
      refillsAt: new Date("2026-09-23T12:00:00.000Z"),
    };
    mocks.getCreditState.mockResolvedValue(creditState);

    const { status, events } = await call();

    expect(status).toBe(200);
    expect(events).toEqual([
      {
        event: "error",
        data: {
          message: "MENSAJE-COMPARTIDO-CREAR",
          code: "no_credits",
          refillsAt: "2026-09-23T12:00:00.000Z",
        },
      },
    ]);
    expect(mocks.noCreditsMessage).toHaveBeenCalledWith(creditState, "create");
    expect(mocks.generateHtmlStream).not.toHaveBeenCalled();
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("records nothing when the generated page comes through whole", async () => {
    modelReturns(doc("", "<h1>Café Luna</h1>"));

    const { events } = await call();

    expect(events.at(-1)?.event).toBe("project_saved");
    expect(savedInput().degradations).toBeUndefined();
  });

  it("keeps the page and records a control born dead, instead of only logging it", async () => {
    // The route's old answer to this was `console.warn` — the log nobody
    // reads. behaviors:"warn" still ships the page (there is no previous good
    // state to fall back to) but the loss goes on the row, and the workspace
    // tells the user to ask the assistant to fix it.
    modelReturns(doc("", '<h1>Café Luna</h1><button data-ol-copy="cupon">Copiar</button>'));

    const { events } = await call();

    expect(events.at(-1)?.event).toBe("project_saved");
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    expect(savedInput().degradations).toEqual([
      {
        surface: "generate",
        stage: "behaviors",
        code: "broken_controls",
        count: 1,
        // El detalle viaja con el conteo hasta la fila del proyecto: es lo que
        // el botón "Arreglar esto" le pasa al asistente. Sin él, el aviso
        // vuelve a ser "algunos controles" y el creador no sabe qué pedir.
        detail: [expect.any(String)],
      },
    ]);
  });

  it("rechaza una reparación destructiva en la ruta y para un defecto observable conserva HTML/runtime hasta reescribir", async () => {
    const original = doc(
      "<style>.hero .missing-class{color:red}</style>",
      "<section class=\"hero\"><h1>PULSE ATHLETICS</h1><p>Entrena con intención.</p></section>",
    );
    const destructive = doc("", "<div class=\"missing-class\"></div>");
    modelReturns(conScriptOriginal(original));
    mocks.repairGeneratedPage.mockResolvedValue({
      ok: true,
      html: destructive,
      runtime: "window.destructiveRuntime = true;",
      appliedOps: 1,
    });

    const { events } = await call();

    expect(mocks.repairGeneratedPage).toHaveBeenCalledTimes(1);
    // El selector muerto es observable, por lo que el comportamiento heredado
    // es reescritura completa. El segundo pass recibe el original; si la ruta
    // adopta el candidato destructivo, estos dos valores cambian.
    expect(mocks.generateHtmlStream).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.event).toBe("project_saved");
    expect(savedInput().html).toContain("PULSE ATHLETICS");
    // El JavaScript del original se conserva porque VIVE EN SU HTML: rechazar
    // el candidato destructivo es quedarse con el documento entero, script
    // incluido. Antes esto era un segundo valor que podía divergir del primero.
    expect(savedInput().html).toContain("window.originalRuntime = true;");
  });

  // INVERTIDA el 2026-08-26, y es LA prueba del bug que Jesús reportaba: «puse
  // un H1 y salió de otro color».
  //
  // Fijaba que el hex de marca del modelo se convirtiera en `var(--ol-accent)`
  // para que el control del inspector pudiera moverlo. La intención era buena y
  // el precio era invisible: el color que el modelo eligió dejaba de estar en
  // la página. `normalize_accent` lo sustituía en `<style>`, en `style=""`, en
  // las clases `[#hex]` y en la config de Tailwind — las cuatro.
  //
  // Ahora el hex se queda donde el modelo lo puso. El inspector sigue
  // funcionando en las páginas que SÍ usan tokens; lo que ya no hace es
  // convertir a la fuerza las que no.
  it("el hex de marca del modelo llega INTACTO — no se convierte en token", async () => {
    modelReturns(
      doc(
        `<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={theme:{extend:{colors:{lime:'#c8ff3d'}}}}</script>`,
        '<h1 class="text-lime" style="color:#c8ff3d">Café Luna</h1>',
      ),
    );

    await call();

    const saved = savedInput().html;
    expect(saved, 'le cambiaron el hex del <style>').toContain("#c8ff3d");
    expect(saved, 'le cambiaron el hex inline').toContain('style="color:#c8ff3d"');
  });
  it("keeps the Tailwind palette carrier through the gate's sanitize", async () => {
    // The carrier is a <script> WE inject after sanitizing, so a second
    // sanitize pass is exactly where a naive adoption would eat the palette:
    // 53/450 templates and every generation where the model emits a config
    // would lose their colours — backgrounds gone, white-on-white.
    modelReturns(
      doc(
        `<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={theme:{extend:{colors:{ink:'#0b0b0f'}}}}</script>`,
        '<h1 class="text-ink">Café Luna</h1>',
      ),
    );

    await call();

    // El carrier era el rescate de una paleta que el saneador mataba. Desde
    // el 2026-08-26 no la mata (gateModelHtml), así que la config del modelo
    // llega entera y no hay nada que rescatar. Lo que había que clavar es que
    // la paleta NO SE PIERDA — el mecanismo era un detalle.
    const guardado = savedInput().html;
    expect(guardado).toContain("#0b0b0f");
    expect(guardado).toMatch(/tailwind\s*\.\s*config/);
  });

  it("keeps a carrier the stream already injected — sanitizing twice must not eat it", async () => {
    // The production shape: generateHtmlStream sanitizes and injects the
    // carrier itself, so the document reaching the save path already has one.
    // A second sanitize pass has to round-trip it, not count it as a script
    // the user lost.
    modelReturns(
      doc(
        `<script src="https://cdn.tailwindcss.com"></script><script data-ol-tw="1">tailwind.config={"theme":{"extend":{"colors":{"ink":"#0b0b0f"}}}}</script>`,
        '<h1 class="text-ink">Café Luna</h1>',
      ),
    );

    await call();

    expect(readTwCarrier(savedInput().html)).toEqual({ colors: { ink: "#0b0b0f" } });
    expect(savedInput().degradations).toBeUndefined();
  });

  it("still bridges a module placeholder to a real module", async () => {
    // El ejemplo era Reservas; ese módulo se retiró (2026-08-21) y el puente
    // sigue vivo para Colecciones — que es lo que esta prueba de verdad vigila:
    // que un hueco del modelo encienda el módulo real.
    modelReturns(doc("", '<section data-ol-collection-section><h2>Catálogo</h2></section>'));

    const { events } = await call();

    expect(mocks.createProject.mock.calls[0][1]).toMatchObject({
      settings: expect.objectContaining({ collections: expect.anything() }),
    });
    expect(events.at(-1)?.data.enabledModules).toEqual(["collections"]);
  });

  it("refuses the reserved marker — that never fails open", async () => {
    modelReturns(doc("", '<section data-slot-path="a">x</section>'));

    const { events } = await call();

    expect(events.at(-1)?.event).toBe("error");
    expect(mocks.createProject).not.toHaveBeenCalled();
  });
});


/**
 * "Hazme una como esta" — la referencia visual entra por el BRIEF, nunca como
 * imagen adjunta.
 *
 * Ese matiz no es de estilo: una imagen en la llamada fija el turno a Gemini
 * porque el papel que razona en Fireworks no tiene ojos, y entonces DeepSeek
 * deja de escribir la página. Qwen ya miró la captura en /api/style-reference;
 * lo que llega aquí es su conclusión en texto.
 */
describe("referencia visual en el brief", () => {
  const direction = {
    hostname: "stripe.com",
    palette: [
      { role: "principal", hex: "#635bff" },
      { role: "neutro 900", hex: "#0a2540" },
    ],
    polarity: "light" as const,
    fontFamily: "Söhne",
    radius: "rounded" as const,
    character: "Respira mucho, tono sobrio, el peso cae en la tipografía.",
  };

  async function callConDireccion(styleDirection: unknown): Promise<string> {
    mocks.generateHtmlStream.mockClear();
    const res = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ brief: "una landing para paneles solares", styleDirection }),
      }),
    );
    const req = mocks.generateHtmlStream.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
      images?: unknown[];
    };
    return req.messages.map((m) => m.content).join("\n");
  }

  it("la paleta MEDIDA llega al prompt", async () => {
    const prompt = await callConDireccion(direction);
    expect(prompt).toContain("#635bff");
    expect(prompt).toContain("Söhne");
  });

  it("y el carácter que Qwen vio", async () => {
    expect(await callConDireccion(direction)).toContain("el peso cae en la tipografía");
  });

  it("le dice EXPLÍCITAMENTE que no copie", async () => {
    const prompt = await callConDireccion(direction);
    expect(prompt).toMatch(/nunca copies/i);
  });

  // Un modelo que lee "inspírate en stripe.com" escribe copy de Stripe.
  it("el dominio de la referencia NO viaja", async () => {
    expect(await callConDireccion(direction)).not.toContain("stripe.com");
  });

  // LA invariante que protege a DeepSeek: texto, jamás una imagen adjunta.
  it("NO adjunta ninguna imagen — eso desviaría el turno a Gemini", async () => {
    await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ brief: "una landing para paneles solares", styleDirection: direction }),
      }),
    );
    const req = mocks.generateHtmlStream.mock.calls.at(-1)?.[0] as { images?: unknown[] };
    expect(req.images ?? []).toHaveLength(0);
  });

  it("sin referencia, el prompt sale como siempre", async () => {
    const prompt = await callConDireccion(undefined);
    expect(prompt).not.toContain("direccion-visual");
  });

  // Esto acaba dentro del prompt: un objeto con un `character` enorme o una
  // paleta de mil entradas sería una forma barata de inflar cada generación.
  it("una dirección con basura se ignora o se acota, nunca se cuela entera", async () => {
    const prompt = await callConDireccion({
      palette: [
        { role: "x".repeat(500), hex: "#111111" },
        ...Array.from({ length: 50 }, () => ({ role: "r", hex: "#222222" })),
      ],
      character: "z".repeat(9000),
      fontFamily: "f".repeat(900),
    });
    const bloque = /<direccion-visual>[\s\S]*?<\/direccion-visual>/.exec(prompt)?.[0] ?? "";
    expect(bloque.length).toBeLessThanOrEqual(900);
  });

  it("una paleta con hex inválidos no produce bloque", async () => {
    const prompt = await callConDireccion({ palette: [{ role: "x", hex: "rojo" }] });
    expect(prompt).not.toContain("direccion-visual");
  });
});

/**
 * LA CÁPSULA — quién puede autorizar JavaScript del modelo, y sobre qué página.
 *
 * Que llegue en el resumen del stream no basta: sólo se guarda si esta página
 * puede llevarlo. Un formulario o un módulo la descalifican, porque el script
 * compartiría origen con las APIs que llevan la sesión del visitante.
 */
describe("el JavaScript del modelo llega a createProject — dentro del HTML", () => {
  // ESTE BLOQUE MEDÍA LA CÁPSULA hasta el 2026-08-26: `createProject` recibía
  // el código por un parámetro aparte (`modelRuntime`) y lo guardaba en su
  // propia columna, atado por un hash a los bytes del documento.
  //
  // Ya no hay parámetro ni columna. El `<script>` viaja DENTRO de `input.html`,
  // que es el mismo sitio donde viaja el `<h1>`. Lo que se comprueba sigue
  // siendo lo mismo —que el código del modelo llegue a lo que se guarda— y la
  // afirmación es ahora una sola: está en el HTML.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_VISION_CRITIC", "0");
    vi.stubEnv("OPENLEN_IMAGERY", "0");
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.getUserPlan.mockResolvedValue("pro");
    mocks.checkAndConsume.mockResolvedValue({ ok: true, blocked: null, resetAt: null });
    mocks.getCreditState.mockResolvedValue({ balance: 50 });
    mocks.noCreditsMessage.mockReturnValue("MENSAJE-COMPARTIDO-CREAR");
    mocks.selectReference.mockResolvedValue(null);
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
    mocks.createProject.mockResolvedValue("p1");
    mocks.appendChatMessage.mockResolvedValue(undefined);
    mocks.createVersion.mockResolvedValue("v1");
    mocks.repairGeneratedPage.mockResolvedValue({ ok: false, reason: "sin_resultado" });
    mocks.renderVisualQualityViewports.mockResolvedValue(null);
  });

  const guardado = () =>
    (mocks.createProject.mock.calls[0]?.[1] as { html?: string } | undefined)?.html ?? "";

  const CODIGO = 'document.title = "vivo";';
  const conScript = (extra = "") =>
    `<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1>${FILLER}${extra}<script>${CODIGO}</script></body></html>`;

  it("una página de presentación lo guarda", async () => {
    modelReturns(conScript());
    const r = await call();
    expect(r.status).toBe(200);
    expect(guardado(), "la ruta nunca llegó a guardar").not.toBe("");
    expect(guardado()).toContain(CODIGO);
  });

  it("sin script, no se inventa ninguno", async () => {
    modelReturns(
      `<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1>${FILLER}</body></html>`,
    );
    await call();
    expect(guardado()).not.toContain("<script>document.title");
  });

  /**
   * ANTES UN FORMULARIO DESCALIFICABA LA PÁGINA ENTERA y el JavaScript se
   * tiraba sin decírselo a nadie — medido: 1 de cada 6 páginas corrientes, por
   * llevar un formulario de contacto. Esa puerta se levantó el 2026-08-21 y
   * ahora ni siquiera hay dónde ponerla: el script es parte del documento.
   */
  it("una página con formulario SÍ lo guarda", async () => {
    modelReturns(conScript('<form><input name="email"></form>'));
    await call();
    expect(guardado()).toContain(CODIGO);
  });

  it("y una con módulo también", async () => {
    modelReturns(conScript("<section data-ol-chat-section></section>"));
    await call();
    expect(guardado()).toContain(CODIGO);
  });
});

describe("el brief se siembra como el turno 1 del chat", () => {
  // Vive FUERA del primer describe, así que NO hereda su beforeEach — sin este
  // montaje la petición sale 401 y el spy queda a cero, que se lee como «no se
  // llamó» cuando en realidad el código ni se alcanzó. Ya pasó en este archivo.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_VISION_CRITIC", "0");
    vi.stubEnv("OPENLEN_IMAGERY", "0");
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.getUserPlan.mockResolvedValue("pro");
    mocks.checkAndConsume.mockResolvedValue({ ok: true, blocked: null, resetAt: null });
    mocks.getCreditState.mockResolvedValue({ balance: 50 });
    mocks.selectReference.mockResolvedValue(null);
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
    mocks.createProject.mockResolvedValue("p1");
    mocks.createVersion.mockResolvedValue("v1");
    mocks.appendChatMessage.mockResolvedValue(undefined);
  });

  it("guarda lo que escribiste, tal cual, contra el proyecto recién creado", async () => {
    modelReturns(`<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1>${FILLER}</body></html>`);
    await call("una landing para mi cafetería con cuenta atrás");

    expect(mocks.appendChatMessage).toHaveBeenCalledTimes(1);
    const [projectId, turn] = mocks.appendChatMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(projectId).toBe("p1");
    expect(turn.userText).toBe("una landing para mi cafetería con cuenta atrás");
    // `applied` y `page: null`: el cliente sólo arma el historial con turnos
    // settled, y filtra por página. Un turno con otra forma no llegaría a Len.
    expect(turn.status).toBe("applied");
    expect(turn.page).toBeNull();
    expect(String(turn.assistantReasoning).length).toBeGreaterThan(0);
  });

  it("si el chat no se puede escribir, la PÁGINA no se pierde", async () => {
    // La página ya está guardada cuando esto corre. Perder el turno es feo;
    // perder la página por no poder escribirlo sería absurdo.
    mocks.appendChatMessage.mockRejectedValue(new Error("db caída"));
    modelReturns(`<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1>${FILLER}</body></html>`);
    const { events } = await call();

    expect(events.some((e) => e.event === "error")).toBe(false);
    // `project_saved` es el evento de éxito de ESTA ruta (ai-design usa `done`).
    expect(events.some((e) => e.event === "project_saved")).toBe(true);
  });
});

// ── LA VALLA DE MARKDOWN EN VIVO ────────────────────────────────────────────
//
// El modelo abre con ```html de vez en cuando. `extractDocument` la quita del
// documento FINAL, así que la página entregada siempre salió bien — pero los
// trozos del streaming iban crudos y el usuario veía «```html» colgado arriba
// mientras su página se dibujaba debajo.
describe("lo que se pinta mientras se crea", () => {
  const DOC = `<!doctype html><html lang="es"><head><title>x</title></head><body><h1>Hola</h1>${FILLER}</body></html>`;

  /** Como `modelReturns`, pero troceado — la valla puede llegar partida. */
  function modelStreams(trozos: readonly string[], finalHtml: string): void {
    mocks.generateHtmlStream.mockImplementation(() => ({
      stream: new ReadableStream<Uint8Array>({
        start(c) {
          for (const t of trozos) c.enqueue(new TextEncoder().encode(t));
          c.close();
        },
      }),
      done: Promise.resolve({
        finalHtml,
        result: null,
        usage: { inputTokens: 10, outputTokens: 20 },
        creditsDebited: 1,
        stopKind: "end_turn" as const,
        error: null,
      }),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OPENLEN_VISION_CRITIC", "0");
    vi.stubEnv("OPENLEN_IMAGERY", "0");
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.getUserPlan.mockResolvedValue("pro");
    mocks.checkAndConsume.mockResolvedValue({ ok: true, blocked: null, resetAt: null });
    mocks.getCreditState.mockResolvedValue({ balance: 50 });
    mocks.selectReference.mockResolvedValue(null);
    mocks.resolveProfile.mockResolvedValue({ id: null, data: {} });
    mocks.createProject.mockResolvedValue("p1");
    mocks.createVersion.mockResolvedValue("v1");
    mocks.appendChatMessage.mockResolvedValue(undefined);
  });

  const pintado = (events: { event: string; data: Record<string, unknown> }[]) =>
    events.filter((e) => e.event === "html_chunk").map((e) => String(e.data.text)).join("");

  it("nunca pinta la valla ```html", async () => {
    modelStreams(["```html\n", DOC], DOC);
    const { events } = await call();
    const salida = pintado(events);
    expect(salida).not.toContain("```");
    expect(salida.startsWith("<!doctype")).toBe(true);
  });

  it("tampoco si llega partida en dos trozos", async () => {
    // El caso que un `startsWith("```html")` no cubriría.
    modelStreams(["``", "`html\nAquí va tu página:\n", DOC], DOC);
    const salida = pintado(await call().then((r) => r.events));
    expect(salida).not.toContain("`");
    expect(salida).not.toContain("Aquí va tu página");
    expect(salida.startsWith("<!doctype")).toBe(true);
  });

  it("y el caso normal pasa BYTE A BYTE, sin tocar nada", async () => {
    // La guarda no puede costarle nada a la inmensa mayoría de generaciones.
    modelStreams([DOC.slice(0, 40), DOC.slice(40)], DOC);
    expect(pintado(await call().then((r) => r.events))).toBe(DOC);
  });

  /**
   * LO QUE SE PINTA ES LO QUE SE GUARDA — la propiedad que convierte el modo
   * código del stream en un TESTIGO y no en un adorno.
   *
   * El panel de código renderiza exactamente esta cadena (`aiGenState.html`,
   * la suma de los `html_chunk`). Si lo pintado y lo guardado pudieran
   * separarse, el usuario vería escribirse un documento y recibiría otro — que
   * es justo la clase de mentira invisible que dejó acumular 33
   * transformaciones sin que nadie protestara.
   *
   * NO son idénticos, y no deben serlo: entre medias corre `preparePage`, que
   * completa el `<head>`, cablea los formularios y hornea las imágenes que el
   * modelo no puede bajar. Lo que se clava es que lo pintado ESTÉ dentro de lo
   * guardado en sus partes que nadie tiene por qué tocar — el titular, el
   * `<script>`, el color.
   */
  it("y lo que se pinta sobrevive dentro de lo que se guarda", async () => {
    const CODIGO = "window.__DEL_MODELO__=1";
    const doc =
      `<!doctype html><html lang="es"><head><title>x</title></head><body>` +
      `<h1 style="color:#c8ff3d">Café Luna</h1>${FILLER}` +
      `<script>${CODIGO}</script></body></html>`;
    modelStreams([doc.slice(0, 60), doc.slice(60)], doc);

    const { events } = await call();
    const visto = pintado(events);
    const guardado = savedInput().html;

    for (const trozo of ["Café Luna", CODIGO, "#c8ff3d"]) {
      expect(visto, `no se pintó: ${trozo}`).toContain(trozo);
      expect(guardado, `se pintó pero no se guardó: ${trozo}`).toContain(trozo);
    }
  });
});
