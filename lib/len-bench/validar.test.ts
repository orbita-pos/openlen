// lib/len-bench/validar.test.ts
import { describe, expect, it } from "vitest";
import type { Grader, ResultadoDeGrader } from "./tipos";
import { conversacionAlValidar, faltaLoQueSigue, publicadaAlValidar, revisarCaso } from "./validar";

const grader = (nombre: string, puntua?: false): Grader => ({
  nombre,
  peso: 1,
  ...(puntua === false ? { puntua } : {}),
  calificar: async () => ({ paso: true, explicacion: "" }),
});
const res = (nombre: string, paso: boolean, explicacion = "", puntua = true): ResultadoDeGrader => ({
  nombre,
  paso,
  peso: 1,
  explicacion,
  puntua,
});

const caso = {
  graders: [grader("datos"), grader("enlaces"), grader("cifras", false), grader("sigue-lo-demas")],
  solucion: { html: "<p>bien</p>" },
  rotas: [{ nombre: "roto", datos: { html: "<p>mal</p>" } }],
};

describe("revisarCaso — las reglas 2, 3 y 4, y que las rotas rompan algo", () => {
  it("un caso sano no tiene problemas", () => {
    const r = revisarCaso(caso, {
      solucion: [res("datos", true), res("enlaces", true), res("cifras", false, "", false), res("sigue-lo-demas", true)],
      variantes: [
        { nombre: "inicio", graders: [res("datos", false), res("enlaces", true), res("sigue-lo-demas", true)] },
        { nombre: "roto", graders: [res("datos", true), res("enlaces", false), res("sigue-lo-demas", false)] },
      ],
    });
    expect(r).toEqual({ ok: true, problemas: [], avisos: [] });
  });
  it("regla 2: la solución que suspende un grader que vota, con la explicación del grader", () => {
    const r = revisarCaso(caso, {
      solucion: [res("datos", false, "faltan: plato_1"), res("enlaces", true)],
      variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false), res("sigue-lo-demas", false)] }],
    });
    expect(r.ok).toBe(false);
    expect(r.problemas).toEqual(["regla 2 — la SOLUCIÓN suspende datos: faltan: plato_1"]);
  });
  it("regla 3: el grader que vota y nunca se vio en rojo; el que no vota (puntua:false) no cuenta", () => {
    const r = revisarCaso(caso, {
      solucion: [res("datos", true), res("enlaces", true)],
      variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", true), res("sigue-lo-demas", false)] }],
    });
    expect(r.problemas).toEqual(["regla 3 — enlaces nunca se vio en rojo (ni en la partida ni en las rotas)"]);
  });
  it("regla 4: el caso que no declara lo que NO se pidió tocar (un `sigue-…` que vota)", () => {
    // encargo-grande, recalibración del 2026-09-24: Len quitaba la gorra y
    // también las zapatillas, y sólo lo cazó que la vuelta preguntaba por ellas.
    const sin = { ...caso, graders: [grader("datos"), grader("enlaces"), grader("sigue-lo-demas", false)] };
    const r = revisarCaso(sin, {
      solucion: [res("datos", true), res("enlaces", true)],
      variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false)] }],
    });
    expect(r.problemas).toEqual([
      "regla 4 — no declara lo que NO se pidió tocar: ningún grader «sigue-…» que vote (el que no vota no cuenta)",
    ]);
  });
  it("faltaLoQueSigue: basta un `sigue-…` que vote", () => {
    expect(faltaLoQueSigue({ graders: [grader("siguen-los-demas")] })).toBe(false);
    // Como palabra, no sólo al principio (nombre-nuevo lo tenía antes de la regla).
    expect(faltaLoQueSigue({ graders: [grader("la-sastreria-sigue")] })).toBe(false);
    expect(faltaLoQueSigue({ graders: [grader("persigue-algo")] })).toBe(true);
    expect(faltaLoQueSigue({ graders: [grader("sigue-la-foto", false)] })).toBe(true);
    expect(faltaLoQueSigue({ graders: [grader("datos")] })).toBe(true);
  });
  it("una rota idéntica a la solución se nombra: su cambio no encontró el texto", () => {
    const r = revisarCaso(
      { ...caso, rotas: [{ nombre: "roto", datos: { html: "<p>bien</p>" } }] },
      {
        solucion: [res("datos", true), res("enlaces", true)],
        variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false), res("sigue-lo-demas", false)] }],
      },
    );
    expect(r.ok).toBe(false);
    expect(r.problemas[0]).toMatch(/la rota «roto» es IDÉNTICA a la solución/);
  });
  // Casos de resultados (plans/len-resultados/): la rota se distingue por lo
  // que Len DICE o por lo que se planta después, no por la página.
  it("con la misma página pero otro turno de Len, o un estado plantado después, NO es idéntica", () => {
    const bien = { len: ["Hoy llevas 3."], herramientas: ["ver_visitas"], tarjetas: [] };
    const sinRojos = { solucion: [res("datos", true)], variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false), res("sigue-lo-demas", false)] }] };
    const conTurno = revisarCaso(
      { ...caso, solucionTurno: bien, rotas: [{ nombre: "de-memoria", datos: { html: "<p>bien</p>" }, turno: { ...bien, herramientas: [] } }] },
      sinRojos,
    );
    expect(conTurno.problemas.join(" ")).not.toMatch(/IDÉNTICA/);
    const conDespues = revisarCaso(
      { ...caso, solucionTurno: bien, rotas: [{ nombre: "lo-mando-solo", datos: { html: "<p>bien</p>" }, turno: bien, despues: async () => {} }] },
      sinRojos,
    );
    expect(conDespues.problemas.join(" ")).not.toMatch(/IDÉNTICA/);
    const igual = revisarCaso({ ...caso, solucionTurno: bien, rotas: [{ nombre: "roto", datos: { html: "<p>bien</p>" }, turno: bien }] }, sinRojos);
    expect(igual.problemas.join(" ")).toMatch(/la rota «roto» es IDÉNTICA/);
  });
  // Nació con el caso tabla-a-datos (plans/len-agente-2026; retirado el
  // 2026-10-04 con los almacenes): la solución planta algo DESPUÉS del turno, y
  // la misma página sin eso es otra variante.
  it("con la misma página y sin lo que planta la solución (`solucionDespues`), NO es idéntica; con lo mismo, sí", () => {
    const sinRojos = { solucion: [res("datos", true)], variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false), res("sigue-lo-demas", false)] }] };
    const filas = async () => {};
    const sinFilas = revisarCaso({ ...caso, solucionDespues: filas, rotas: [{ nombre: "almacen-vacio", datos: { html: "<p>bien</p>" } }] }, sinRojos);
    expect(sinFilas.problemas.join(" ")).not.toMatch(/IDÉNTICA/);
    const lasMismas = revisarCaso({ ...caso, solucionDespues: filas, rotas: [{ nombre: "roto", datos: { html: "<p>bien</p>" }, despues: filas }] }, sinRojos);
    expect(lasMismas.problemas.join(" ")).toMatch(/la rota «roto» es IDÉNTICA/);
  });
});

