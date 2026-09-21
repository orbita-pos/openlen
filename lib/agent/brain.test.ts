import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InlineImage, Message, StreamEvent } from "@/lib/ai-gateway";
import { MODEL_POLICY, modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";
import { creditRate } from "@/lib/credits";

const fireworksStream = vi.fn();

vi.mock("@/lib/ai/fireworks-stream-client", () => ({
  createFireworksStreamClient: () => ({
    stream: (request: unknown, opts: unknown) => fireworksStream(request, opts),
  }),
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
  fireworksStream.mockReset().mockImplementation(() => events({ type: "text_delta", text: "f" }));
});

describe("el cerebro del Agente", () => {
  it("por defecto razona con DeepSeek", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(fireworksStream).toHaveBeenCalledTimes(1);
  });

  // LA PALANCA YA NO DESVIA A NADIE. Aqui habia tres casos —"gemini", "GEMINI"
  // y "  Gemini  "— comprobando que el literal devolvia el turno a Gemini. Con
  // el proveedor fuera (2026-08-28) esto es su lapida: se ponen los MISMOS
  // valores y el turno sigue yendo por Fireworks.
  it.each([["gemini"], ["GEMINI"], ["  Gemini  "]])(
    "OPENLEN_AGENT_PROVIDER=%p ya no desvia el turno",
    async (value) => {
      const brain = createAgentBrain({
        tools: TOOLS,
        requestId: "p1",
        env: { OPENLEN_AGENT_PROVIDER: value },
      });
      await drain(brain.openStream([USER]));
      expect(fireworksStream).toHaveBeenCalledTimes(1);
    },
  );

  // Al razonador de Fireworks nunca se le ha mandado una imagen y la política
  // manda toda imagen a otro papel. Adivinar aquí cuesta la acción del usuario.
  /**
   * ESTO ERA AL REVÉS hasta el 2026-08-21: los píxeles adjuntos caían en Gemini
   * porque al razonador nunca se le manda una imagen. Sigue siendo cierto que al
   * razonador no se le manda — por eso la operacion cambia al PAPEL CON VISION,
   * que es quien tiene ojos en la política. Gemini se queda para los píxeles.
   */
  it("un turno con pixeles adjuntos va al papel con vision, no a Gemini", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    await drain(brain.openStream([USER]));
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
  });

  it("el cierre de turno va sin herramientas", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.closeOut([USER]));
    expect(fireworksStream.mock.calls[0][0].tools).toBeUndefined();
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

// LA POSTURA RESUELTA LLEGA A LA PETICIÓN — Task 5, R9/R10.
//
// `esfuerzoEfectivo` y `esfuerzoDisponible` ya tienen su propia suite; aquí
// sólo se comprueba que `brain.ts` las conecta: la palanca de entorno gana, la
// ausencia de todo resuelve a "auto", y un turno con imagen (que corre en el
// papel con visión, no en el Agente) no lleva el campo en absoluto.
describe("la POSTURA del turno viaja en la petición", () => {
  it("la palanca de entorno (OPENLEN_AGENT_EFFORT) gana a la preferencia guardada", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: { OPENLEN_AGENT_EFFORT: "high" },
      esfuerzoDelUsuario: "low",
    });
    await drain(brain.openStream([USER]));
    expect(fireworksStream.mock.calls[0][0].esfuerzo).toBe("high");
  });

  it("sin nada puesto, el turno lleva \"auto\"", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(fireworksStream.mock.calls[0][0].esfuerzo).toBe("auto");
  });

  it("un turno con imagen adjunta (page_write_with_reference) no lleva esfuerzo", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      esfuerzoDelUsuario: "high",
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    await drain(brain.openStream([USER]));
    expect(fireworksStream.mock.calls[0][0].operation).toBe("page_write_with_reference");
    expect(fireworksStream.mock.calls[0][0]).not.toHaveProperty("esfuerzo");
  });

  // Fix round 2 — Finding 3 (R10). Las tres pruebas de arriba sólo abren
  // `openStream`: sin ésta, un refactor que le diera a `closeOut` su propia
  // postura — o su propia operación — pasaría en verde. El cierre por tope
  // debe cargar EXACTAMENTE la misma postura que el resto del turno.
  it("`closeOut` lleva la MISMA postura que el turno, y la misma operación", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      esfuerzoDelUsuario: "medium",
    });
    await drain(brain.closeOut([USER]));
    expect(fireworksStream.mock.calls[0][0].esfuerzo).toBe("medium");
    expect(fireworksStream.mock.calls[0][0].operation).toBe("agent_turn");
  });
});

