import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InlineImage, Message, StreamEvent } from "@/lib/ai-gateway";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import { creditRate } from "@/lib/credits";

const geminiStream = vi.fn();
const fireworksStream = vi.fn();

vi.mock("@/lib/ai-gateway", () => ({
  GeminiProvider: class {
    stream(request: unknown, opts: unknown) {
      return geminiStream(request, opts);
    }
  },
}));

vi.mock("@/lib/ai/fireworks-stream-client", () => ({
  createFireworksStreamClient: () => ({
    stream: (request: unknown, opts: unknown) => fireworksStream(request, opts),
  }),
}));

vi.mock("@/lib/ai-provider", () => ({
  resolveAIProvider: () => ({ key: "k", model: "gemini-3.5-flash", label: "Gemini", rate: "gemini-flash" }),
}));

const { createAgentBrain } = await import("./brain");

async function* events(...list: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of list) yield e;
}

const TOOLS = [{ name: "editar_pagina", parameters: { type: "OBJECT", properties: {} } }];
const USER: Message = { role: "user", content: "hacé el hero más grande" };
const IMAGE: InlineImage = { mimeType: "image/png", dataBase64: "AAAA" };

function drain(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  return (async () => {
    const out: StreamEvent[] = [];
    for await (const e of iterable) out.push(e);
    return out;
  })();
}

beforeEach(() => {
  geminiStream.mockReset().mockImplementation(() => events({ type: "text_delta", text: "g" }));
  fireworksStream.mockReset().mockImplementation(() => events({ type: "text_delta", text: "f" }));
});

describe("el cerebro del Agente", () => {
  it("por defecto razona con DeepSeek", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(fireworksStream).toHaveBeenCalledTimes(1);
    expect(geminiStream).not.toHaveBeenCalled();
    expect(brain.usesDeepSeek).toBe(true);
  });

  it.each([["gemini"], ["GEMINI"], ["  Gemini  "]])(
    "OPENLEN_AGENT_PROVIDER=%p devuelve el camino de antes",
    async (value) => {
      const brain = createAgentBrain({
        tools: TOOLS,
        requestId: "p1",
        env: { OPENLEN_AGENT_PROVIDER: value },
      });
      await drain(brain.openStream([USER]));
      expect(geminiStream).toHaveBeenCalledTimes(1);
      expect(fireworksStream).not.toHaveBeenCalled();
    },
  );

  // Al razonador de Fireworks nunca se le ha mandado una imagen y la política
  // manda toda imagen a otro papel. Adivinar aquí cuesta la acción del usuario.
  /**
   * ESTO ERA AL REVÉS hasta el 2026-08-21: los píxeles adjuntos caían en Gemini
   * porque al razonador nunca se le manda una imagen. Sigue siendo cierto que al
   * razonador no se le manda — por eso la operación cambia de papel y mira QWEN,
   * que es quien tiene ojos en la política. Gemini se queda para los píxeles.
   */
  it("un turno con píxeles adjuntos va a Qwen, no a Gemini", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    await drain(brain.openStream([USER]));
    expect(geminiStream, "Gemini no debería haber corrido").not.toHaveBeenCalled();
    expect(fireworksStream).toHaveBeenCalledTimes(1);
    expect(fireworksStream.mock.calls[0][0].images).toEqual([IMAGE]);
    // El papel lo decide la operación: sin esto la imagen iría al razonador.
    expect(fireworksStream.mock.calls[0][0].operation).toBe("page_write_with_reference");
  });

  // Los píxeles se anclan al ÚLTIMO mensaje de usuario. En un turno posterior el
  // último mensaje son resultados de herramientas: mandarlos ahí rompería el
  // protocolo de llamadas de Gemini.
  it("los píxeles NO viajan en los turnos siguientes", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    const toolTurn: Message = { role: "user", content: "", functionResponses: [] };
    await drain(brain.openStream([USER, toolTurn]));
    expect(fireworksStream).toHaveBeenCalledTimes(1);
    expect(geminiStream).not.toHaveBeenCalled();
  });

  it("el cierre de turno va sin herramientas", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.closeOut([USER]));
    expect(fireworksStream.mock.calls[0][0].tools).toBeUndefined();

    const gem = createAgentBrain({ tools: TOOLS, requestId: "p1", env: { OPENLEN_AGENT_PROVIDER: "gemini" } });
    await drain(gem.closeOut([USER]));
    expect(geminiStream.mock.calls[0][0].tools).toEqual([]);
    expect(geminiStream.mock.calls[0][0].toolMode).toBe("none");
  });

  it("descarta el canal de pensamiento y deja pasar lo demás", async () => {
    fireworksStream.mockImplementation(async function* () {
      yield { type: "reasoning_delta", text: "pensando en voz alta" };
      yield { type: "text_delta", text: "listo" };
    });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    expect(await drain(brain.openStream([USER]))).toEqual([{ type: "text_delta", text: "listo" }]);
  });
});

