import { describe, expect, it } from "vitest";
import type { StoredChatTurn } from "@/lib/projects/types";
import {
  claveDeAvance,
  conEvento,
  cualDia,
  elementosDelTurno,
  hiloCompleto,
  hiloDesdeElHistorial,
  marcar,
  parrafos,
  sinLoEnviado,
  terminaEnPregunta,
  turnoNuevo,
  type ElementoDelHilo,
} from "./hilo";

const turno = (x: Partial<StoredChatTurn> & { id: string }): StoredChatTurn => ({ userText: "", assistantReasoning: "", status: "applied", ...x });
const ev = (nombre: string, datos: unknown) => ({ nombre, datos });
const diaUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
const tipos = (es: ElementoDelHilo[]) => es.map((e) => e.tipo);

describe("parrafos", () => {
  it("una burbuja por párrafo, sin marcas de markdown y respetando los saltos de dentro", () => {
    expect(parrafos("**Listo.**\n\n- uno\n- dos\n\n## Siguiente\nMás")).toEqual(["Listo.", "- uno\n- dos", "Siguiente\nMás"]);
  });
  it("texto vacío: ninguna", () => {
    expect(parrafos("  \n\n ")).toEqual([]);
  });
});

describe("hiloDesdeElHistorial", () => {
  it("tu mensaje, lo que dijo Len y «Ver en tu página» si cambió la página", () => {
    const h = hiloDesdeElHistorial([turno({ id: "a", userText: "Pon mi horario", assistantReasoning: "Hecho.\n\nLo puse abajo.", appliedAt: 1000 })], 9999);
    expect(tipos(h)).toEqual(["tu", "len", "len", "verEnTuPagina"]);
    expect(h[0]).toMatchObject({ clave: "a:tu", t: 1000, texto: "Pon mi horario", estado: "ok" });
  });
  it("tu foto va en tu burbuja", () => {
    const h = hiloDesdeElHistorial([turno({ id: "a", userText: "", attachedImage: { url: "https://x/f.jpg" }, assistantReasoning: "La puse.", appliedAt: 1 })], 9);
    expect(h[0]).toMatchObject({ tipo: "tu", texto: "", foto: "https://x/f.jpg" });
  });
  it("una respuesta sin cambio en la página no ofrece verla", () => {
    const h = hiloDesdeElHistorial([turno({ id: "a", userText: "¿Cómo va?", assistantReasoning: "Bien.", noDocChange: true, appliedAt: 1 })], 9);
    expect(tipos(h)).toEqual(["tu", "len"]);
  });
  it("un turno fallido es un fallo, no un cambio", () => {
    expect(tipos(hiloDesdeElHistorial([turno({ id: "a", userText: "x", status: "error", errorText: "proveedor caído", appliedAt: 1 })], 9))).toEqual(["tu", "fallo"]);
  });
  it("un turno deshecho no ofrece verlo", () => {
    expect(tipos(hiloDesdeElHistorial([turno({ id: "a", userText: "x", assistantReasoning: "Hecho.", status: "reverted", appliedAt: 1 })], 9))).toEqual(["tu", "len"]);
  });
  it("un turno en curso sólo pone tu mensaje, a la hora de ahora: lo demás lo pinta el turno en vivo", () => {
    const h = hiloDesdeElHistorial([turno({ id: "a", userText: "Cambia el color", assistantReasoning: "Voy…", enCurso: true })], 777);
    expect(h).toEqual([{ clave: "a:tu", t: 777, tipo: "tu", texto: "Cambia el color", foto: undefined, estado: "ok" }]);
  });
});

describe("terminaEnPregunta", () => {
  const pregunta = { tool: "preguntar", status: "done" as const, summary: "" };
  it("el último turno cerró con `preguntar`", () => {
    expect(terminaEnPregunta([turno({ id: "a", actions: [pregunta] })])).toBe(true);
  });
  it("ya le contestaste (hay otro turno detrás)", () => {
    expect(terminaEnPregunta([turno({ id: "a", actions: [pregunta] }), turno({ id: "b" })])).toBe(false);
  });
  it("sigue trabajando: aún no pregunta", () => {
    expect(terminaEnPregunta([turno({ id: "a", actions: [pregunta], enCurso: true })])).toBe(false);
  });
});