// EL MODELO QUE CORRE Y LA TARIFA QUE SE COBRA, ATADOS.
//
// Es el fallo que mordió dos veces el 2026-08-28, las dos por lo mismo: se
// cobraba una cosa distinta de la que se ejecutó (el prompt de ai-design se
// facturaba por una constante 10 KB más gorda; el rediseño exigía una clave de
// un proveedor que no corría). Aquí la trampa es peor porque el hueco es de 6x:
// el Agente corría en Pro, y si alguien movía MODEL_POLICY.agent sin mover la
// tarifa, el turno se cobraba a precio de Flash y nadie se enteraba.
//
// 🔴 2026-09-11 — ESTA PRUEBA YA NO FIJA UN NOMBRE, Y ES A PROPÓSITO. Fijaba
// `deepseek-v4-pro` y la tarifa `deepseek-pro` literales, y se puso roja en
// cuanto el papel `agent` cambió a v4.1 Flash — que es justo su trabajo. Pero
// lo que vigilaba —que modelo y tarifa no se separen— ya no depende de que
// alguien se acuerde: la tarifa VIAJA DENTRO del papel
// (`MODEL_POLICY.agent.creditRate`) y los dos consumidores la leen de ahí.
// Volver a escribir un nombre aquí sería recrear el hueco que la extracción
// acaba de cerrar, y además dejaría esta prueba roja en el próximo cambio de
// modelo sin que nada estuviera mal. Se afirma el INVARIANTE.
describe("el modelo del papel `agent` y su tarifa no pueden separarse", () => {
  it("el cerebro cobra EXACTAMENTE la tarifa que declara el papel", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(brain.modelId).toBe(modelIdForRole("agent"));
    expect(brain.creditRate()).toBe(MODEL_POLICY.agent.creditRate);
    // Y la tarifa tiene que EXISTIR en la tabla de cobro, no ser un nombre
    // bonito: `creditRate()` devuelve una clave, y una clave que no está en
    // RATES revienta en producción, no aquí.
    const tarifa = creditRate(MODEL_POLICY.agent.creditRate);
    expect(tarifa.input).toBeGreaterThan(0);
    expect(tarifa.output).toBeGreaterThan(0);
  });

  // ⚰️ AQUÍ SE AFIRMABA QUE EL CHAT CORRE EL MODELO DEL RAZONADOR
  // (`modelIdForRole(roleForOperation("page_edit"))` === el del razonador).
  // Dejó de ser cierto el 2026-09-20: `page_edit` pasó al papel con visión por
  // decisión de Jesús, así que el Chat corre V4.1 como Crear.
  //
  // 🔴 Y SE AFIRMA EL PAPEL, NO EL MODELO, que es la lección de la cabecera de
  // este bloque aplicada una vez más. Hoy `agent` y el Chat comparten MODELO
  // (los dos en v4.1 Flash) y eso no rompe nada — `agent` ya lo compartía con
  // `visualCritic` desde el 2026-09-12. Lo que tiene que seguir siendo verdad,
  // corra quien corra, es que el Agente tenga PAPEL PROPIO: es lo que permite
  // moverlo sin arrastrar al Chat, y al revés. Un modelo compartido es una
  // coincidencia de hoy; un papel compartido sería un diseño perdido.
  it("el papel `agent` es SUYO: se puede mover sin arrastrar al Chat", () => {
    expect(roleForOperation("agent_turn")).toBe("agent");
    expect(roleForOperation("agent_turn")).not.toBe(roleForOperation("page_edit"));
  });
});

describe("a qué tarifa se cobra el turno", () => {
  it("un turno entero en DeepSeek se cobra a DeepSeek", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER]));
    expect(brain.creditRate()).toBe(MODEL_POLICY.agent.creditRate);
  });


  // La trampa del dinero: el turno lo lleva el papel con VISION por traer
  // cuesta ~10x la salida del razonador. Decidir la tarifa al ABRIR lo cobraria
  // como si lo hubiera escrito DeepSeek.
  it("un turno con vision se cobra a la tarifa del papel que MIRO", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    await drain(brain.openStream([USER]));
    const toolTurn: Message = { role: "user", content: "", functionResponses: [] };
    await drain(brain.openStream([USER, toolTurn]));
    // Los dos turnos van por Fireworks: el primero mirando (el papel con
    // visión), el segundo sólo con resultados de herramientas (razonador).
    expect(fireworksStream).toHaveBeenCalledTimes(2);
    // La tarifa la paga el papel que corrió. Se PREGUNTA a la política en vez
    // de escribir el literal: decía `"qwen-vision"` y el 2026-09-12 dejó de ser
    // cierto —el papel con visión cambió de modelo y de tarifa—.
    //
    // ⚠️ Y ESTA AFIRMACIÓN ES HOY MÁS DÉBIL DE LO QUE PARECE, dicho aquí para
    // que nadie la lea de más: `visualCritic` y `agent` comparten modelo y por
    // tanto tarifa, así que esta línea ya no puede distinguir «cobró por el que
    // miró» de «cobró por el del Agente». Vuelve a discriminar sola en cuanto
    // los dos papeles se separen, que es justo por lo que se lee de la política.
    expect(brain.creditRate()).toBe(MODEL_POLICY.visualCritic.creditRate);
  });

  it("la tarifa se lee DESPUÉS del turno: antes de abrir nada no compromete nada", async () => {
    const brain = createAgentBrain({
      tools: TOOLS,
      requestId: "p1",
      env: {},
      attachedImage: { image: IMAGE, anchorMessage: USER },
    });
    expect(brain.creditRate()).toBe(MODEL_POLICY.agent.creditRate);
    await drain(brain.openStream([USER]));
    expect(brain.creditRate()).toBe(MODEL_POLICY.visualCritic.creditRate);
  });
});
