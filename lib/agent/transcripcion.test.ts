import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";
import {
  NO_CABE,
  RESULTADO_VACIADO,
  historialDesdeLaBase,
  leidosSembrados,
  transcripcionParaGuardar,
  type FilaDelHistorial,
} from "./transcripcion";
import { turnoAnteriorMudoDe, ventanaVisibleDe } from "./historial-saneado";

// H4, parte 3 (plans/len-2/hipotesis/H4-alcance-prompt-e-historial.md): el
// historial sale de la BASE, escrito por el servidor, con los argumentos de
// cada llamada y sus resultados, como la transcripción de Claude Code; los
// resultados viejos se vacían con su marca (`[Old tool result content
// cleared]`, como Claude Code) en vez de resumirse.

const PAGINA = "<!doctype html><html><body><h1>Taquería</h1></body></html>";
const leer = (ruta: string, texto: string): Message[] => [
  { role: "assistant", content: "", functionCalls: [{ name: "Read", args: { file_path: ruta } }] },
  { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true, tool_result: texto } }] },
];
const fila = (userText: string, mensajes: Message[] | null, assistantReasoning = ""): FilaDelHistorial => ({
  userText,
  assistantReasoning,
  transcript: mensajes ? { mensajes, leidos: [] } : null,
});

describe("historialDesdeLaBase", () => {
  it("cada turno es la petición del dueño más lo que pasó, con los argumentos enteros", () => {
    const h = historialDesdeLaBase([
      fila("cambia el título", [
        ...leer("/index.html", `1\t${PAGINA}`),
        { role: "assistant", content: "", functionCalls: [{ name: "Edit", args: { file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" } }] },
        { role: "user", content: "", functionResponses: [{ name: "Edit", response: { ok: true, tool_result: "Edited /index.html." } }] },
        { role: "assistant", content: "Listo: el título dice El Farol." },
      ]),
    ]);
    expect(h[0]).toEqual({ role: "user", content: "cambia el título" });
    expect(h[3]!.functionCalls![0]!.args).toEqual({ file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" });
    expect(h.at(-1)).toEqual({ role: "assistant", content: "Listo: el título dice El Farol." });
  });

  it("una fila sin transcripción (anterior a H4, o del Chat) cae a su texto", () => {
    const h = historialDesdeLaBase([fila("hola", null, "Hola, ¿qué cambiamos?")]);
    expect(h).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "Hola, ¿qué cambiamos?" },
    ]);
  });

  it("🔴 los resultados MÁS VIEJOS se vacían con la marca de Claude Code; los recientes se quedan enteros", () => {
    const grande = "x".repeat(600);
    const h = historialDesdeLaBase(
      [fila("uno", leer("/a/index.html", grande)), fila("dos", leer("/b/index.html", grande))],
      1000,
    );
    const respuestas = h.flatMap((m) => m.functionResponses ?? []);
    expect(respuestas[0]!.response.tool_result).toBe(RESULTADO_VACIADO);
    expect(respuestas[1]!.response.tool_result).toBe(grande);
    // La LLAMADA se queda: se sabe qué se leyó, aunque no se vea el contenido.
    expect(h[1]!.functionCalls![0]!.args).toEqual({ file_path: "/a/index.html" });
  });

  it("CONTRA-PRUEBA: con presupuesto de sobra no se vacía nada", () => {
    const h = historialDesdeLaBase([fila("uno", leer("/a/index.html", "abc")), fila("dos", leer("/b/index.html", "def"))], 1000);
    expect(h.flatMap((m) => m.functionResponses ?? []).map((r) => r.response.tool_result)).toEqual(["abc", "def"]);
  });
});

describe("transcripcionParaGuardar y leidosSembrados — lo leído dura la conversación", () => {
  it("guarda la huella de lo leído, no el contenido", () => {
    const t = transcripcionParaGuardar([], new Map([["/index.html", { instantanea: PAGINA, offset: undefined, limit: undefined }]]));
    expect(t.leidos).toHaveLength(1);
    expect(t.leidos[0]!.ruta).toBe("/index.html");
    expect(JSON.stringify(t)).not.toContain("Taquería");
  });

  it("🔴 un fichero que NO cambió y cuyo resultado sigue a la vista cuenta como leído en el turno siguiente", () => {
    const t = transcripcionParaGuardar(leer("/index.html", PAGINA), new Map([["/index.html", { instantanea: PAGINA, offset: undefined, limit: undefined }]]));
    const historial = historialDesdeLaBase([{ userText: "x", assistantReasoning: "", transcript: t }]);
    const leidos = leidosSembrados(t.leidos, historial, (ruta) => (ruta === "/index.html" ? PAGINA : null));
    expect(leidos.get("/index.html")?.instantanea).toBe(PAGINA);
  });

  it("CONTRA-PRUEBA: si el dueño lo cambió entre turnos, NO cuenta como leído (hay que releerlo)", () => {
    const t = transcripcionParaGuardar(leer("/index.html", PAGINA), new Map([["/index.html", { instantanea: PAGINA, offset: undefined, limit: undefined }]]));
    const historial = historialDesdeLaBase([{ userText: "x", assistantReasoning: "", transcript: t }]);
    const leidos = leidosSembrados(t.leidos, historial, () => PAGINA.replace("Taquería", "Otra cosa"));
    expect(leidos.has("/index.html")).toBe(false);
  });

  it("CONTRA-PRUEBA: si su resultado ya se vació, tampoco (el modelo no lo tiene delante)", () => {
    const t = transcripcionParaGuardar(leer("/index.html", PAGINA), new Map([["/index.html", { instantanea: PAGINA, offset: undefined, limit: undefined }]]));
    const historial = historialDesdeLaBase([{ userText: "x", assistantReasoning: "", transcript: t }], 1);
    const leidos = leidosSembrados(t.leidos, historial, () => PAGINA);
    expect(leidos.has("/index.html")).toBe(false);
  });

  it("no guarda imágenes en línea: la transcripción no carga píxeles", () => {
    const t = transcripcionParaGuardar(
      [{ role: "user", content: "mira", images: [{ mimeType: "image/png", data: "AAAA" }] } as unknown as Message],
      new Map(),
    );
    expect(JSON.stringify(t)).not.toContain("AAAA");
  });

  // H15 es la fase 1: lo pensado vuelve DENTRO del turno. Guardarlo para los
  // turnos siguientes (la fase 2) es otra decisión de Jesús: que no entre por la
  // puerta de atrás de la transcripción.
  it("no guarda el razonamiento: entre turnos no vuelve (fase 2 sin decidir)", () => {
    const t = transcripcionParaGuardar(
      [{ role: "user", content: "x" }, { role: "assistant", content: "listo", reasoning: "PENSADO-DEL-PASO" }],
      new Map(),
    );
    expect(JSON.stringify(t)).not.toContain("PENSADO-DEL-PASO");
    expect(t.mensajes[1]).toEqual({ role: "assistant", content: "listo" });
  });
});

// El aviso de «el turno anterior fue mudo» miraba el ÚLTIMO mensaje del
// asistente. En el historial del navegador las llamadas iban en ese mensaje; en
// la transcripción, el último es el texto final y las llamadas van antes. Mirado
// igual, TODOS los turnos habrían salido mudos.
describe("turnoAnteriorMudoDe — con el historial del navegador y con el de la base", () => {
  it("🔴 un turno de la base que llamó a herramientas NO es mudo aunque cierre con texto", () => {
    const h = historialDesdeLaBase([fila("cambia el título", [...leer("/index.html", PAGINA), { role: "assistant", content: "Listo." }])]);
    expect(turnoAnteriorMudoDe(h)).toBe(false);
  });

  // E del 26/09: la respuesta de herramientas viaja con lo medido tras editar
  // al lado (`<medido-tras-editar>`, `aviso-medido.ts`), así que su `content` NO
  // está vacío. Se tomaba por la petición del dueño, el «Listo.» de después
  // quedaba sin llamadas y el turno salía mudo: 122 de 282 peticiones de la rama
  // recibieron «tu turno anterior NO llamó a ninguna herramienta… aplícalo AHORA».
  it("🔴 la respuesta de herramientas con lo medido al lado no es la petición del dueño", () => {
    const h = historialDesdeLaBase([
      fila("cambia el título", [
        ...leer("/index.html", PAGINA),
        { role: "assistant", content: "", functionCalls: [{ name: "Edit", args: { file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" } }] },
        {
          role: "user",
          content: "<medido-tras-editar>\nEl navegador midió /index.html y no encontró defectos.\n</medido-tras-editar>",
          functionResponses: [{ name: "Edit", response: { ok: true, tool_result: "Edited /index.html." } }],
        },
        { role: "assistant", content: "Listo." },
      ]),
    ]);
    expect(turnoAnteriorMudoDe(h)).toBe(false);
    // …y por la misma razón la ventana cuenta UN turno del dueño, no dos.
    expect(ventanaVisibleDe(h)).toBe(1);
  });

  it("uno de la base que sólo habló, sí", () => {
    expect(turnoAnteriorMudoDe(historialDesdeLaBase([fila("hola", [{ role: "assistant", content: "¡Hola!" }])]))).toBe(true);
  });

  it("CONTRA-PRUEBA: el formato del navegador se lee como antes", () => {
    const conLlamada = [
      { role: "user" as const, content: "cambia" },
      { role: "assistant" as const, content: "Listo.", functionCalls: [{ name: "Edit", args: {} }] },
      { role: "user" as const, content: "", functionResponses: [{ name: "Edit", response: { ok: true, resumen: "index.html" } }] },
    ];
    expect(turnoAnteriorMudoDe(conLlamada)).toBe(false);
    expect(turnoAnteriorMudoDe([{ role: "user", content: "hola" }, { role: "assistant", content: "¡Hola!" }])).toBe(true);
    expect(turnoAnteriorMudoDe([])).toBe(false);
  });
});

// A (plan 2026-10-01-len-foto-en-la-conversacion): la foto que mandó el dueño
// sigue en la conversación, pegada a SU mensaje de ese turno y con una nota de
// dónde vive — como una imagen pegada en Claude Code. Antes el historial se
// rehacía sin ella y Len decía «la nueva no me llegó».
describe("la foto sigue en la conversación (como Claude Code)", () => {
  const FOTO = { mimeType: "image/jpeg", dataBase64: "AAAA" };
  const conFoto = (url: string, alt?: string): FilaDelHistorial => ({
    ...fila("¿dónde la pondrías?", [{ role: "assistant", content: "1. En la portada" }]),
    attachedImage: alt ? { url, alt } : { url },
  });

  it("tu mensaje de ese turno lleva la nota con la dirección y los píxeles", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg")], undefined, new Map([["https://u/f.jpg", FOTO]]));
    expect(h[0]).toEqual({ role: "user", content: "¿dónde la pondrías?\n\n[Foto adjunta: https://u/f.jpg]", images: [FOTO] });
    expect(h[1]).toEqual({ role: "assistant", content: "1. En la portada" });
  });

  it("con texto alt, la nota lo lleva", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg", "mi tienda")], undefined, new Map([["https://u/f.jpg", FOTO]]));
    expect(h[0]!.content).toBe("¿dónde la pondrías?\n\n[Foto adjunta: https://u/f.jpg — «mi tienda»]");
  });

  it("si no se pudo descargar, la nota lo dice y la dirección se queda", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg")], undefined, new Map([["https://u/f.jpg", null]]));
    expect(h[0]).toEqual({ role: "user", content: "¿dónde la pondrías?\n\n[Foto adjunta: https://u/f.jpg (no se pudo cargar para verla)]" });
  });

  it("si no cabía con las demás (presupuesto de imagen, como DeepSeek), va sin píxeles y la nota lo dice; la dirección se queda", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg")], undefined, new Map([["https://u/f.jpg", NO_CABE]]));
    expect(h[0]).toEqual({
      role: "user",
      content: "¿dónde la pondrías?\n\n[Foto adjunta: https://u/f.jpg (no está a la vista: no cabía con las demás; la dirección sirve igual)]",
    });
  });

  it("un turno sin foto queda exactamente igual que antes", () => {
    expect(historialDesdeLaBase([fila("hola", null, "¡Hola!")], undefined, new Map())).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
    ]);
  });

  it("🔴 los píxeles nunca se guardan: la transcripción del turno sólo lleva texto", () => {
    const t = transcripcionParaGuardar(
      [{ role: "user", content: "mira", images: [FOTO] }, { role: "assistant", content: "la vi" }],
      new Map(),
    );
    expect(JSON.stringify(t)).not.toContain("AAAA");
  });
});