describe("el turno en vivo", () => {
  it("guarda el id, junta el texto por trozos, sigue la herramienta y termina con «Ver en tu página»", () => {
    let v = turnoNuevo();
    for (const e of [
      ev("turno", { turnoId: "x1" }),
      ev("action", { tool: "Read", status: "running", summary: "" }),
      ev("text", { text: "Ya " }),
      ev("text", { text: "está." }),
      ev("action", { tool: "Edit", status: "running", summary: "" }),
      ev("html", { html: "", page: null }),
    ]) v = conEvento(v, e);
    expect(v).toMatchObject({ turnoId: "x1", texto: "Ya está.", avance: "Edit", cambioLaPagina: true, terminado: false });
    v = conEvento(v, ev("done", { turns: 1, toolCalls: 2 }));
    expect(v.terminado).toBe(true);
    expect(v.avance).toBeNull();
    expect(elementosDelTurno(v, 50)).toEqual([
      { clave: "vivo:len:0", t: 50, tipo: "len", texto: "Ya está." },
      { clave: "vivo:ver", t: 50, tipo: "verEnTuPagina" },
    ]);
  });
  it("una herramienta que acaba no borra la línea: la cambia la siguiente", () => {
    let v = conEvento(turnoNuevo(), ev("action", { tool: "Read", status: "running", summary: "" }));
    v = conEvento(v, ev("action", { tool: "Read", status: "done", summary: "" }));
    expect(v.avance).toBe("Read");
  });
  it("`preguntar` marca la pregunta y quita la línea", () => {
    const v = conEvento(conEvento(turnoNuevo(), ev("action", { tool: "Read", status: "running", summary: "" })), ev("action", { tool: "preguntar", status: "done", summary: "" }));
    expect(v).toMatchObject({ pregunta: true, avance: null });
  });
  it("las tarjetas que prepara: el borrador y «Publicar»", () => {
    let v = conEvento(turnoNuevo(), ev("confirm", { action: "responder", canal: "correo", texto: "Hola" }));
    v = conEvento(v, ev("confirm", { action: "publicar", subdominio: "luna", idiomas: ["es", 3], republicar: false }));
    expect(v.tarjetas.map((x) => x.tipo)).toEqual(["respuesta", "publicar"]);
    expect(elementosDelTurno(v, 1).map((e) => e.tipo)).toEqual(["tarjeta", "tarjeta"]);
  });
  it("un error termina el turno con un fallo y sin «Ver en tu página»", () => {
    let v = conEvento(turnoNuevo(), ev("html", { html: "", page: null }));
    v = conEvento(v, ev("error", { message: "plazo" }));
    expect(v).toMatchObject({ error: true, terminado: true });
    expect(tipos(elementosDelTurno(v, 1))).toEqual(["fallo"]);
  });
  it("sin cambio en la página no se ofrece verla", () => {
    const v = conEvento(conEvento(turnoNuevo(), ev("text", { text: "Bien." })), ev("done", {}));
    expect(tipos(elementosDelTurno(v, 1))).toEqual(["len"]);
  });
  it("un evento que no conoce no cambia nada", () => {
    const v = turnoNuevo();
    expect(conEvento(v, ev("otro", {}))).toBe(v);
  });
});

describe("hiloCompleto", () => {
  it("ordena por hora (a la misma hora, en el orden de las partes) y pone un separador por día", () => {
    const DIA = 86_400_000;
    const historia: ElementoDelHilo[] = [
      { clave: "a:tu", t: 1000, tipo: "tu", texto: "hola", estado: "ok" },
      { clave: "a:len:0", t: 1000, tipo: "len", texto: "¡Hola!" },
    ];
    const locales: ElementoDelHilo[] = [
      { clave: "ll", t: 500, tipo: "llamada", segundos: 90 },
      { clave: "x", t: 1000, tipo: "len", texto: "después" },
      { clave: "y", t: DIA + 5, tipo: "len", texto: "mañana" },
    ];
    const h = hiloCompleto([historia, locales], diaUtc);
    expect(h.map((e) => e.clave)).toEqual(["dia:1970-01-01", "ll", "a:tu", "a:len:0", "x", "dia:1970-01-02", "y"]);
  });
});

