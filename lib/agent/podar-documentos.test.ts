// @vitest-environment node
//
// EL DOCUMENTO VIEJO SE VA DEL HISTORIAL.
//
// El bucle del Agente reenvía todo lo acumulado en cada vuelta, y
// `editar_pagina` NO devuelve el documento: el modelo tiene que volver a pedirlo
// con `leer_estado incluir_documento=true` — la instrucción de corrección visual
// se lo ORDENA (loop.ts, buildVisualFixInstruction). Así que un turno que edita
// y luego recibe crítica llevaba DOS documentos completos.
//
// Medido el 2026-08-28 contra las páginas publicadas de verdad: el prefijo fijo
// son 13.036 tokens por vuelta y el documento va de 17k a 308k. El documento
// domina, y la copia vieja es lo único que no compra nada — encima es
// ENGAÑOSA, porque tras una edición los data-op-id cambian y describe un mapa
// que ya no existe.
import { describe, it, expect } from "vitest";
import type { Message } from "@/lib/ai-gateway";
import type { StreamEvent } from "@/lib/ai-gateway";
import { podarDocumentosViejos, runAgentLoop, DOCUMENTO_PODADO } from "./loop";

const done: StreamEvent = { type: "done", stopReason: { kind: "end_turn" } };
const usage = (o: number): StreamEvent => ({
  type: "usage", inputTokens: 100, outputTokens: o, cachedTokens: 0, thinkingTokens: 0,
});

const doc = (n: number) => `<html data-v="${n}">${"x".repeat(500)}</html>`;

function respuesta(name: string, response: Record<string, unknown>): Message {
  return { role: "user", content: "", functionResponses: [{ name, response }] };
}