// EL MODELO QUE CORRE Y LA TARIFA QUE SE COBRA, ATADOS.
//
// Es el fallo que mordió dos veces el 2026-08-28, las dos por lo mismo: se
// cobraba una cosa distinta de la que se ejecutó (el prompt de ai-design se
// facturaba por una constante 10 KB más gorda; el rediseño exigía una clave de
// un proveedor que no corría). Aquí la trampa es peor porque el hueco es de 6x:
// el Agente corre en Pro, y si alguien mueve MODEL_POLICY.agent sin mover la
// tarifa, el turno se cobra a precio de Flash y nadie se entera.
describe("el Agente corre en Pro y se cobra como Pro", () => {
  it("el modelo del papel `agent` y su tarifa no pueden separarse", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(brain.modelId).toBe(modelIdForRole("agent"));
    expect(brain.modelId).toContain("deepseek-v4-pro");
    expect(brain.creditRate()).toBe("deepseek-pro");
    // Y la tarifa tiene que EXISTIR en la tabla de cobro, no ser un nombre
    // bonito: `creditRate()` devuelve una clave, y una clave que no está en
    // RATES revienta en producción, no aquí.
    expect(creditRate("deepseek-pro")).toEqual({ input: 1.32, output: 3.96, cached: 0.044 });
  });

  it("y NO comparte modelo con el Chat — subir a los cuatro costaría 6x", () => {
    expect(modelIdForRole("agent")).not.toBe(modelIdForRole("reasoner"));
    expect(modelIdForRole(roleForOperation("page_edit"))).toBe(modelIdForRole("reasoner"));
    expect(roleForOperation("agent_turn")).toBe("agent");
  });
});

describe("a qué tarifa se cobra el turno", () => {
  it("un turno entero en DeepSeek se cobra a DeepSeek", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(brain.creditRate()).toBe("deepseek-pro");
  });

  it("con el proveedor forzado a Gemini se cobra Gemini", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: { OPENLEN_AGENT_PROVIDER: "gemini" },
    });
    await drain(brain.openStream([USER]));
    expect(brain.creditRate()).toBe("gemini-flash");
  });

  // La trampa del dinero: DeepSeek encendido PERO el turno cayó a Gemini por
  // llevar imagen. Decidir la tarifa al abrir lo cobraría a una novena parte.
  it("un turno con visión se cobra a tarifa de Qwen, no a la del razonador", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    expect(brain.usesDeepSeek).toBe(true);
    await drain(brain.openStream([USER]));
    const toolTurn: Message = { role: "user", content: "", functionResponses: [] };
    await drain(brain.openStream([USER, toolTurn]));
    // Los dos turnos van por Fireworks: el primero mirando (Qwen), el segundo
    // sólo con resultados de herramientas (razonador).
    expect(geminiStream).not.toHaveBeenCalled();
    expect(fireworksStream).toHaveBeenCalledTimes(2);
    // Qwen cuesta ~10x la salida del razonador: cobrar el turno como si lo
    // hubiera escrito DeepSeek regalaría la diferencia justo en el más caro.
    expect(brain.creditRate()).toBe("qwen-vision");
  });

  it("la tarifa se lee DESPUÉS del turno: antes de abrir nada no compromete nada", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    expect(brain.creditRate()).toBe("deepseek-pro");
    await drain(brain.openStream([USER]));
    expect(brain.creditRate()).toBe("qwen-vision");
  });
});