describe("cualDia", () => {
  it("hoy, ayer (también al cambiar de mes) y otro", () => {
    expect(cualDia("2026-10-01", "2026-10-01")).toBe("hoy");
    expect(cualDia("2026-09-30", "2026-10-01")).toBe("ayer");
    expect(cualDia("2026-09-29", "2026-10-01")).toBe("otro");
  });
});

describe("marcar y sinLoEnviado", () => {
  const ls: ElementoDelHilo[] = [
    { clave: "m1", t: 1, tipo: "tu", texto: "a", estado: "enviando" },
    { clave: "v1", t: 2, tipo: "voz", url: "blob:x", barras: [], segundos: 3, transcripcion: null, estado: "transcribiendo" },
    { clave: "l1", t: 3, tipo: "len", texto: "b" },
  ];
  it("cambia el estado o la transcripción del que toca, y nada más", () => {
    const r = marcar(marcar(ls, "v1", { transcripcion: "hola" }), "m1", { estado: "ok" });
    expect(r[0]).toMatchObject({ estado: "ok" });
    expect(r[1]).toMatchObject({ transcripcion: "hola", estado: "transcribiendo" });
    expect(r[2]).toBe(ls[2]);
  });
  it("marca en qué turno quedó lo que mandaste", () => {
    expect(marcar(ls, "m1", { estado: "ok", fila: "f1" })[0]).toMatchObject({ estado: "ok", fila: "f1" });
    expect(marcar(ls, "v1", { estado: "ok", fila: "f1", correccion: true })[1]).toMatchObject({ fila: "f1", correccion: true });
  });
  it("lo enviado se quita cuando la conversación releída trae SU turno; lo que falló, no", () => {
    const enviados = [...marcar(ls, "m1", { estado: "ok", fila: "f1" }), { clave: "m2", t: 4, tipo: "tu" as const, texto: "c", estado: "noSeEnvio" as const }];
    expect(sinLoEnviado(enviados, [turno({ id: "f1", userText: "a" })]).map((e) => e.clave)).toEqual(["v1", "l1", "m2"]);
  });
  it("🔴 la conversación que se pidió ANTES de tu mensaje no lo trae: tu mensaje se queda (el «1» que desaparecía, 01/10)", () => {
    // El turno anterior acaba → la app relee; mandas «1» antes de que llegue
    // la respuesta, y la respuesta (sin tu turno) llega después.
    const enviado = marcar([{ clave: "m1", t: 1, tipo: "tu", texto: "1", estado: "enviando" }], "m1", { estado: "ok", fila: "f2" });
    expect(sinLoEnviado(enviado, [turno({ id: "f1", userText: "Aquí tienes una foto" })])).toEqual(enviado);
  });
  it("una corrección se queda hasta que su turno se cierra: abierto, la fila aún puede no traerla", () => {
    const corregido = marcar([{ clave: "m1", t: 1, tipo: "tu", texto: "1", estado: "enviando" }], "m1", { estado: "ok", fila: "f2", correccion: true });
    expect(sinLoEnviado(corregido, [turno({ id: "f2", userText: "1", enCurso: true })])).toEqual(corregido);
    expect(sinLoEnviado(corregido, [turno({ id: "f2", userText: "1\n↳ 1" })])).toEqual([]);
  });
});

describe("claveDeAvance", () => {
  it("cada herramienta, su frase; una desconocida, «trabajando»; ninguna, nada", () => {
    expect(claveDeAvance("Edit")).toBe("cambiando");
    expect(claveDeAvance("mirar_pagina")).toBe("comprobando");
    expect(claveDeAvance("TodoWrite")).toBe("trabajando");
    expect(claveDeAvance(null)).toBeNull();
  });
});
