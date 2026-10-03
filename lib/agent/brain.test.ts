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


const { createAgentBrain, operacionDeLaVuelta } = await import("./brain");

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

  // ⚰️ AQUÍ HABÍA DOS PRUEBAS de la foto anclada a la PRIMERA vuelta («un turno
  // con pixeles adjuntos va al papel con vision» y «los píxeles NO viajan en
  // los turnos siguientes»). Era el comportamiento que A retira (plan
  // 2026-10-01-len-foto-en-la-conversacion): la foto va pegada a tu mensaje y
  // viaja en todas las vueltas, como una imagen pegada en Claude Code. Las
  // pruebas nuevas están en «la foto en la conversación», abajo.

  it("el cierre de turno va sin herramientas", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.closeOut([USER]));
    expect(fireworksStream.mock.calls[0][0].tools).toBeUndefined();
  });

  // 🔴 H15 (01/10): el razonamiento LLEGA al loop, para que vuelva al modelo en
  // el paso siguiente. En UN evento por respuesta y byte a byte, como el
  // `translate.ts` de DeepSeek junta el canal entero en un bloque (y así la
  // grabación no se llena de trocitos). Al dueño no: el loop no lo emite.
  it("🔴 junta el razonamiento en UN evento entero antes del done, y lo demás pasa igual", async () => {
    fireworksStream.mockImplementation(async function* () {
      yield { type: "reasoning_delta", text: "pensando " };
      yield { type: "reasoning_delta", text: "en voz alta" };
      yield { type: "text_delta", text: "listo" };
      yield { type: "done", stopReason: { kind: "end_turn" } };
    });
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    expect(await drain(brain.openStream([USER]))).toEqual([
      { type: "text_delta", text: "listo" },
      { type: "reasoning", text: "pensando en voz alta" },
      { type: "done", stopReason: { kind: "end_turn" } },
    ]);
  });

  it("una respuesta que no pensó no trae evento de razonamiento", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    expect(await drain(brain.openStream([USER]))).toEqual([{ type: "text_delta", text: "f" }]);
  });
});

// LA POSTURA RESUELTA LLEGA A LA PETICIÓN — Task 5, R9/R10.
//
// `esfuerzoEfectivo` y `esfuerzoDisponible` ya tienen su propia suite; aquí
// sólo se comprueba que `brain.ts` las conecta: la palanca de entorno gana y la
// ausencia de todo resuelve a "auto". Una vuelta con fotos también la lleva
// mientras el agente vea (A, «la foto en la conversación», más abajo).
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

// LEN DYNAMIS (`lib/agent/dynamis.ts`): la receta del modo Minimal de DeepSeek
// llega al cable entera, en el turno y en el cierre; sin el modo, nada cambia.
describe("Len Dynamis en el cable", () => {
  const pedido = (i = 0) => fireworksStream.mock.calls[i][0];

  it("temperatura 1,0, la palabra \"max\" y 65.536 de salida", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, mode: "dynamis" });
    await drain(brain.openStream([USER]));
    expect(pedido().temperature).toBe(1);
    expect(pedido().reasoningEffortWord).toBe("max");
    expect(pedido().maxOutputTokens).toBe(65_536);
  });

  it("el cierre también: con el razonamiento al máximo, 2.048 se irían en pensar", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, mode: "dynamis" });
    await drain(brain.closeOut([USER]));
    expect(pedido().temperature).toBe(1);
    expect(pedido().reasoningEffortWord).toBe("max");
    expect(pedido().maxOutputTokens).toBe(65_536);
    expect(pedido().tools).toBeUndefined();
  });

  it("la preferencia guardada no lo baja: el modo es la postura del turno", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, mode: "dynamis", esfuerzoDelUsuario: "low" });
    await drain(brain.openStream([USER]));
    expect(pedido().reasoningEffortWord).toBe("max");
  });

  it("el operador sigue por encima: con OPENLEN_AGENT_EFFORT clavado no va la palabra", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: { OPENLEN_AGENT_EFFORT: "low" }, mode: "dynamis" });
    await drain(brain.openStream([USER]));
    expect(pedido().reasoningEffortWord).toBeUndefined();
    expect(pedido().esfuerzo).toBe("low");
    // El resto de la receta se queda.
    expect(pedido().temperature).toBe(1);
  });

  it("BRAZO DE CONTROL: sin el modo (o con \"len\"), 0,2, sin palabra y los techos de siempre", async () => {
    for (const mode of [undefined, "len"] as const) {
      fireworksStream.mockClear();
      const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, ...(mode ? { mode } : {}) });
      await drain(brain.openStream([USER]));
      await drain(brain.closeOut([USER]));
      expect(pedido(0).temperature).toBe(0.2);
      expect(pedido(0).maxOutputTokens).toBe(32_768);
      expect(pedido(1).maxOutputTokens).toBe(2_048);
      expect("reasoningEffortWord" in pedido(0)).toBe(false);
      expect("reasoningEffortWord" in pedido(1)).toBe(false);
    }
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


  // ⚰️ AQUÍ HABÍA DOS PRUEBAS de «un turno con visión se cobra a la tarifa del
  // papel que MIRÓ». Con A, una vuelta con fotos sigue siendo del agente
  // mientras su modelo vea (`MODEL_POLICY.agent.veImagenes`), así que se cobra a
  // SU tarifa: lo afirma «el agente ve…» en «la foto en la conversación». El
  // reparto por papel sigue vivo para el día que el agente no vea
  // (`operacionDeLaVuelta`), y entonces `mirado` vuelve a mandar.
});