describe("podar los documentos viejos del historial", () => {
  it("deja SÓLO el último documento y explica por qué se fueron los otros", () => {
    const messages: Message[] = [
      { role: "user", content: "cámbiame el titular" },
      respuesta("leer_estado", { ok: true, documento: doc(1) }),
      respuesta("editar_pagina", { ok: true, aplicadas: 2 }),
      respuesta("leer_estado", { ok: true, documento: doc(2) }),
    ];

    expect(podarDocumentosViejos(messages)).toBe(1);
    expect(messages[1].functionResponses![0].response.documento).toBe(DOCUMENTO_PODADO);
    expect(messages[3].functionResponses![0].response.documento).toBe(doc(2));
    // El aviso tiene que decir QUÉ hacer: un hueco sin explicación invita al
    // modelo a inventarse los ids que ya no ve.
    expect(DOCUMENTO_PODADO).toContain("leer_estado");
    expect(DOCUMENTO_PODADO).toContain("data-op-id");
  });

  it("con un solo documento no toca nada", () => {
    const messages: Message[] = [respuesta("leer_estado", { ok: true, documento: doc(1) })];
    expect(podarDocumentosViejos(messages)).toBe(0);
    expect(messages[0].functionResponses![0].response.documento).toBe(doc(1));
  });

  it("poda TODOS los viejos, no sólo el penúltimo", () => {
    const messages: Message[] = [
      respuesta("leer_estado", { ok: true, documento: doc(1) }),
      respuesta("leer_estado", { ok: true, documento: doc(2) }),
      respuesta("leer_estado", { ok: true, documento: doc(3) }),
      respuesta("leer_estado", { ok: true, documento: doc(4) }),
    ];
    expect(podarDocumentosViejos(messages)).toBe(3);
    expect(messages[3].functionResponses![0].response.documento).toBe(doc(4));
    for (const i of [0, 1, 2]) {
      expect(messages[i].functionResponses![0].response.documento).toBe(DOCUMENTO_PODADO);
    }
  });

  it("varios documentos en la MISMA vuelta: sobrevive el último de la tanda", () => {
    // Pasa de verdad: el modelo puede encadenar trabajar_en_pagina + leer_estado
    // en una sola emisión, y las dos respuestas viajan en el mismo mensaje.
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        functionResponses: [
          { name: "leer_estado", response: { ok: true, documento: doc(1) } },
          { name: "trabajar_en_pagina", response: { ok: true, documento: doc(2) } },
        ],
      },
    ];
    expect(podarDocumentosViejos(messages)).toBe(1);
    const rs = messages[0].functionResponses!;
    expect(rs[0].response.documento).toBe(DOCUMENTO_PODADO);
    expect(rs[1].response.documento).toBe(doc(2));
  });

  it("no toca NADA que no sea un documento", () => {
    // El resto de la respuesta se queda entera: el modelo sigue necesitando
    // saber que la edición se aplicó, cuántas ops entraron y qué falló.
    const messages: Message[] = [
      respuesta("leer_estado", { ok: true, documento: doc(1), paginas: ["principal"], titulo: "Tacos" }),
      respuesta("editar_pagina", { ok: true, aplicadas: 3, aviso: "una op no encontró su id" }),
      respuesta("leer_estado", { ok: true, documento: doc(2) }),
    ];
    podarDocumentosViejos(messages);
    const primera = messages[0].functionResponses![0].response;
    expect(primera.paginas).toEqual(["principal"]);
    expect(primera.titulo).toBe("Tacos");
    expect(messages[1].functionResponses![0].response).toEqual({
      ok: true,
      aplicadas: 3,
      aviso: "una op no encontró su id",
    });
  });

  it("un `documento` que no es texto se ignora en vez de romper", () => {
    const messages: Message[] = [
      respuesta("raro", { ok: true, documento: null }),
      respuesta("leer_estado", { ok: true, documento: doc(1) }),
    ];
    expect(podarDocumentosViejos(messages)).toBe(0);
    expect(messages[0].functionResponses![0].response.documento).toBeNull();
  });

  // LO QUE ESTO AHORRA, con los tamaños reales medidos.
  it("un turno de dos documentos adelgaza ~40%", () => {
    const pagina = "<html>" + "x".repeat(90_000) + "</html>"; // ~22k tokens
    const messages: Message[] = [
      respuesta("leer_estado", { ok: true, documento: pagina }),
      respuesta("editar_pagina", { ok: true }),
      respuesta("leer_estado", { ok: true, documento: pagina }),
    ];
    const antes = JSON.stringify(messages).length;
    podarDocumentosViejos(messages);
    const despues = JSON.stringify(messages).length;
    expect(despues).toBeLessThan(antes * 0.55);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Y EL CABLE, no sólo la función.
//
// La primera versión de estas pruebas dejaba `podarDocumentosViejos` vigilada y
// su LLAMADA suelta: comentando la línea del bucle, las siete pasaban y
// `loop.test.ts` pasaba entero (32/32). Una función correcta que nadie invoca
// es el mismo fallo silencioso que este arreglo existe para quitar.
//
// Esto conduce el bucle DE VERDAD con un modelo guionizado y mira el historial
// que se le manda en la última vuelta.
describe("el bucle poda de verdad, no sólo sabría podar", () => {
  // SIN comillas dentro: se comparan contra el historial serializado, y
  // `JSON.stringify` las escapa — la primera versión de esta prueba falló por
  // eso y no por el código.
  const DOC1 = `<html data-v=uno>${"a".repeat(400)}</html>`;
  const DOC2 = `<html data-v=dos>${"b".repeat(400)}</html>`;

  it("en la segunda lectura, el documento de la primera ya no viaja", async () => {
    const historiales: Message[][] = [];
    let vuelta = 0;
    const openStream = (messages: Message[]) => {
      // Copia PROFUNDA: el bucle muta los objetos que ya empujó, así que una
      // copia superficial enseñaría el estado final y esta prueba pasaría sola.
      historiales.push(JSON.parse(JSON.stringify(messages)) as Message[]);
      vuelta += 1;
      const guion: StreamEvent[][] = [
        [{ type: "function_call", name: "leer_estado", args: { incluir_documento: true } }, usage(5), done],
        [{ type: "function_call", name: "editar_pagina", args: {} }, usage(5), done],
        [{ type: "function_call", name: "leer_estado", args: { incluir_documento: true } }, usage(5), done],
        [{ type: "text_delta", text: "listo" }, usage(5), done],
      ];
      const turno = guion[Math.min(vuelta - 1, guion.length - 1)];
      return (async function* () { for (const ev of turno) yield ev; })();
    };

    let lecturas = 0;
    await runAgentLoop({
      messages: [{ role: "user", content: "cambia el titular" }],
      tools: [],
      openStream,
      runTool: async (name) => {
        if (name === "leer_estado") {
          lecturas += 1;
          return { response: { ok: true, documento: lecturas === 1 ? DOC1 : DOC2 } };
        }
        return { response: { ok: true, aplicadas: 1 } };
      },
      emit: () => {},
    });

    // El último historial es el que el modelo vio para cerrar el turno.
    const ultimo = JSON.stringify(historiales[historiales.length - 1]);
    expect(ultimo).not.toContain(DOC1);
    expect(ultimo).toContain(DOC2);
    expect(ultimo).toContain(DOCUMENTO_PODADO);
  });
});