describe("publicadaAlValidar — «y publícalo» sin Len que publique", () => {
  it("sin publicaLen, ninguna variante cuenta como publicada por Len", () => {
    expect(publicadaAlValidar({}, "solucion")).toBe(false);
    expect(publicadaAlValidar({}, "desborda")).toBe(false);
  });
  it("con publicaLen, la solución y las rotas sí (cada rota aísla SU defecto); la partida no, y ahí se ve len-publico en rojo", () => {
    expect(publicadaAlValidar({ publicaLen: true }, "solucion")).toBe(true);
    expect(publicadaAlValidar({ publicaLen: true }, "desborda")).toBe(true);
    expect(publicadaAlValidar({ publicaLen: true }, "inicio")).toBe(false);
  });
});

describe("conversacionAlValidar — lo que el dueño ya dijo", () => {
  it("son los mensajes del guion, en orden y del dueño: en una corrida real Len los recibió, y lo que dictan (existencias, fechas) no es invento", () => {
    expect(
      conversacionAlValidar({
        guion: [
          { tipo: "pide", mensaje: "agrega la taza a $190, me quedan 10" },
          { tipo: "vuelve", mensaje: "que confirmen antes del 20 de octubre" },
        ],
      }),
    ).toEqual([
      { quien: "dueno", texto: "agrega la taza a $190, me quedan 10" },
      { quien: "dueno", texto: "que confirmen antes del 20 de octubre" },
    ]);
  });
});

// Len sabe de tus resultados (plans/len-resultados/): casos que se califican
// por lo que Len DIJO, no por la página. Al validar no hay Len, así que la
// variante trae lo que diría.
describe("conversacionAlValidar con un turno de validación", () => {
  it("intercala lo que dice Len tras cada mensaje del dueño", () => {
    const guion = [{ tipo: "pide", mensaje: "¿me escribió alguien?" }, { tipo: "pide", mensaje: "dile que sí" }] as const;
    expect(conversacionAlValidar({ guion }, { len: ["Sí, Juan.", "Te dejé el borrador."], herramientas: [], tarjetas: [] })).toEqual([
      { quien: "dueno", texto: "¿me escribió alguien?" },
      { quien: "len", texto: "Sí, Juan." },
      { quien: "dueno", texto: "dile que sí" },
      { quien: "len", texto: "Te dejé el borrador." },
    ]);
  });
  it("sin turno, como siempre: sólo el dueño", () => {
    expect(conversacionAlValidar({ guion: [{ tipo: "pide", mensaje: "hola" }] })).toEqual([{ quien: "dueno", texto: "hola" }]);
  });
});

// El juez (`juez.ts`) es de pago, como los `llm` de Claude Code: el validador,
// que corre a $0, lo salta. No es «nunca en rojo»: es «no se corrió», y se dice.
describe("revisarCaso — los graders de pago no se validan a $0", () => {
  it("un juez que vota no cuenta como «nunca en rojo», y queda un aviso", () => {
    const juez: Grader = { ...grader("sin-suposiciones"), pago: true };
    const r = revisarCaso(
      { ...caso, graders: [...caso.graders, juez] },
      {
        solucion: [res("datos", true), res("enlaces", true), res("sin-suposiciones", false, "saltado: validación a $0", false)],
        variantes: [{ nombre: "inicio", graders: [res("datos", false), res("enlaces", false), res("sigue-lo-demas", false)] }],
      },
    );
    expect(r.ok).toBe(true);
    expect(r.avisos).toEqual(["sin-suposiciones es de pago (llama a un modelo): no se valida a $0"]);
  });
});