// A (plan 2026-10-01-len-foto-en-la-conversacion): la foto que mandó el dueño
// va pegada a SU mensaje y viaja en todas las vueltas y en el cierre, como una
// imagen pegada en Claude Code. Antes iba sólo en la primera vuelta.
describe("la foto en la conversación (como Claude Code)", () => {
  const USER_CON_FOTO: Message = { role: "user", content: "¿dónde la pondrías?", images: [IMAGE] };
  const VUELTA: Message = { role: "user", content: "", functionResponses: [] };

  it("viaja en TODAS las vueltas, no sólo en la primera", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.openStream([USER_CON_FOTO, VUELTA]));
    expect(fireworksStream.mock.calls[0][0].messages[0].images).toEqual([IMAGE]);
  });

  it("y en el cierre", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {} });
    await drain(brain.closeOut([USER_CON_FOTO, VUELTA]));
    expect(fireworksStream.mock.calls[0][0].messages[0].images).toEqual([IMAGE]);
  });

  it("el agente ve: la vuelta con fotos sigue siendo suya, con el esfuerzo del usuario, y se cobra a su tarifa", async () => {
    const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, esfuerzoDelUsuario: "high" });
    await drain(brain.openStream([USER_CON_FOTO]));
    expect(fireworksStream.mock.calls[0][0].operation).toBe("agent_turn");
    expect(fireworksStream.mock.calls[0][0].esfuerzo).toBe("high");
    // Ya no por el canal del ÚLTIMO mensaje: va dentro del suyo.
    expect(fireworksStream.mock.calls[0][0]).not.toHaveProperty("images");
    expect(brain.creditRate()).toBe(MODEL_POLICY.agent.creditRate);
  });
});

describe("operacionDeLaVuelta", () => {
  it("sin fotos, siempre el agente", () => {
    expect(operacionDeLaVuelta(false, false)).toBe("agent_turn");
    expect(operacionDeLaVuelta(false, true)).toBe("agent_turn");
  });

  it("con fotos y un agente que ve, el agente; si no ve, el papel con visión", () => {
    expect(operacionDeLaVuelta(true, true)).toBe("agent_turn");
    expect(operacionDeLaVuelta(true, false)).toBe("page_write_with_reference");
  });

  it("hoy la política dice que el agente ve (medido en Fireworks el 01/10)", () => {
    expect(MODEL_POLICY.agent.veImagenes).toBe(true);
  });
});

// 🔴 E del 26/09: con H5 el modelo puede pensar minutos seguidos, y el
// razonamiento se descartaba ANTES de llegar al reloj de silencio de la ruta
// (H1, 180 s sin señal = cuelgue). Dos turnos se cancelaron así en plena
// reflexión. En Claude Code pensar es actividad visible; aquí sigue sin verse,
// pero rearma el reloj.
describe("el razonamiento es señal de vida para el reloj de silencio", () => {
  async function* pensandoLargo(): AsyncIterable<unknown> {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 600));
      yield { type: "reasoning_delta", text: "pienso" };
    }
    yield { type: "text_delta", text: "listo" };
  }
  async function correr(conSenal: boolean) {
    vi.useFakeTimers();
    try {
      const { relojDeSilencio } = await import("./reloj-de-silencio");
      const callado = vi.fn();
      const reloj = relojDeSilencio(1_000, callado);
      fireworksStream.mockImplementation(() => pensandoLargo());
      const brain = createAgentBrain({ tools: TOOLS, requestId: "p1", env: {}, ...(conSenal ? { alPensar: reloj.vivo } : {}) });
      const salida: StreamEvent[] = [];
      const consumir = (async () => {
        for await (const e of brain.openStream([USER])) salida.push(e);
      })();
      await vi.advanceTimersByTimeAsync(3_500);
      await consumir;
      reloj.parar();
      return { callado, salida };
    } finally {
      vi.useRealTimers();
    }
  }
  it("🔴 pensar más que el reloj NO cancela el turno, y el razonamiento llega al loop en un solo evento", async () => {
    const { callado, salida } = await correr(true);
    expect(callado).not.toHaveBeenCalled();
    expect(salida).toEqual([{ type: "text_delta", text: "listo" }, { type: "reasoning", text: "pienso".repeat(5) }]);
  });
  it("BRAZO DE CONTROL: sin la señal, el mismo razonamiento dispara el reloj", async () => {
    const { callado } = await correr(false);
    expect(callado).toHaveBeenCalled();
  });
});
