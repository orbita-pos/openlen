import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";
import {
  MARCA_DE_TURNO_DETENIDO,
  NO_CABE,
  RESULTADO_VACIADO,
  historialDesdeLaBase,
  leidosSembrados,
  stateOnlyTranscript,
  textoDelHistorial,
  transcripcionParaGuardar,
  type FilaDelHistorial,
} from "./transcripcion";
import { turnoAnteriorMudoDe, ventanaVisibleDe } from "./historial-saneado";
import { CLAVE_TOOL_RESULT } from "./ficheros/resultado";
import { CLAVE_CAMBIOS_DEL_COMANDO } from "./terminal/cambios-del-comando";

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
  it("LEN.md: el mensaje de memoria de un turno vuelve en SU sitio, antes de las palabras del dueño, igual que se mandó", () => {
    const memoria = "<system-reminder>\nContents of /LEN.md (project instructions):\n\nTono formal.\n</system-reminder>\n";
    const h = historialDesdeLaBase([
      { userText: "Hola", assistantReasoning: "", transcript: { mensajes: [{ role: "assistant", content: "¡Hola!" }], leidos: [], memoria, memoriaHuellas: { "/LEN.md": "x" } } },
    ]);
    expect(h[0]).toEqual({ role: "user", content: memoria });
    expect(h[1]).toMatchObject({ role: "user", content: "Hola", opensTurn: true });
  });

  it("cada turno es la petición del dueño más lo que pasó, con los argumentos enteros", () => {
    const h = historialDesdeLaBase([
      fila("cambia el título", [
        ...leer("/index.html", `1\t${PAGINA}`),
        { role: "assistant", content: "", functionCalls: [{ name: "Edit", args: { file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" } }] },
        { role: "user", content: "", functionResponses: [{ name: "Edit", response: { ok: true, tool_result: "Edited /index.html." } }] },
        { role: "assistant", content: "Listo: el título dice El Farol." },
      ]),
    ]);
    // `opensTurn` (N39): la petición del dueño que abrió el turno. No va al modelo.
    expect(h[0]).toEqual({ role: "user", content: "cambia el título", opensTurn: true });
    expect(h[3]!.functionCalls![0]!.args).toEqual({ file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" });
    expect(h.at(-1)).toEqual({ role: "assistant", content: "Listo: el título dice El Farol." });
  });

  it("pieza 3: una conversación vieja con `preguntar` vuelve con el nombre y la forma de ask_user_question", () => {
    const h = historialDesdeLaBase([
      fila("publícala", [
        { role: "assistant", content: "", functionCalls: [{ name: "preguntar", args: { texto: "¿Qué dirección quieres?" } }] },
        { role: "user", content: "", functionResponses: [{ name: "preguntar", response: { ok: true, preguntado: true } }] },
      ]),
    ]);
    expect(h[1]!.functionCalls).toEqual([{ name: "ask_user_question", args: { questions: [{ id: "q1", question: "¿Qué dirección quieres?" }] } }]);
    expect(h[2]!.functionResponses![0]!.name).toBe("ask_user_question");
  });

  // Ensayo de caja de crear-es-len (06/10): el dueño paró con ■ una «reescribe
  // la portada» a mitad del Write; el historial sólo decía «La escribo entera.»
  // y el turno siguiente («¿cómo va mi página?») la rehízo sin que nadie se lo
  // pidiera. Como Claude Code («[Request interrupted by user]»): se le dice.
  it("🔴 un turno que el dueño paró con ■ lleva la marca detrás de lo que alcanzó a hacer", () => {
    const h = historialDesdeLaBase([
      { userText: "reescribe la portada", assistantReasoning: "La escribo entera.", transcript: { mensajes: [], leidos: [], detenido: true } },
      fila("¿cómo va mi página?", null, "Sin visitas todavía."),
    ]);
    expect(h.slice(0, 3)).toEqual([
      { role: "user", content: "reescribe la portada", opensTurn: true },
      { role: "assistant", content: "La escribo entera." },
      { role: "user", content: MARCA_DE_TURNO_DETENIDO },
    ]);
    expect(h[3]).toEqual({ role: "user", content: "¿cómo va mi página?", opensTurn: true });
  });

  it("la marca va también detrás de las llamadas que sí se hicieron", () => {
    const h = historialDesdeLaBase([
      { userText: "cambia el título", assistantReasoning: "", transcript: { mensajes: leer("/index.html", PAGINA), leidos: [], detenido: true } },
    ]);
    expect(h.at(-1)).toEqual({ role: "user", content: MARCA_DE_TURNO_DETENIDO });
    expect(h[2]!.functionResponses).toHaveLength(1);
  });

  it("BRAZO DE CONTROL: un turno que terminó no lleva marca", () => {
    const h = historialDesdeLaBase([fila("hola", null, "Hola.")]);
    expect(h.some((m) => m.content === MARCA_DE_TURNO_DETENIDO)).toBe(false);
  });

  // COMO DEEPSEEK, LO QUE SE LE DIJO AL MODELO SE QUEDA EN SU SITIO. DeepSeek
  // devuelve el razonamiento de cada turno («passed back verbatim») y TAMBIÉN
  // guarda en la sesión el contexto con el que razonó. Len guardaba lo primero
  // y tiraba lo segundo: un «The system notice says…» de un turno viejo, sin
  // el aviso al lado, se leía como si el aviso fuera de AHORA, y Len rehacía lo
  // que el dueño había parado (ensayo de caja de crear-es-len, 07/10).
  it("🔴 los avisos de un turno vuelven pegados a las palabras del dueño, como se mandaron", () => {
    const avisos = "\n\nSYSTEM (the user did NOT write this):\nNOTICE: your previous turn did NOT call any tool.";
    const h = historialDesdeLaBase([
      { userText: "¿cómo va mi página?", assistantReasoning: "Sin visitas.", transcript: { mensajes: [], leidos: [], avisos } },
    ]);
    expect(h[0]).toEqual({ role: "user", content: `¿cómo va mi página?${avisos}`, opensTurn: true });
  });

  it("una fila sin transcripción (anterior a H4, o del Chat) cae a su texto", () => {
    const h = historialDesdeLaBase([fila("hola", null, "Hola, ¿qué cambiamos?")]);
    expect(h).toEqual([
      { role: "user", content: "hola", opensTurn: true },
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

  // La #10 (plans/len-agente-2026): lo que cambió cada `bash` es sólo de la pantalla.
  const bash = (n: number, relleno: number): Message[] => [
    { role: "assistant", content: "", functionCalls: [{ name: "bash", args: { command: `sed -i ${n}` } }] },
    {
      role: "user",
      content: "",
      functionResponses: [
        {
          name: "bash",
          response: { ok: true, tool_result: `salida ${n}`, [CLAVE_CAMBIOS_DEL_COMANDO]: { ficheros: [], masFicheros: 0, r: "x".repeat(relleno) } },
        },
      ],
    },
  ];
  const salidas = (mensajes: readonly Message[]) =>
    mensajes.flatMap((m) => m.functionResponses ?? []).map((r) => r.response[CLAVE_TOOL_RESULT]);

  it("si cabe, los cambios de cada `bash` se guardan: la lente los lee tras recargar", () => {
    const t = transcripcionParaGuardar(bash(1, 10), new Map());
    expect(t.mensajes[1]!.functionResponses![0]!.response).toHaveProperty(CLAVE_CAMBIOS_DEL_COMANDO);
  });

  it("🔴 si no cabe, se van los cambios de cada `bash` antes que vaciar nada que lea el modelo", () => {
    const t = transcripcionParaGuardar([...bash(1, 150_000), ...bash(2, 150_000), ...bash(3, 150_000)], new Map());
    expect(JSON.stringify(t)).not.toContain(CLAVE_CAMBIOS_DEL_COMANDO);
    expect(salidas(t.mensajes)).toEqual(["salida 1", "salida 2", "salida 3"]);
  });

  // 🔴 H15 fase 2 (02/10, Jesús): lo pensado se guarda con la conversación y
  // vuelve en los turnos siguientes, como en el arnés de DeepSeek (el
  // razonamiento es contenido duradero del mensaje del asistente). Sólo del
  // asistente y sólo si pensó algo.
  it("🔴 guarda lo pensado de cada paso de Len, y sólo el suyo", () => {
    const t = transcripcionParaGuardar(
      [
        { role: "user", content: "x", reasoning: "NO-ES-DE-LEN" },
        { role: "assistant", content: "voy", reasoning: "PENSADO-1", functionCalls: [{ name: "Read", args: {} }] },
        { role: "user", content: "", functionResponses: [{ name: "Read", response: { ok: true } }] },
        { role: "assistant", content: "listo", reasoning: "" },
      ],
      new Map(),
    );
    expect(t.mensajes[0]).toEqual({ role: "user", content: "x" });
    expect(t.mensajes[1]).toMatchObject({ role: "assistant", reasoning: "PENSADO-1" });
    expect(t.mensajes[3]).toEqual({ role: "assistant", content: "listo" });
  });
});

describe("H15 fase 2 · lo pensado en los turnos siguientes", () => {
  const fila = (pensado: string) => ({
    userText: "cambia la marca",
    assistantReasoning: "",
    transcript: {
      mensajes: [
        { role: "user" as const, content: "cambia la marca" },
        { role: "assistant" as const, content: "Hecho.", reasoning: pensado },
      ],
      leidos: [],
    },
  });

  it("🔴 el historial de la base trae lo pensado con su mensaje", () => {
    const h = historialDesdeLaBase([fila("la marca sale en el logo y en el pie")]);
    expect(h.find((m) => m.role === "assistant")).toEqual({
      role: "assistant",
      content: "Hecho.",
      reasoning: "la marca sale en el logo y en el pie",
    });
  });

  it("🔴 el techo lo cuenta: textoDelHistorial lo incluye", () => {
    expect(textoDelHistorial(historialDesdeLaBase([fila("PENSADO-QUE-OCUPA")]))).toContain("PENSADO-QUE-OCUPA");
  });
});

// El aviso de «el turno anterior fue mudo» miraba el ÚLTIMO mensaje del
// asistente. En el historial del navegador las llamadas iban en ese mensaje; en
// la transcripción, el último es el texto final y las llamadas van antes. Mirado
// igual, TODOS los turnos habrían salido mudos.
describe("turnoAnteriorMudoDe — con el historial del navegador y con el de la base", () => {
  // Ensayo de caja (06/10): tras parar con ■ una reescritura a mitad del
  // Write, el aviso de «turno mudo» («If the user asked you for a change and it
  // still isn't applied, apply it NOW») hacía que el turno siguiente —una
  // pregunta por las visitas— rehiciera lo que el dueño acababa de parar.
  it("🔴 un turno que el dueño paró con ■ NO es mudo: no se le empuja a rehacerlo", () => {
    const h = historialDesdeLaBase([
      { userText: "reescribe la portada", assistantReasoning: "La escribo entera.", transcript: { mensajes: [], leidos: [], detenido: true } },
    ]);
    expect(turnoAnteriorMudoDe(h)).toBe(false);
  });

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

  // 🔴 N39 (03/10). Lo que el SERVIDOR mete en el turno con papel de usuario —la
  // insistencia «SYSTEM (the user did NOT write this)…», lo medido al cerrar, la
  // corrección que el dueño escribió a media faena— no es una petición que abra
  // turno. Se contaba como tal: «Len ve N de M» salía con N > M (Pizarrón: 18
  // visibles de 14) y nunca avisaba, y el aviso de «turno mudo» saltaba tras un
  // turno que sí editó. Como en el arnés de DeepSeek, quién abrió el turno es un
  // hecho de la estructura (la fila), no del texto.
  const insistencia = {
    role: "user" as const,
    content: "SYSTEM (the user did NOT write this): you ended the turn WITHOUT calling any tool…",
  };
  const correccion = {
    role: "user" as const,
    content: "[The user wrote to you while you were working. Read it and adjust before your next step.]\nmejor en azul",
  };

  it("🔴 N39: la ventana cuenta los turnos del dueño, no lo que el servidor metió en ellos", () => {
    const h = historialDesdeLaBase([
      fila("hazme la carta", [{ role: "assistant", content: "Ya la hago." }, insistencia, { role: "assistant", content: "OK" }]),
      fila("cambia el título", [...leer("/index.html", PAGINA), correccion, { role: "assistant", content: "Listo, en azul." }]),
    ]);
    expect(ventanaVisibleDe(h)).toBe(2);
  });

  it("🔴 N39: un turno que editó y recibió una corrección después NO es mudo", () => {
    const h = historialDesdeLaBase([
      fila("cambia el título", [
        { role: "assistant", content: "", functionCalls: [{ name: "Edit", args: { file_path: "/index.html", old_string: "Taquería", new_string: "El Farol" } }] },
        { role: "user", content: "", functionResponses: [{ name: "Edit", response: { ok: true, tool_result: "Edited /index.html." } }] },
        correccion,
        { role: "assistant", content: "Listo, en azul." },
      ]),
    ]);
    expect(turnoAnteriorMudoDe(h)).toBe(false);
  });

  it("BRAZO DE CONTROL N39: un turno de la base que sólo habló sigue siendo mudo aunque el servidor insistiera", () => {
    const h = historialDesdeLaBase([fila("hola", [{ role: "assistant", content: "¡Hola!" }, insistencia, { role: "assistant", content: "OK" }])]);
    expect(turnoAnteriorMudoDe(h)).toBe(true);
    expect(ventanaVisibleDe(h)).toBe(1);
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
    expect(h[0]).toEqual({ role: "user", opensTurn: true, content: "¿dónde la pondrías?\n\n[Attached photo: https://u/f.jpg]", images: [FOTO] });
    expect(h[1]).toEqual({ role: "assistant", content: "1. En la portada" });
  });

  it("con texto alt, la nota lo lleva", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg", "mi tienda")], undefined, new Map([["https://u/f.jpg", FOTO]]));
    expect(h[0]!.content).toBe("¿dónde la pondrías?\n\n[Attached photo: https://u/f.jpg — «mi tienda»]");
  });

  it("si no se pudo descargar, la nota lo dice y la dirección se queda", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg")], undefined, new Map([["https://u/f.jpg", null]]));
    expect(h[0]).toEqual({ role: "user", opensTurn: true, content: "¿dónde la pondrías?\n\n[Attached photo: https://u/f.jpg (it couldn't be loaded to see it)]" });
  });

  it("si no cabía con las demás (presupuesto de imagen, como DeepSeek), va sin píxeles y la nota lo dice; la dirección se queda", () => {
    const h = historialDesdeLaBase([conFoto("https://u/f.jpg")], undefined, new Map([["https://u/f.jpg", NO_CABE]]));
    expect(h[0]).toEqual({
      role: "user",
      opensTurn: true,
      content: "¿dónde la pondrías?\n\n[Attached photo: https://u/f.jpg (not in view: it didn't fit with the others; the address works just the same)]",
    });
  });

  it("un turno sin foto queda exactamente igual que antes", () => {
    expect(historialDesdeLaBase([fila("hola", null, "¡Hola!")], undefined, new Map())).toEqual([
      { role: "user", content: "hola", opensTurn: true },
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

// LOTE 7-8 · un turno que cae sin transcripción pero cambió el modo plan o el
// encargo deja la foto (en DeepSeek, un evento duradero de la sesión).
describe("stateOnlyTranscript (lote 7-8)", () => {
  const G = { id: "g1", revision: 1, objective: "Tienda", phase: "active" as const, maxGoalRounds: 256, roundsStarted: 1 };

  it("sin cambios, nada: la fila sigue con transcript NULL", () => {
    expect(stateOnlyTranscript({ folded: { planMode: true, goal: G }, now: { planMode: true, goal: G } })).toBeNull();
    expect(stateOnlyTranscript({ folded: { planMode: false, goal: null }, now: { planMode: false, goal: null } })).toBeNull();
  });

  it("con el modo plan o el encargo cambiados, la foto con mensajes y lecturas vacíos", () => {
    expect(stateOnlyTranscript({ folded: { planMode: false, goal: null }, now: { planMode: true, goal: null } })).toEqual({ mensajes: [], leidos: [], planMode: true });
    expect(stateOnlyTranscript({ folded: { planMode: false, goal: null }, now: { planMode: false, goal: G } })).toEqual({ mensajes: [], leidos: [], goal: G });
    // Apagarlo también es un cambio: la foto sin `planMode` lo apaga en el pliegue.
    expect(stateOnlyTranscript({ folded: { planMode: true, goal: null }, now: { planMode: false, goal: null } })).toEqual({ mensajes: [], leidos: [] });
  });

  it("🔴 una fila así no rompe el historial: cae a lo que escribió Len, y no siembra lecturas", () => {
    const transcript = { mensajes: [], leidos: [], planMode: true as const };
    const filas: FilaDelHistorial[] = [{ userText: "añade reseñas", assistantReasoning: "Voy a planearlo.", transcript }];
    const h = historialDesdeLaBase(filas);
    expect(h.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(h[0]!.content).toContain("añade reseñas");
    expect(h[1]!.content).toBe("Voy a planearlo.");
    expect(leidosSembrados(transcript.leidos, h, () => "x").size).toBe(0);
  });
});

describe("el chat del equipo en el historial", () => {
  it("🔴 el prefijo del equipo va delante de las palabras del turno; sin él, el mensaje no cambia", () => {
    const sin = historialDesdeLaBase([{ userText: "hola", assistantReasoning: "ok", transcript: null }]);
    const con = historialDesdeLaBase([{ userText: "hola", assistantReasoning: "ok", transcript: null, prefijoDelEquipo: "<asked-by/>\n" }]);
    expect(sin[0]!.content).toBe("hola");
    expect(con[0]!.content).toBe("<asked-by/>\nhola");
  });
});
